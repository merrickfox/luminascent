// Admin/observability API for the scraper bridge.
//
// These endpoints back the admin panel's "Scraper" section. Unlike the capture
// endpoints in server.js (which key off a live hostname + the host->folder index),
// everything here is addressed by the **site folder name** — exactly what GET /sites
// returns — so the panel deals in stable folder slugs (`aesop`, `agraria`, ...).
//
// Read-only over the on-disk artifacts plus a thin pipeline-job runner.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  withDom,
  findLocator,
  extractValue,
  extractImageSrc,
  normalizeLocatorRecipe,
  getFieldLocators,
} from './recipe-resolver.mjs';

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
export const SCRAPER_ROOT = path.resolve(SERVER_DIR, '..');
const SITES_DIR = path.join(SCRAPER_ROOT, 'sites');
const SCHEMA_PATH = path.join(SCRAPER_ROOT, 'schema', 'candle.schema.json');
const RAW_BRANDS_PATH = path.join(SCRAPER_ROOT, '..', 'data', 'raw-brands.txt');

const IMAGE_MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  webp: 'image/webp', gif: 'image/gif', avif: 'image/avif',
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function tryReadJson(filePath) {
  try {
    return readJson(filePath);
  } catch {
    return null;
  }
}

function exists(filePath) {
  return fs.existsSync(filePath);
}

// Reject path-traversal: a folder/slug/file segment must be a single, simple name.
function isSafeSegment(seg) {
  return typeof seg === 'string' && seg.length > 0 && !seg.includes('/') && !seg.includes('\\') && seg !== '.' && seg !== '..';
}

function siteFolderDir(folder) {
  if (!isSafeSegment(folder)) return null;
  const dir = path.join(SITES_DIR, folder);
  if (!exists(path.join(dir, 'config.json'))) return null;
  return dir;
}

function listProductSlugs(siteDir) {
  const productsDir = path.join(siteDir, 'products');
  let entries;
  try {
    entries = fs.readdirSync(productsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

function listImages(siteDir, slug) {
  const imagesDir = path.join(siteDir, 'products', slug, 'images');
  try {
    return fs.readdirSync(imagesDir).filter((f) => !f.startsWith('.')).sort();
  } catch {
    return [];
  }
}

// The first saved DOM snapshot for a product (or the site's browse page when slug omitted).
function findDomFile(siteDir, slug) {
  const dir = slug
    ? path.join(siteDir, 'products', slug, 'scraped-pages')
    : path.join(siteDir, 'scraped-pages');
  try {
    const html = fs.readdirSync(dir).filter((f) => f.endsWith('.html')).sort();
    return html.length ? path.join(dir, html[0]) : null;
  } catch {
    return null;
  }
}

// Index products.json so a product dir can be matched to its assembled entry.
// Entries reference their dir via image `file` paths (products/<slug>/images/..)
// and carry a source_url that matches the captured data.json.
function indexProductsJson(siteDir) {
  const entries = tryReadJson(path.join(siteDir, 'products.json'));
  const bySourceUrl = new Map();
  const byDirSlug = new Map();
  if (Array.isArray(entries)) {
    for (const entry of entries) {
      if (entry?.source_url) bySourceUrl.set(entry.source_url, entry);
      for (const img of entry?.images || []) {
        const m = typeof img?.file === 'string' ? img.file.match(/products\/([^/]+)\//) : null;
        if (m) byDirSlug.set(m[1], entry);
      }
    }
  }
  return { entries: Array.isArray(entries) ? entries : null, bySourceUrl, byDirSlug };
}

function matchProductEntry(index, slug, data) {
  if (index.byDirSlug.has(slug)) return index.byDirSlug.get(slug);
  if (data?.source_url && index.bySourceUrl.has(data.source_url)) return index.bySourceUrl.get(data.source_url);
  return null;
}

// Cheap heuristics that flag a product worth a closer look in the QA grid.
function computeFlags({ data, llmOutput, entry, imageCount }) {
  const flags = [];
  const name = entry?.name || data?.fields?.name;
  if (!name) flags.push('no-name');
  if (imageCount === 0) flags.push('no-images');
  const hasPrice = Array.isArray(entry?.sizes) && entry.sizes.some((s) => s?.price_amount != null);
  if (entry && !hasPrice) flags.push('no-price');
  if (entry && !(entry.notes?.length || entry.accords?.length)) flags.push('no-notes-accords');
  if (Array.isArray(llmOutput?.errors) && llmOutput.errors.length) flags.push('llm-errors');
  return flags;
}

export function listSites() {
  let entries;
  try {
    entries = fs.readdirSync(SITES_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  const sites = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(SITES_DIR, entry.name);
    const cfg = tryReadJson(path.join(dir, 'config.json'));
    if (!cfg) continue;
    sites.push({
      folder: entry.name,
      host: cfg.host || null,
      brandName: cfg.brand?.name || null,
      brandSlug: cfg.brand?.slug || null,
      productCount: listProductSlugs(dir).length,
      hasBrowse: !!cfg.browse,
      fieldCount: cfg.product?.fields?.length || 0,
      imageRuleCount: (cfg.images || []).length,
      hasProductsJson: exists(path.join(dir, 'products.json')),
      updatedAt: cfg.updatedAt || null,
    });
  }
  return sites.sort((a, b) => a.folder.localeCompare(b.folder));
}

export function getSite(folder) {
  const dir = siteFolderDir(folder);
  if (!dir) return null;
  const cfg = tryReadJson(path.join(dir, 'config.json'));
  const index = indexProductsJson(dir);

  const products = listProductSlugs(dir).map((slug) => {
    const data = tryReadJson(path.join(dir, 'products', slug, 'data.json'));
    const llmOutput = tryReadJson(path.join(dir, 'products', slug, 'llm_output.json'));
    const entry = matchProductEntry(index, slug, data);
    const images = listImages(dir, slug);
    return {
      slug,
      sourceUrl: data?.source_url || null,
      name: entry?.name || data?.fields?.name || null,
      hasData: !!data,
      hasLlmInput: exists(path.join(dir, 'products', slug, 'llm_input.json')),
      hasLlmOutput: !!llmOutput,
      inProductsJson: !!entry,
      imageCount: images.length,
      primaryImage: images[0] || null,
      hasDom: !!findDomFile(dir, slug),
      flags: computeFlags({ data, llmOutput, entry, imageCount: images.length }),
    };
  });

  return {
    folder,
    config: cfg,
    hasProductsJson: !!index.entries,
    productsJsonCount: index.entries?.length || 0,
    products,
  };
}

export function getProductBundle(folder, slug) {
  const dir = siteFolderDir(folder);
  if (!dir || !isSafeSegment(slug)) return null;
  const pdir = path.join(dir, 'products', slug);
  if (!exists(pdir)) return null;
  const data = tryReadJson(path.join(pdir, 'data.json'));
  const index = indexProductsJson(dir);
  const domFile = findDomFile(dir, slug);
  return {
    folder,
    slug,
    data,
    llmInput: tryReadJson(path.join(pdir, 'llm_input.json')),
    llmOutput: tryReadJson(path.join(pdir, 'llm_output.json')),
    product: matchProductEntry(index, slug, data),
    images: listImages(dir, slug),
    domFile: domFile ? path.basename(domFile) : null,
  };
}

// Drop assembled entries for the deleted products from products.json. Matched the same
// way reads are (image `file` dir slug, else source_url captured before deletion).
function pruneProductsJson(siteDir, removals) {
  if (!removals.length) return 0;
  const file = path.join(siteDir, 'products.json');
  const entries = tryReadJson(file);
  if (!Array.isArray(entries)) return 0;
  const slugSet = new Set(removals.map((r) => r.slug));
  const urlSet = new Set(removals.map((r) => r.sourceUrl).filter(Boolean));
  const kept = entries.filter((entry) => {
    if (entry?.source_url && urlSet.has(entry.source_url)) return false;
    for (const img of entry?.images || []) {
      const m = typeof img?.file === 'string' ? img.file.match(/products\/([^/]+)\//) : null;
      if (m && slugSet.has(m[1])) return false;
    }
    return true;
  });
  const removed = entries.length - kept.length;
  if (removed > 0) fs.writeFileSync(file, JSON.stringify(kept, null, 2), 'utf8');
  return removed;
}

// Delete captured products: remove each product folder (data/llm/images/DOM) and prune
// its products.json entry. Local artifacts only — the backend DB is untouched.
export function deleteProducts(folder, slugs) {
  const dir = siteFolderDir(folder);
  if (!dir) return null;
  const list = (Array.isArray(slugs) ? slugs : []).filter(isSafeSegment);
  const results = [];
  const removals = [];
  for (const slug of list) {
    const pdir = path.join(dir, 'products', slug);
    if (!exists(pdir)) {
      results.push({ slug, ok: false, reason: 'not found' });
      continue;
    }
    // Read source_url before deletion so we can match the products.json entry.
    const data = tryReadJson(path.join(pdir, 'data.json'));
    try {
      fs.rmSync(pdir, { recursive: true, force: true });
      removals.push({ slug, sourceUrl: data?.source_url || null });
      results.push({ slug, ok: true });
    } catch (err) {
      results.push({ slug, ok: false, reason: err.message });
    }
  }
  const removedFromProductsJson = pruneProductsJson(dir, removals);
  return { folder, results, deleted: removals.length, removedFromProductsJson };
}

// Resolve an on-disk image path for serving, guarding against traversal.
export function resolveImage(folder, slug, file) {
  const dir = siteFolderDir(folder);
  if (!dir || !isSafeSegment(slug) || !isSafeSegment(file)) return null;
  const filePath = path.join(dir, 'products', slug, 'images', file);
  if (!exists(filePath)) return null;
  const ext = path.extname(file).slice(1).toLowerCase();
  return { filePath, mime: IMAGE_MIME[ext] || 'application/octet-stream' };
}

// Resolve a saved DOM html path for serving (product page, or site browse page).
export function resolveDom(folder, slug) {
  const dir = siteFolderDir(folder);
  if (!dir) return null;
  if (slug != null && !isSafeSegment(slug)) return null;
  const filePath = findDomFile(dir, slug || null);
  return filePath || null;
}

// Re-run the blueprint's field + image locators against the product's saved DOM and
// report what they extract NOW. Compared against the captured data.json by the UI,
// this separates a recipe problem (re-tag) from an LLM problem (reprocess).
export function previewRecipes(folder, slug) {
  const dir = siteFolderDir(folder);
  if (!dir || !isSafeSegment(slug)) return null;
  const cfg = tryReadJson(path.join(dir, 'config.json'));
  const domFile = findDomFile(dir, slug);
  if (!cfg || !domFile) return { available: false, reason: domFile ? 'no config' : 'no saved DOM' };

  const data = tryReadJson(path.join(dir, 'products', slug, 'data.json'));
  let hostname = cfg.host || folder;
  try {
    if (data?.source_url) hostname = new URL(data.source_url).hostname;
  } catch { /* keep fallback */ }

  const html = fs.readFileSync(domFile, 'utf8');
  return withDom(html, hostname, (document) => {
    const fields = {};
    for (const field of cfg.product?.fields || []) {
      const locators = getFieldLocators(field).map(normalizeLocatorRecipe);
      const values = [];
      for (const loc of locators) {
        const el = findLocator(loc, document);
        const v = extractValue(el, loc.extraction);
        if (v != null && v !== '' && !values.includes(v)) values.push(v);
      }
      fields[field.fieldKey] = {
        value: values.length === 1 ? values[0] : (values.length ? values : null),
        resolved: values.length > 0,
        locatorCount: locators.length,
      };
    }
    const images = (cfg.images || []).map((img) => {
      const el = findLocator(normalizeLocatorRecipe(img.locator), document);
      return { order: img.order, resolvedUrl: el ? extractImageSrc(el) : null, resolved: !!el };
    });
    return { available: true, fields, images };
  });
}

// --- Worklist: data/raw-brands.txt cross-referenced with captured sites ---

function brandSlugify(name) {
  return String(name || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Separator-insensitive key for fuzzy brand<->site matching ("Acqua di Parma" -> "acquadiparma").
function compactKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// The brand-bearing label of a host: "www.acquadiparma.com" -> "acquadiparma".
function hostCore(host) {
  const labels = String(host || '').toLowerCase().replace(/^www\./, '').split('.').filter(Boolean);
  return labels[0] || '';
}

export function parseWorklist() {
  let raw;
  try {
    raw = fs.readFileSync(RAW_BRANDS_PATH, 'utf8');
  } catch {
    return { available: false, brands: [] };
  }

  const sites = listSites();
  // Exact-slug index first; a separate compact index is the fuzzy fallback so a
  // site captured without brand metadata still links to its raw-brands line by host.
  const siteBySlug = new Map();
  const siteByCompact = new Map();
  for (const s of sites) {
    siteBySlug.set(s.folder, s);
    if (s.brandSlug) siteBySlug.set(s.brandSlug, s);
    if (s.brandName) siteBySlug.set(brandSlugify(s.brandName), s);
    for (const key of [s.brandName, s.brandSlug, s.folder, hostCore(s.host)]) {
      const ck = compactKey(key);
      if (ck && !siteByCompact.has(ck)) siteByCompact.set(ck, s);
    }
  }

  const brands = raw.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const dashIdx = line.indexOf(' - ');
    const name = (dashIdx >= 0 ? line.slice(0, dashIdx) : line).trim();
    const annotation = dashIdx >= 0 ? line.slice(dashIdx + 3).trim() : null;
    const site = siteBySlug.get(brandSlugify(name)) || siteByCompact.get(compactKey(name));
    let status = 'not-started';
    if (site) {
      if (site.hasProductsJson) status = 'assembled';
      else if (site.productCount > 0) status = 'captured';
      else status = 'configured';
    }
    return {
      name,
      annotation,
      status,
      folder: site?.folder || null,
      productCount: site?.productCount ?? null,
      hasProductsJson: site?.hasProductsJson ?? null,
    };
  });

  return { available: true, brands };
}

// --- Pipeline job runner ---

const ALLOWED_COMMANDS = new Set(['run', 'push', 'sync']);
const ALLOWED_FLAGS = new Set([
  '--reprocess', '--force', '--fresh', '--dry-run',
  '--refetch-images', '--no-update', '--only-new', '--all-brands',
]);

const jobs = new Map(); // id -> job
const MAX_LOG_LINES = 4000;

function jobSnapshot(job) {
  if (!job) return null;
  const { child, ...rest } = job;
  return rest;
}

function pushLog(job, chunk) {
  const text = chunk.toString('utf8');
  for (const line of text.split('\n')) {
    if (line === '' ) continue;
    job.log.push(line);
  }
  if (job.log.length > MAX_LOG_LINES) job.log.splice(0, job.log.length - MAX_LOG_LINES);
}

export function startPipelineJob(command, folder, flags) {
  if (!ALLOWED_COMMANDS.has(command)) {
    return { error: `unknown command: ${command}`, status: 400 };
  }
  if (!siteFolderDir(folder)) {
    return { error: `unknown site folder: ${folder}`, status: 404 };
  }
  for (const job of jobs.values()) {
    if (job.folder === folder && job.status === 'running') {
      return { error: `a ${job.command} job is already running for ${folder}`, status: 409, jobId: job.id };
    }
  }

  const safeFlags = (Array.isArray(flags) ? flags : []).filter((f) => ALLOWED_FLAGS.has(f));
  const args = ['run', 'pipeline', '--', command, '--brand', folder, ...safeFlags];
  const id = `${command}-${folder}-${Date.now()}`;
  const job = {
    id,
    command,
    folder,
    flags: safeFlags,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    log: [],
    child: null,
  };

  const child = spawn('npm', args, { cwd: SCRAPER_ROOT, env: process.env });
  job.child = child;
  job.log.push(`$ npm ${args.join(' ')}`);
  child.stdout.on('data', (d) => pushLog(job, d));
  child.stderr.on('data', (d) => pushLog(job, d));
  child.on('error', (err) => {
    pushLog(job, `spawn error: ${err.message}`);
    job.status = 'failed';
    job.finishedAt = new Date().toISOString();
  });
  child.on('close', (code) => {
    job.exitCode = code;
    job.status = code === 0 ? 'done' : 'failed';
    job.finishedAt = new Date().toISOString();
    job.child = null;
  });

  jobs.set(id, job);
  return { job: jobSnapshot(job) };
}

export function getJob(id) {
  return jobSnapshot(jobs.get(id));
}

export function listJobs() {
  return Array.from(jobs.values())
    .map(jobSnapshot)
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}
