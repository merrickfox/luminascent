'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8777);
const ROOT = path.resolve(__dirname, '..');
const SCHEMA_PATH = path.join(ROOT, 'schema', 'candle.schema.json');
const SITES_DIR = path.join(ROOT, 'sites');

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    ...corsHeaders(),
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendText(res, status, text) {
  res.writeHead(status, {
    ...corsHeaders(),
    'Content-Type': 'text/plain; charset=utf-8',
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function hostSlug(host) {
  return String(host || '')
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'unknown_host';
}

function urlSlug(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    parsed = null;
  }

  const segments = parsed
    ? parsed.pathname.split('/').filter(Boolean)
    : String(urlString).split('/').filter(Boolean);

  const last = segments.length ? segments[segments.length - 1] : 'product';
  const hash = crypto.createHash('sha1').update(String(urlString)).digest('hex').slice(0, 8);
  const base = last
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'product';

  return `${base}-${hash}`;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function siteDir(host) {
  return path.join(SITES_DIR, hostSlug(host));
}

function configPath(host) {
  return path.join(siteDir(host), 'config.json');
}

function productDir(host, slug) {
  return path.join(siteDir(host), 'products', slug);
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonFile(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function emptyBlueprint(host) {
  return {
    host,
    hostSlug: hostSlug(host),
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    browse: null,
    product: {
      fields: [],
    },
    images: [],
  };
}

const CONTAINMENT_MODES = [
  { mode: 'also_contains', confidence: 'also' },
  { mode: 'sometimes_contains', confidence: 'sometimes' },
];

function schemaFieldMap(schema) {
  const map = new Map();
  (schema?.fields || []).forEach((field) => map.set(field.key, field));
  return map;
}

function resolveFieldValue(field, data) {
  const value = data[field.fieldKey];
  if (value == null) return null;
  if (Array.isArray(value)) return value.length ? value : null;
  if (typeof value === 'string' && value !== '') return [value];
  return null;
}

function expandContainedKeys(keys, schemaByKey) {
  return (keys || []).map((key) => {
    const schemaField = schemaByKey.get(key);
    return {
      fieldKey: key,
      scope: schemaField?.scope || null,
      type: schemaField?.type || null,
      label: schemaField?.label || key,
    };
  });
}

function buildLlmInput(config, schema, data) {
  const schemaByKey = schemaFieldMap(schema);
  const fields = (config?.product?.fields || []).map((field) => {
    const schemaField = schemaByKey.get(field.fieldKey);
    return {
      fieldKey: field.fieldKey,
      scope: field.scope || schemaField?.scope || null,
      type: field.type || schemaField?.type || null,
      value: resolveFieldValue(field, data),
      also_contains: expandContainedKeys(field.also_contains, schemaByKey),
      sometimes_contains: expandContainedKeys(field.sometimes_contains, schemaByKey),
    };
  });

  const derivedTargets = [];
  (config?.product?.fields || []).forEach((field) => {
    CONTAINMENT_MODES.forEach(({ mode, confidence }) => {
      (field[mode] || []).forEach((containedKey) => {
        const schemaField = schemaByKey.get(containedKey);
        derivedTargets.push({
          fieldKey: containedKey,
          scope: schemaField?.scope || null,
          type: schemaField?.type || null,
          derive_from: field.fieldKey,
          confidence,
        });
      });
    });
  });

  return {
    source_url: data.source_url || null,
    schema: schema?.name || 'candle',
    schema_version: schema?.version || 1,
    generatedAt: new Date().toISOString(),
    fields,
    derived_targets: derivedTargets,
    images: data.images || [],
  };
}

async function handleRequest(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  try {
    if (req.method === 'GET' && pathname === '/health') {
      sendJson(res, 200, { ok: true, port: PORT });
      return;
    }

    if (req.method === 'GET' && pathname === '/schema') {
      if (!fs.existsSync(SCHEMA_PATH)) {
        sendJson(res, 404, { error: 'Schema not found' });
        return;
      }
      sendJson(res, 200, readJsonFile(SCHEMA_PATH));
      return;
    }

    if (req.method === 'GET' && pathname === '/config') {
      const host = url.searchParams.get('host');
      if (!host) {
        sendJson(res, 400, { error: 'host query param required' });
        return;
      }

      const filePath = configPath(host);
      if (!fs.existsSync(filePath)) {
        sendJson(res, 404, { error: 'Config not found', hostSlug: hostSlug(host) });
        return;
      }

      sendJson(res, 200, readJsonFile(filePath));
      return;
    }

    if (req.method === 'POST' && pathname === '/config') {
      const body = await readBody(req);
      const host = body.host || body.config?.host;
      if (!host) {
        sendJson(res, 400, { error: 'host required' });
        return;
      }

      const dir = siteDir(host);
      ensureDir(dir);

      const filePath = configPath(host);
      const existing = fs.existsSync(filePath) ? readJsonFile(filePath) : emptyBlueprint(host);
      const next = {
        ...existing,
        ...body.config,
        host,
        hostSlug: hostSlug(host),
        updatedAt: new Date().toISOString(),
      };

      writeJsonFile(filePath, next);
      sendJson(res, 200, { ok: true, hostSlug: hostSlug(host), config: next });
      return;
    }

    if (req.method === 'POST' && pathname === '/product') {
      const body = await readBody(req);
      const { host, url: productUrl, urlSlug: providedSlug, data } = body;

      if (!host || !data) {
        sendJson(res, 400, { error: 'host and data required' });
        return;
      }

      const slug = providedSlug || urlSlug(productUrl || data.source_url || JSON.stringify(data));
      const dir = productDir(host, slug);
      ensureDir(dir);

      const payload = {
        ...data,
        source_url: data.source_url || productUrl || null,
        scrapedAt: new Date().toISOString(),
      };

      writeJsonFile(path.join(dir, 'data.json'), payload);

      const cfgPath = configPath(host);
      if (fs.existsSync(cfgPath) && fs.existsSync(SCHEMA_PATH)) {
        const config = readJsonFile(cfgPath);
        const schema = readJsonFile(SCHEMA_PATH);
        const llmInput = buildLlmInput(config, schema, payload);
        writeJsonFile(path.join(dir, 'llm_input.json'), llmInput);
      }

      sendJson(res, 200, { ok: true, hostSlug: hostSlug(host), urlSlug: slug, path: dir });
      return;
    }

    if (req.method === 'POST' && pathname === '/image') {
      const body = await readBody(req);
      const { host, urlSlug: slug, order, ext, dataBase64 } = body;

      if (!host || !slug || !order || !dataBase64) {
        sendJson(res, 400, { error: 'host, urlSlug, order, and dataBase64 required' });
        return;
      }

      const extension = String(ext || 'jpg').replace(/^\./, '').toLowerCase();
      const imagesDir = path.join(productDir(host, slug), 'images');
      ensureDir(imagesDir);

      const filename = `${String(order).padStart(2, '0')}.${extension}`;
      const filePath = path.join(imagesDir, filename);
      const buffer = Buffer.from(dataBase64, 'base64');
      fs.writeFileSync(filePath, buffer);

      sendJson(res, 200, {
        ok: true,
        hostSlug: hostSlug(host),
        urlSlug: slug,
        filename,
        bytes: buffer.length,
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/slug') {
      const productUrl = url.searchParams.get('url');
      if (!productUrl) {
        sendJson(res, 400, { error: 'url query param required' });
        return;
      }
      sendJson(res, 200, { urlSlug: urlSlug(productUrl) });
      return;
    }

    sendJson(res, 404, { error: 'Not found', path: pathname });
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: err.message || 'Internal server error' });
  }
}

ensureDir(SITES_DIR);

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error(err);
    sendJson(res, 500, { error: err.message || 'Internal server error' });
  });
});

if (require.main === module) {
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Luminascent scraper server listening on http://127.0.0.1:${PORT}`);
    console.log(`Sites directory: ${SITES_DIR}`);
  });
}

module.exports = {
  hostSlug,
  urlSlug,
  buildLlmInput,
};
