import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildBundle } from '../userscript/bundle.mjs';
import { detectFields } from './autodetect.js';
import { sniffImage } from './image-bytes.mjs';
import {
  listSites,
  getSite,
  getProductBundle,
  resolveImage,
  resolveDom,
  previewRecipes,
  parseWorklist,
  deleteProducts,
  startPipelineJob,
  getJob,
  listJobs,
} from './admin-api.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 8777);
const ROOT = path.resolve(__dirname, '..');
const SCHEMA_PATH = path.join(ROOT, 'schema', 'candle.schema.json');
const SITES_DIR = path.join(ROOT, 'sites');

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
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

function sendJs(res, status, text) {
  res.writeHead(status, {
    ...corsHeaders(),
    'Content-Type': 'application/javascript; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

function sendBuffer(res, status, buffer, contentType) {
  res.writeHead(status, {
    ...corsHeaders(),
    'Content-Type': contentType,
    'Content-Length': buffer.length,
  });
  res.end(buffer);
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

// DB-style brand slug (hyphenated) — kept in sync with the pipeline's slugify so the
// local folder name equals the brand_slug stored in the database.
function brandSlug(name) {
  return String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// www-insensitive host key shared by the host->folder index and its lookups.
function normalizeHost(host) {
  return String(host || '').toLowerCase().replace(/^www\./, '');
}

// Accepts a brand as a raw string (display name) or a {name} object and normalizes it to
// { name, slug }, or null when empty. The slug is always derived from the name.
function normalizeBrand(raw) {
  if (!raw) return null;
  const name = (typeof raw === 'string' ? raw : raw.name || '').trim();
  if (!name) return null;
  const slug = brandSlug(name);
  if (!slug) return null;
  return { name, slug };
}

// A site's folder name is decided once, at creation: brand slug when a brand was given,
// else host slug. Because later requests arrive keyed only by host, we keep an in-memory
// index (host -> folder) built from each site's config.json and updated on every save.
const hostIndex = new Map();

function buildHostIndex() {
  hostIndex.clear();
  let entries;
  try {
    entries = fs.readdirSync(SITES_DIR, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const cfgPath = path.join(SITES_DIR, entry.name, 'config.json');
    if (!fs.existsSync(cfgPath)) continue;
    try {
      const cfg = readJsonFile(cfgPath);
      if (cfg.host) hostIndex.set(normalizeHost(cfg.host), entry.name);
    } catch {
      // Skip unreadable/partial config — it'll be re-registered on next save.
    }
  }
}

function resolveSiteFolder(host) {
  return hostIndex.get(normalizeHost(host)) || hostSlug(host);
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
  return path.join(SITES_DIR, resolveSiteFolder(host));
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
    brand: null,
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
  // Extraction is cardinality-agnostic: each tagged field stores its raw
  // capture under data.fields[fieldKey] (a string, or an array of strings when
  // the field has multiple tags). Structuring is deferred to the later LLM step.
  const captured = data.fields?.[field.fieldKey];
  if (captured === undefined) return null;
  return captured;
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

    if (req.method === 'GET' && pathname === '/userscript/bundle.js') {
      // Assembled fresh on every request so editing a src/ module is picked up
      // on the next page reload — no Tampermonkey re-paste. The thin loader
      // userscript fetches this and direct-evals it.
      try {
        // Define-only: the loader (scraper.loader.user.js) evals this fresh for live
        // reload, or falls back to its @require'd cached copy under strict CSP.
        sendJs(res, 200, buildBundle(undefined, { autoRun: false }));
      } catch (err) {
        sendJs(res, 500, `/* Luminascent bundle build failed: ${err.message} */`);
      }
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

      // Folder is locked at creation: brand slug when a brand is supplied up front,
      // else host slug. An already-created site keeps its folder even if a brand is
      // added later (we only update the brand metadata, never migrate the folder).
      const incomingBrand = Object.prototype.hasOwnProperty.call(body.config || {}, 'brand')
        ? normalizeBrand(body.config.brand)
        : undefined;
      const existingFolder = resolveSiteFolder(host);
      const isNew = !fs.existsSync(path.join(SITES_DIR, existingFolder, 'config.json'));
      const folder = isNew ? (incomingBrand ? incomingBrand.slug : hostSlug(host)) : existingFolder;

      const dir = path.join(SITES_DIR, folder);
      ensureDir(dir);

      const filePath = path.join(dir, 'config.json');
      const existing = fs.existsSync(filePath) ? readJsonFile(filePath) : emptyBlueprint(host);
      const next = {
        ...existing,
        ...body.config,
        host,
        hostSlug: hostSlug(host),
        // Only touch brand when the client explicitly sent the key (configure / save-brand);
        // other saves (browse lock, product tag) leave it untouched.
        brand: incomingBrand === undefined ? (existing.brand ?? null) : incomingBrand,
        siteSlug: folder,
        updatedAt: new Date().toISOString(),
      };

      writeJsonFile(filePath, next);
      hostIndex.set(normalizeHost(host), folder);
      sendJson(res, 200, { ok: true, hostSlug: hostSlug(host), siteSlug: folder, config: next });
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
      const { host, urlSlug: slug, order, dataBase64 } = body;

      if (!host || !slug || !order || !dataBase64) {
        sendJson(res, 400, { error: 'host, urlSlug, order, and dataBase64 required' });
        return;
      }

      const buffer = Buffer.from(dataBase64, 'base64');

      // Trust the bytes, not the claimed extension. A lazy-load image URL that resolves
      // to a CDN 404 still returns a 200/404 with an HTML body; saving that as `.jpg`
      // poisons the dataset with broken images. Reject any non-image body, and let the
      // sniffed format pick the extension so the file is always named for what it is.
      const sniffed = sniffImage(buffer);
      if (!sniffed) {
        sendJson(res, 422, { error: 'response is not an image (likely a CDN 404 page); not saved' });
        return;
      }

      const imagesDir = path.join(productDir(host, slug), 'images');
      ensureDir(imagesDir);

      const filename = `${String(order).padStart(2, '0')}.${sniffed.ext}`;
      const filePath = path.join(imagesDir, filename);
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

    if (req.method === 'POST' && pathname === '/page') {
      const body = await readBody(req);
      const { host, scope, url: pageUrl, urlSlug: providedSlug, html } = body;

      if (!host || !html) {
        sendJson(res, 400, { error: 'host and html required' });
        return;
      }

      // Offline DOM snapshots. Product pages land in the product's own folder so
      // they sit alongside data.json / images; browse pages aren't tied to a
      // single product, so they go in a site-level scraped-pages folder.
      let baseDir;
      if (scope === 'browse') {
        baseDir = path.join(siteDir(host), 'scraped-pages');
      } else {
        const slug = providedSlug || urlSlug(pageUrl || '');
        baseDir = path.join(productDir(host, slug), 'scraped-pages');
      }
      ensureDir(baseDir);

      const fileSlug = urlSlug(pageUrl || 'page');
      const filePath = path.join(baseDir, `${fileSlug}.html`);
      fs.writeFileSync(filePath, String(html), 'utf8');

      sendJson(res, 200, {
        ok: true,
        hostSlug: hostSlug(host),
        scope: scope === 'browse' ? 'browse' : 'product',
        path: filePath,
        bytes: Buffer.byteLength(String(html)),
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/auto-detect') {
      const body = await readBody(req);
      const { outline } = body;

      if (!Array.isArray(outline)) {
        sendJson(res, 400, { error: 'outline array required' });
        return;
      }

      if (!fs.existsSync(SCHEMA_PATH)) {
        sendJson(res, 404, { error: 'Schema not found' });
        return;
      }

      const schema = readJsonFile(SCHEMA_PATH);
      try {
        const result = await detectFields({ outline, schema });
        sendJson(res, 200, { ok: true, ...result });
      } catch (err) {
        // Provider/transport failures (Ollama down, bad response) are expected enough
        // to report as a clean status rather than a 500 the userscript can't explain.
        sendJson(res, 502, { error: err.message || 'Auto-detect failed' });
      }
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

    // --- Admin / observability API (admin-api.mjs), addressed by site folder ---
    const segments = pathname.split('/').filter(Boolean);

    if (req.method === 'GET' && pathname === '/sites') {
      sendJson(res, 200, { sites: listSites() });
      return;
    }

    if (req.method === 'GET' && pathname === '/worklist') {
      sendJson(res, 200, parseWorklist());
      return;
    }

    if (req.method === 'GET' && segments[0] === 'sites' && segments.length >= 2) {
      const folder = segments[1];

      // GET /sites/:folder/products/:slug/images/:file
      if (segments[2] === 'products' && segments[4] === 'images' && segments[5]) {
        const image = resolveImage(folder, segments[3], segments[5]);
        if (!image) { sendJson(res, 404, { error: 'image not found' }); return; }
        sendBuffer(res, 200, fs.readFileSync(image.filePath), image.mime);
        return;
      }

      // GET /sites/:folder/products/:slug/dom
      if (segments[2] === 'products' && segments[4] === 'dom') {
        const domPath = resolveDom(folder, segments[3]);
        if (!domPath) { sendText(res, 404, 'DOM not found'); return; }
        res.writeHead(200, { ...corsHeaders(), 'Content-Type': 'text/html; charset=utf-8' });
        res.end(fs.readFileSync(domPath, 'utf8'));
        return;
      }

      // GET /sites/:folder/products/:slug
      if (segments[2] === 'products' && segments[3] && segments.length === 4) {
        const bundle = getProductBundle(folder, segments[3]);
        if (!bundle) { sendJson(res, 404, { error: 'product not found' }); return; }
        sendJson(res, 200, bundle);
        return;
      }

      // GET /sites/:folder/dom  (site browse page snapshot)
      if (segments[2] === 'dom' && segments.length === 3) {
        const domPath = resolveDom(folder, null);
        if (!domPath) { sendText(res, 404, 'DOM not found'); return; }
        res.writeHead(200, { ...corsHeaders(), 'Content-Type': 'text/html; charset=utf-8' });
        res.end(fs.readFileSync(domPath, 'utf8'));
        return;
      }

      // GET /sites/:folder
      if (segments.length === 2) {
        const site = getSite(folder);
        if (!site) { sendJson(res, 404, { error: 'site not found' }); return; }
        sendJson(res, 200, site);
        return;
      }
    }

    // POST /sites/:folder/products/bulk-delete  { slugs }
    if (req.method === 'POST' && segments[0] === 'sites' && segments[2] === 'products' && segments[3] === 'bulk-delete') {
      const body = await readBody(req);
      const result = deleteProducts(segments[1], body.slugs);
      if (!result) { sendJson(res, 404, { error: 'site not found' }); return; }
      sendJson(res, 200, result);
      return;
    }

    // DELETE /sites/:folder/products/:slug
    if (req.method === 'DELETE' && segments[0] === 'sites' && segments[2] === 'products' && segments[3] && segments.length === 4) {
      const result = deleteProducts(segments[1], [segments[3]]);
      if (!result) { sendJson(res, 404, { error: 'site not found' }); return; }
      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'POST' && pathname === '/recipe/preview') {
      const body = await readBody(req);
      if (!body.host || !body.slug) {
        sendJson(res, 400, { error: 'host (folder) and slug required' });
        return;
      }
      const result = previewRecipes(body.host, body.slug);
      if (!result) { sendJson(res, 404, { error: 'site or product not found' }); return; }
      sendJson(res, 200, result);
      return;
    }

    // POST /pipeline/:command  { host, flags }
    if (req.method === 'POST' && segments[0] === 'pipeline' && segments[1]) {
      const body = await readBody(req);
      if (!body.host) { sendJson(res, 400, { error: 'host (folder) required' }); return; }
      const result = startPipelineJob(segments[1], body.host, body.flags);
      if (result.error) { sendJson(res, result.status || 400, result); return; }
      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'GET' && pathname === '/jobs') {
      sendJson(res, 200, { jobs: listJobs() });
      return;
    }

    if (req.method === 'GET' && segments[0] === 'jobs' && segments[1]) {
      const job = getJob(segments[1]);
      if (!job) { sendJson(res, 404, { error: 'job not found' }); return; }
      sendJson(res, 200, { job });
      return;
    }

    sendJson(res, 404, { error: 'Not found', path: pathname });
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: err.message || 'Internal server error' });
  }
}

ensureDir(SITES_DIR);
buildHostIndex();

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error(err);
    sendJson(res, 500, { error: err.message || 'Internal server error' });
  });
});

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Luminascent scraper server listening on http://127.0.0.1:${PORT}`);
    console.log(`Sites directory: ${SITES_DIR}`);
  });
}

export { hostSlug, brandSlug, urlSlug, buildLlmInput };
