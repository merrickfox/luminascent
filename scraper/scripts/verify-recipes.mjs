import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function loadDom(relativePath, hostname = 'www.aerin.com') {
  const html = fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
  const { document, window } = parseHTML(html);
  globalThis.document = document;
  globalThis.window = window;
  globalThis.location = { hostname, href: `https://${hostname}/` };
  return document;
}

function cssEscape(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

function isVisible() {
  return true;
}

const INSTANCE_ATTR_PATTERNS = [
  /^id$/i, /^data-id$/i, /^data-product-id$/i, /^data-price-amount$/i,
  /^data-option-selected$/i, /^data-attribute-id$/i, /^href$/i, /^src$/i,
  /^title$/i, /^alt$/i,
];

function isInstanceSpecificAttr(name, value) {
  if (INSTANCE_ATTR_PATTERNS.some((pattern) => pattern.test(name))) return true;
  if (name.startsWith('data-') && /^\d+$/.test(String(value || '').trim())) return true;
  if (name === 'class' && /\d{3,}/.test(String(value || ''))) return true;
  return false;
}

function filterRecipeAttrs(attrs) {
  const out = {};
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === '' && key !== 'ku-block' && key !== 'ku-product-block') continue;
    if (isInstanceSpecificAttr(key, value)) continue;
    out[key] = value;
  }
  return out;
}

function normalizeTypeAttrValue(value) {
  return String(value || '').toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().slice(0, 48);
}

function elementTypeFingerprint(el) {
  if (!el || el.nodeType !== 1) return '';
  const tag = el.tagName.toLowerCase();
  const typeAttrs = [];
  for (const attr of el.attributes || []) {
    const { name, value } = attr;
    if (isInstanceSpecificAttr(name, value)) continue;
    if (name === 'class') {
      const tokens = String(value || '').split(/\s+/).filter(Boolean)
        .filter((token) => !/\d{3,}/.test(token)).slice(0, 4)
        .map((token) => normalizeTypeAttrValue(token));
      if (tokens.length) typeAttrs.push(`class~${tokens.sort().join('.')}`);
      continue;
    }
    if (!value || value === name) typeAttrs.push(name);
    else typeAttrs.push(`${name}~${normalizeTypeAttrValue(value)}`);
  }
  typeAttrs.sort();
  const childTags = Array.from(el.children).slice(0, 8).map((child) => child.tagName.toLowerCase()).join(',');
  const childCount = Math.min(Array.from(el.children).length, 24);
  return `${tag}[${typeAttrs.slice(0, 8).join('|')}]{${childTags}}@${childCount}`;
}

function queryByAttrs(root, attrs) {
  if (!attrs || !Object.keys(attrs).length) return [];
  const selectors = [];
  const dataPairs = Object.entries(attrs).filter(([key]) => key.startsWith('data-'));
  if (dataPairs.length) {
    selectors.push(dataPairs.slice(0, 3).map(([key, value]) => `[${key}="${cssEscape(value)}"]`).join(''));
  }
  const results = new Set();
  for (const selector of selectors) {
    root.querySelectorAll(selector).forEach((el) => results.add(el));
  }
  return Array.from(results);
}

function resolveFromAnchorPath(root, recipe, tag) {
  const anchors = queryByAttrs(root, recipe.anchorAttrs);
  for (const anchorEl of anchors) {
    let found = anchorEl;
    if (recipe.relativePathFromAnchor) {
      found = anchorEl.querySelector(recipe.relativePathFromAnchor);
    }
    if (!found) continue;
    if (tag && found.tagName.toLowerCase() !== tag) continue;
    if (isVisible(found)) return found;
  }
  return null;
}

function normalizeBrowseConfig(browse) {
  const normalized = { ...browse };
  if (!normalized.container && normalized.containerLocator) {
    normalized.container = {
      version: 1,
      tag: normalized.containerLocator.tag,
      anchorAttrs: filterRecipeAttrs(normalized.containerLocator.anchorAttrs),
      relativePathFromAnchor: normalized.containerLocator.relativePathFromAnchor || '',
    };
  }
  normalized.itemFingerprint = normalized.itemFingerprint || normalized.typeFingerprint || normalized.fingerprint;
  if (!normalized.linkRule) {
    normalized.linkRule = { version: 1, selector: 'a.klevuProductClick[href]', strategy: 'href' };
  }
  return normalized;
}

function normalizeLocatorRecipe(locator) {
  if (!locator) return locator;
  return {
    ...locator,
    matchMode: 'recipe',
    anchor: null,
    attrs: filterRecipeAttrs(locator.attrs),
    anchorAttrs: filterRecipeAttrs(locator.anchorAttrs),
  };
}

function classTokensOverlap(candidateValue, targetValue) {
  const candidateTokens = new Set(String(candidateValue || '').split(/\s+/).filter(Boolean));
  const targetTokens = String(targetValue || '').split(/\s+/).filter(Boolean);
  return targetTokens.length > 0 && targetTokens.every((token) => candidateTokens.has(token));
}

function getRecipeAttributes(el) {
  const attrs = {};
  for (const attr of el.attributes || []) {
    const { name, value } = attr;
    if (isInstanceSpecificAttr(name, value)) continue;
    if (name.startsWith('data-') || name === 'itemprop' || name === 'role' || name === 'class') {
      attrs[name] = value;
    }
  }
  return attrs;
}

function findLocator(locator, root = document) {
  if (!locator) return null;
  if (locator.anchorAttrs && Object.keys(locator.anchorAttrs).length) {
    const fromAnchor = resolveFromAnchorPath(root, locator, locator.tag);
    if (fromAnchor) return fromAnchor;
  }
  const candidates = new Set();
  queryByAttrs(root, locator.attrs).forEach((el) => candidates.add(el));
  if (locator.tag) root.querySelectorAll(locator.tag).forEach((el) => candidates.add(el));
  let best = null;
  let bestScore = 0;
  for (const candidate of candidates) {
    let score = 0;
    if (locator.tag && candidate.tagName.toLowerCase() === locator.tag) score += 2;
    const candidateAttrs = getRecipeAttributes(candidate);
    for (const [key, value] of Object.entries(locator.attrs || {})) {
      if (candidateAttrs[key] === value) score += 6;
      else if (key === 'class' && classTokensOverlap(candidateAttrs[key], value)) score += 4;
    }
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return bestScore >= 4 ? best : null;
}

function enumerateBrowseItems(browse) {
  const container = resolveFromAnchorPath(document, browse.container, browse.container.tag);
  if (!container) return [];
  return Array.from(container.children).filter(
    (child) => isVisible(child) && elementTypeFingerprint(child) === browse.itemFingerprint,
  );
}

function resolveLinkFromItem(itemEl, linkRule) {
  const links = Array.from(itemEl.querySelectorAll(linkRule.selector)).filter((link) => {
    if (!link.href || link.href.startsWith('javascript:') || link.href.startsWith('#')) return false;
    return true;
  });
  return links[0]?.href || null;
}

function collectProductUrls(browse) {
  return enumerateBrowseItems(browse)
    .map((item) => resolveLinkFromItem(item, browse.linkRule))
    .filter(Boolean);
}

const config = JSON.parse(fs.readFileSync(path.join(rootDir, 'sites/aerin_com/config.json'), 'utf8'));
loadDom('example-sites/aerin/dev-tools.html');

const browse = normalizeBrowseConfig(config.browse);
const items = enumerateBrowseItems(browse);
const urls = collectProductUrls(browse);

console.log('Browse items:', items.length);
console.log('Product URLs:', urls.length);

if (items.length !== 15 || urls.length !== 15 || new Set(urls).size !== 15) {
  console.error('FAIL: expected 15 unique browse items and URLs');
  process.exit(1);
}

console.log('PASS: browse recipe enumerates 15 unique product URLs');

const normalizedFields = config.product.fields.map((field) => ({
  ...field,
  locator: normalizeLocatorRecipe(field.locator),
}));

for (const field of normalizedFields) {
  const badAttrs = Object.entries(field.locator.attrs || {}).filter(([key, value]) => isInstanceSpecificAttr(key, value));
  if (badAttrs.length) {
    console.error(`FAIL: ${field.fieldKey} still has instance attrs`, badAttrs);
    process.exit(1);
  }
  if (field.locator.anchor) {
    console.error(`FAIL: ${field.fieldKey} still has example anchor text`);
    process.exit(1);
  }
}

const productFixture = parseHTML(`
  <main>
    <h1><span itemprop="name" data-ui-id="page-title-wrapper" data-dynamic="name">Madaket Geranium 9.5oz Candle</span></h1>
    <span id="product-price-99999" data-price-amount="125" data-price-type="finalPrice"><span>$125</span></span>
    <div data-attribute-code="candle_scent" data-attribute-id="758" data-option-selected="9999">Scent options</div>
  </main>
`).document;

globalThis.document = productFixture;
const nameField = normalizedFields.find((field) => field.fieldKey === 'name');
const priceField = normalizedFields.find((field) => field.fieldKey === 'price_amount');
const nameEl = findLocator(nameField.locator);
const priceEl = findLocator(priceField.locator);

console.log('Fixture product name:', nameEl?.textContent?.trim());
console.log('Fixture product price:', priceEl?.textContent?.trim());

if (!nameEl || !nameEl.textContent.includes('Madaket Geranium')) {
  console.error('FAIL: name field recipe did not resolve on product fixture');
  process.exit(1);
}

if (!priceEl || !priceEl.textContent.includes('$125')) {
  console.error('FAIL: price field recipe did not resolve on product fixture');
  process.exit(1);
}

console.log('PASS: normalized product field recipes resolve on product fixture');
