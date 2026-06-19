import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';

// Offline regression for the auto-detect candidate-outline builder.
//
// The outline is the contract with the LLM: every field it can be asked to locate must
// appear (somewhere) in the candidate list, or detection silently can't find it. For each
// saved product page that also has a hand-tagged config, we resolve each tagged field's
// locator to its ground-truth element, then assert the outline "reaches" that element
// (the element is a candidate, or shares a containment line with one). This guards the
// builder deterministically — no LLM/Ollama needed.
//
// The candidate logic below MIRRORS userscript/src/065-autodetect.js. Keep them in sync.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const sitesDir = path.join(rootDir, 'sites');

let activeDocument = null;

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function cssEscape(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

function isLumiscrapeToken(token) {
  return /^lumiscrape-/.test(String(token || ''));
}

function isVisible() {
  // No layout in linkedom; treat everything as visible (same stance as verify-recipes).
  return true;
}

function isChromeRegion(el) {
  if (!el) return false;
  return !!el.closest('nav, header, footer, [role="navigation"], [role="banner"], [role="contentinfo"]');
}

function isMainContentRegion(el) {
  if (!el) return false;
  return !!el.closest('main, [role="main"], #contentarea, #content, .page-main, .main-content');
}

// ---- mirror of buildDetectionOutline (065-autodetect.js) ----

const MAX_CANDIDATES = 500;
const SNIPPET_LEN = 140;
const SKIP_TAGS = new Set([
  'script', 'style', 'noscript', 'svg', 'path', 'template', 'head', 'link',
  'meta', 'br', 'hr', 'source', 'track', 'iframe', 'canvas', 'input', 'select',
  'textarea', 'option',
]);
const BLOCK_TAGS = new Set(['div', 'section', 'article', 'ul', 'ol', 'dl', 'blockquote']);
const CONTENT_UNIT_TAGS = new Set(['p', 'li', 'dd', 'h1', 'h2', 'h3', 'h4']);

function directText(el) {
  let text = '';
  for (const node of el.childNodes) {
    if (node.nodeType === 3) text += node.nodeValue;
  }
  return normalizeText(text);
}

function hasSemanticMarker(el) {
  if (!el.attributes) return false;
  if (el.getAttribute('itemprop') || el.getAttribute('role')) return true;
  for (const attr of el.attributes) {
    if (attr.name.startsWith('data-')) return true;
  }
  return false;
}

function isCandidate(el) {
  const tag = el.tagName ? el.tagName.toLowerCase() : '';
  if (!tag || SKIP_TAGS.has(tag)) return false;
  if (!isVisible(el)) return false;
  if (isChromeRegion(el)) return false;

  if (directText(el).length >= 2) return true;
  if (CONTENT_UNIT_TAGS.has(tag)) return normalizeText(el.textContent).length >= 2;
  if (BLOCK_TAGS.has(tag)) {
    const textLen = normalizeText(el.textContent).length;
    const descendants = el.querySelectorAll('*').length;
    return textLen >= 30 && textLen <= 2000 && descendants <= 12;
  }
  return hasSemanticMarker(el) && normalizeText(el.textContent).length >= 2;
}

function describeCandidate(el, index) {
  const tag = el.tagName.toLowerCase();
  let head = `[${index}] ${tag}`;
  const classes = Array.from(el.classList || [])
    .filter((token) => !isLumiscrapeToken(token))
    .slice(0, 3);
  if (classes.length) head += `.${classes.join('.')}`;
  const text = (directText(el) || normalizeText(el.textContent)).slice(0, SNIPPET_LEN);
  return `${head} "${text}"`;
}

function buildDetectionOutline(root) {
  const candidates = [];
  for (const el of root.querySelectorAll('*')) {
    if (isCandidate(el)) candidates.push(el);
  }
  let ordered = candidates;
  let truncated = false;
  if (candidates.length > MAX_CANDIDATES) {
    const main = candidates.filter((el) => isMainContentRegion(el));
    const rest = candidates.filter((el) => !isMainContentRegion(el));
    ordered = [...main, ...rest].slice(0, MAX_CANDIDATES);
    truncated = true;
  }
  const lines = ordered.map((el, index) => describeCandidate(el, index));
  return { lines, elements: ordered, truncated };
}

// ---- compact locator resolver (ground truth) ----

function queryByAttrs(root, attrs) {
  if (!attrs || !Object.keys(attrs).length) return [];
  const parts = [];
  if (attrs.id) parts.push(`#${cssEscape(attrs.id)}`);
  if (attrs.class) {
    String(attrs.class).split(/\s+/).filter(Boolean).forEach((t) => parts.push(`.${cssEscape(t)}`));
  }
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'id' || key === 'class') continue;
    if (key.startsWith('data-') || key === 'itemprop' || key === 'role' || key === 'name') {
      parts.push(`[${key}="${cssEscape(value)}"]`);
    }
  }
  if (!parts.length) return [];
  try {
    return Array.from(root.querySelectorAll(parts.join('')));
  } catch {
    return [];
  }
}

function resolveFromAnchorPath(root, recipe, tag) {
  if (!recipe?.anchorAttrs || !Object.keys(recipe.anchorAttrs).length) return [];
  const out = [];
  for (const anchorEl of queryByAttrs(root, recipe.anchorAttrs)) {
    let found = anchorEl;
    if (recipe.relativePathFromAnchor) {
      try {
        found = anchorEl.querySelector(recipe.relativePathFromAnchor);
      } catch {
        found = null;
      }
    }
    if (!found) continue;
    if (tag && found.tagName.toLowerCase() !== tag) continue;
    if (!out.includes(found)) out.push(found);
  }
  return out;
}

// A class like `media-0_textSm__Q52Mz` can match dozens of elements (incl. chrome
// banners). The real userscript disambiguates with a scorer; here we approximate it:
// prefer the textSample match, penalise chrome, then tag match. Picking the first raw
// class match would resolve to the wrong element and mis-report coverage.
function resolveLocator(doc, locator) {
  if (!locator) return null;
  const set = [];
  resolveFromAnchorPath(doc, locator, locator.tag).forEach((el) => set.push(el));
  queryByAttrs(doc, locator.attrs).forEach((el) => { if (!set.includes(el)) set.push(el); });
  if (!set.length) return null;

  const sample = normalizeText(locator.textSample || '');
  const tag = (locator.tag || '').toLowerCase();
  const ranked = set
    .map((el) => {
      let score = 0;
      if (isChromeRegion(el)) score -= 100;
      const txt = normalizeText(el.textContent);
      if (sample) {
        if (txt === sample) score += 10;
        else if (txt.includes(sample) || sample.includes(txt)) score += 5;
      }
      if (el.tagName.toLowerCase() === tag) score += 1;
      // Leaf preference: when an ancestor and its child both "include" the sample, the
      // child is the real tag. Tiny weight so it only breaks otherwise-equal scores.
      score -= Math.min(el.querySelectorAll('*').length, 50) / 100;
      return { el, score };
    })
    .sort((a, b) => b.score - a.score);
  return ranked[0].el;
}

// ---- coverage relation ----

function isOrAncestor(anc, node) {
  let n = node;
  while (n) {
    if (n === anc) return true;
    n = n.parentElement;
  }
  return false;
}

function related(a, b) {
  return a === b || isOrAncestor(a, b) || isOrAncestor(b, a);
}

// ---- harness ----

const CORE_FIELDS = ['name', 'price_amount', 'description', 'note_name', 'accord_name', 'size_value'];
// Fields whose absence from the outline is treated as a hard failure (always single,
// always on a product page). Others are reported but don't fail the suite.
const REQUIRED_FIELDS = ['name', 'price_amount'];

function firstLocator(field) {
  if (Array.isArray(field.locators)) return field.locators.find(Boolean) || null;
  return field.locator || null;
}

function findSiteCases() {
  const cases = [];
  let entries;
  try {
    entries = fs.readdirSync(sitesDir, { withFileTypes: true });
  } catch {
    return cases;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const cfgPath = path.join(sitesDir, entry.name, 'config.json');
    if (!fs.existsSync(cfgPath)) continue;
    let config;
    try {
      config = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    } catch {
      continue;
    }
    if (!config.product?.fields?.length) continue;

    // All saved product-page snapshots for this site (a site may mix product and
    // bundle/set templates; runCase picks one where the fields actually resolve).
    const productsDir = path.join(sitesDir, entry.name, 'products');
    const htmlPaths = [];
    if (fs.existsSync(productsDir)) {
      for (const prod of fs.readdirSync(productsDir).sort()) {
        const pagesDir = path.join(productsDir, prod, 'scraped-pages');
        if (!fs.existsSync(pagesDir)) continue;
        const html = fs.readdirSync(pagesDir).find((f) => f.endsWith('.html'));
        if (html) htmlPaths.push(path.join(pagesDir, html));
      }
    }
    if (!htmlPaths.length) continue;
    cases.push({ site: entry.name, config, htmlPaths });
  }
  return cases;
}

function nameLocator(config) {
  const field = config.product.fields.find((f) => f.fieldKey === 'name');
  return field ? firstLocator(field) : null;
}

function runCase({ site, config, htmlPaths }) {
  // Prefer a snapshot where the product `name` resolves — skips bundle/set pages that
  // share the site but use a different template, so we evaluate a real product layout.
  const nameLoc = nameLocator(config);
  let chosen = null;
  let document = null;
  for (const htmlPath of htmlPaths.slice(0, 8)) {
    const { document: doc } = parseHTML(fs.readFileSync(htmlPath, 'utf8'));
    if (!nameLoc || resolveLocator(doc, nameLoc)) {
      chosen = htmlPath;
      document = doc;
      break;
    }
    if (!document) { chosen = htmlPath; document = doc; }
  }
  activeDocument = document;

  const { elements, truncated } = buildDetectionOutline(document.body);
  const candidateSet = elements;

  const results = [];
  for (const field of config.product.fields) {
    if (!CORE_FIELDS.includes(field.fieldKey)) continue;
    const locator = firstLocator(field);
    const el = locator ? resolveLocator(document, locator) : null;
    if (!el) {
      results.push({ fieldKey: field.fieldKey, status: 'unresolved' });
      continue;
    }
    const covered = candidateSet.some((c) => related(c, el));
    results.push({ fieldKey: field.fieldKey, status: covered ? 'covered' : 'missing' });
  }

  return { site, page: path.basename(chosen), candidateCount: elements.length, truncated, results };
}

function main() {
  const cases = findSiteCases();
  if (!cases.length) {
    console.error('No site cases with both config fields and a saved product page found.');
    process.exit(1);
  }

  let failures = 0;
  for (const testCase of cases) {
    const { site, page, candidateCount, truncated, results } = runCase(testCase);
    console.log(`\n${site}  [${page}]  (${candidateCount} candidates${truncated ? ', truncated' : ''})`);
    for (const r of results) {
      const required = REQUIRED_FIELDS.includes(r.fieldKey);
      let mark;
      if (r.status === 'covered') mark = '  ✓';
      else if (r.status === 'missing') mark = required ? 'FAIL' : ' WARN';
      else mark = ' SKIP'; // unresolved ground truth (test-side), not a builder failure
      console.log(`  ${mark}  ${r.fieldKey}  (${r.status})`);
      if (r.status === 'missing' && required) failures += 1;
    }
  }

  console.log('');
  if (failures) {
    console.error(`verify-autodetect: ${failures} required field(s) not covered by the outline.`);
    process.exit(1);
  }
  console.log('verify-autodetect: all required fields covered by the candidate outline.');
}

main();
