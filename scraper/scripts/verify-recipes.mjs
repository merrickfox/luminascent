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

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function isVisible() {
  return true;
}

function isLumiscrapeClassToken(token) {
  return /^lumiscrape-/i.test(String(token || ''));
}

function sanitizeRecipeClassValue(value) {
  return String(value || '')
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !isLumiscrapeClassToken(token))
    .join(' ');
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
  if (name === 'class' && isLumiscrapeClassToken(value)) return true;
  if (name === 'class' && !sanitizeRecipeClassValue(value)) return true;
  return false;
}

function filterRecipeAttrs(attrs) {
  const out = {};
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === '') continue;
    if (key === 'class') {
      const sanitized = sanitizeRecipeClassValue(value);
      if (!sanitized || isInstanceSpecificAttr(key, sanitized)) continue;
      out[key] = sanitized;
      continue;
    }
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
        .filter((token) => !/\d{3,}/.test(token))
        .filter((token) => !isLumiscrapeClassToken(token))
        .slice(0, 4)
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

  if (attrs.id) selectors.push(`#${cssEscape(attrs.id)}`);

  if (attrs.class) {
    const classSelector = sanitizeRecipeClassValue(attrs.class)
      .split(/\s+/)
      .filter(Boolean)
      .map((token) => `.${cssEscape(token)}`)
      .join('');
    if (classSelector) selectors.push(classSelector);
  }

  const dataPairs = Object.entries(attrs).filter(
    ([key]) => key.startsWith('data-') || key === 'itemprop' || key === 'role' || key === 'name',
  );
  if (dataPairs.length) {
    selectors.push(dataPairs.slice(0, 3).map(([key, value]) => `[${key}="${cssEscape(value)}"]`).join(''));
  }

  const results = new Set();
  for (const selector of selectors) {
    try {
      root.querySelectorAll(selector).forEach((el) => results.add(el));
    } catch {
      /* ignore invalid selectors */
    }
  }
  return Array.from(results);
}

function resolveFromAnchorPath(root, recipe, tag) {
  if (!recipe?.anchorAttrs || !Object.keys(recipe.anchorAttrs).length) return null;
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

function normalizeFieldEntry(field) {
  if (!field.locators) {
    field.locators = field.locator ? [normalizeLocatorRecipe(field.locator)] : [];
  } else {
    field.locators = field.locators.map((locator) => normalizeLocatorRecipe(locator));
  }
  delete field.locator;
  return field;
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
      if (name === 'class') {
        const sanitized = sanitizeRecipeClassValue(value);
        if (sanitized) attrs[name] = sanitized;
      } else {
        attrs[name] = value;
      }
    }
  }
  return attrs;
}

function getNthOfType(el) {
  let index = 1;
  let sibling = el.previousElementSibling;
  while (sibling) {
    if (sibling.tagName === el.tagName) index += 1;
    sibling = sibling.previousElementSibling;
  }
  return index;
}

function buildStructuralPath(el) {
  const segments = [];
  let current = el;
  while (current && current !== document.body) {
    segments.unshift(`${current.tagName.toLowerCase()}:nth-of-type(${getNthOfType(current)})`);
    current = current.parentElement;
  }
  return segments.join(' > ');
}

function isMainContentRegion(el) {
  return !!el.closest('main, [role="main"], #contentarea, #content, .page-main, .main-content');
}

function isChromeRegion(el) {
  return !!el.closest('nav, header, footer, [role="navigation"], [role="banner"], [role="contentinfo"]');
}

function scoreStructuralPathOverlap(candidatePath, targetPath, recipeMode) {
  if (!targetPath || !candidatePath) return 0;
  const targetParts = targetPath.split(' > ').filter(Boolean);
  const currentParts = candidatePath.split(' > ').filter(Boolean);
  if (!targetParts.length || !currentParts.length) return 0;

  let overlap = 0;
  const maxCompare = Math.min(targetParts.length, currentParts.length);
  for (let i = 1; i <= maxCompare; i += 1) {
    if (targetParts[targetParts.length - i] === currentParts[currentParts.length - i]) {
      overlap += 1;
    } else {
      break;
    }
  }
  return recipeMode ? overlap * 3 : overlap;
}

function scoreTextSampleMatch(candidate, textSample, recipeMode) {
  if (!textSample) return 0;
  const text = normalizeText(candidate.textContent);
  const sample = normalizeText(textSample);
  if (!text || !sample) return 0;
  if (text === sample) return recipeMode ? 12 : 4;
  if (text.startsWith(sample) || sample.startsWith(text)) return recipeMode ? 8 : 2;
  if (text.includes(sample) || sample.includes(text)) return recipeMode ? 5 : 2;
  return recipeMode ? -4 : 0;
}

function hasRecipeAttrMatch(candidateAttrs, targetAttrs) {
  for (const [key, value] of Object.entries(targetAttrs || {})) {
    if (!value) continue;
    if (candidateAttrs[key] === value) return true;
    if (key === 'class' && classTokensOverlap(candidateAttrs[key], value)) return true;
  }
  return false;
}

function meetsRecipeLocatorThreshold(candidate, locator, score) {
  if (!candidate || !locator || score < 6) return false;

  const candidateAttrs = getRecipeAttributes(candidate);
  const hasAttrMatch = hasRecipeAttrMatch(candidateAttrs, locator.attrs);
  const textScore = scoreTextSampleMatch(candidate, locator.textSample, true);
  const structuralScore = scoreStructuralPathOverlap(
    buildStructuralPath(candidate),
    locator.structuralPath,
    true,
  );

  if (hasAttrMatch) return true;
  if (textScore >= 5 && structuralScore >= 6) return true;
  if (structuralScore >= 12) return true;

  const fromAnchor = resolveFromAnchorPath(document, {
    anchorAttrs: locator.anchorAttrs,
    relativePathFromAnchor: locator.relativePathFromAnchor,
  }, locator.tag);
  if (fromAnchor === candidate) return true;

  return false;
}

function scoreLocatorMatch(candidate, locator, options = {}) {
  const recipeMode = options.recipeMode || locator.matchMode === 'recipe';
  let score = 0;

  if (locator.tag && candidate.tagName.toLowerCase() === locator.tag) score += 2;

  const candidateAttrs = getRecipeAttributes(candidate);
  for (const [key, value] of Object.entries(locator.attrs || {})) {
    if (candidateAttrs[key] === value) score += recipeMode ? 6 : 4;
    else if (key === 'class' && classTokensOverlap(candidateAttrs[key], value)) score += recipeMode ? 4 : 2;
  }

  if (locator.textSample) {
    score += scoreTextSampleMatch(candidate, locator.textSample, recipeMode);
  }

  if (locator.structuralPath) {
    score += scoreStructuralPathOverlap(
      buildStructuralPath(candidate),
      locator.structuralPath,
      recipeMode,
    );
  }

  if (recipeMode && locator.relativePathFromAnchor && locator.anchorAttrs) {
    const resolved = resolveFromAnchorPath(document, {
      anchorAttrs: locator.anchorAttrs,
      relativePathFromAnchor: locator.relativePathFromAnchor,
    }, locator.tag);
    if (resolved === candidate) score += 10;
  }

  if (recipeMode) {
    if (isMainContentRegion(candidate)) score += 2;
    if (isChromeRegion(candidate)) score -= 8;
  }

  if (isVisible(candidate)) score += 1;
  return score;
}

function findLocator(locator, root = document, options = {}) {
  if (!locator) return null;
  const recipeMode = options.recipeMode || locator.matchMode === 'recipe';

  if (recipeMode && locator.anchorAttrs && Object.keys(locator.anchorAttrs).length) {
    const fromAnchor = resolveFromAnchorPath(root, locator, locator.tag);
    if (fromAnchor) return fromAnchor;
  }

  const candidates = new Set();
  queryByAttrs(root, locator.attrs).forEach((el) => candidates.add(el));
  if (locator.tag) root.querySelectorAll(locator.tag).forEach((el) => candidates.add(el));

  let best = null;
  let bestScore = 0;
  for (const candidate of candidates) {
    const score = scoreLocatorMatch(candidate, locator, { recipeMode });
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  if (recipeMode) {
    return meetsRecipeLocatorThreshold(best, locator, bestScore) ? best : null;
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

function findFieldLocator(field, fieldKey) {
  const normalized = normalizeFieldEntry({ ...field });
  const locator = normalized.locators?.[0];
  if (!locator) {
    console.error(`FAIL: ${fieldKey} has no locators`);
    process.exit(1);
  }
  return locator;
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

const normalizedFields = config.product.fields.map((field) => normalizeFieldEntry({ ...field }));

for (const field of normalizedFields) {
  for (const locator of field.locators || []) {
    const badAttrs = Object.entries(locator.attrs || {}).filter(([key, value]) => {
      if (key === 'class' && sanitizeRecipeClassValue(value).includes('lumiscrape')) return true;
      return isInstanceSpecificAttr(key, value);
    });
    if (badAttrs.length) {
      console.error(`FAIL: ${field.fieldKey} still has instance attrs`, badAttrs);
      process.exit(1);
    }
    if (locator.anchor) {
      console.error(`FAIL: ${field.fieldKey} still has example anchor text`);
      process.exit(1);
    }
  }
}

const productFixture = parseHTML(`
  <main>
    <div class="column main">
      Skip to the end of the images gallery AERIN Villandry 9.5oz Candle $125 Add to Bag
    </div>
    <h1><span itemprop="name" data-ui-id="page-title-wrapper" data-dynamic="name">Madaket Geranium 9.5oz Candle</span></h1>
    <span class="price"><span>$125</span></span>
    <div class="product info detailed">
      <div class="data item content">
        <div class="value">The Villandry scented candle captures the romance of the fragrant flower gardens that surround the 16th-century Château de Villandry in France's Loire Valley.</div>
      </div>
      <div class="data item content">
        <ul>
          <li>Notes: Orchid, Gardenia, Muguet, Freesia, Vanilla</li>
          <li>Dimensions: 3.2" x 3.2" x 4.0"</li>
          <li>Burn time: 55 hours</li>
        </ul>
      </div>
    </div>
    <ul><li>1</li></ul>
  </main>
`).document;

globalThis.document = productFixture;

const nameField = normalizedFields.find((field) => field.fieldKey === 'name');
const priceField = normalizedFields.find((field) => field.fieldKey === 'price_currency');
const descriptionField = normalizedFields.find((field) => field.fieldKey === 'description');
const notesField = normalizedFields.find((field) => field.fieldKey === 'note_name');

const nameEl = findLocator(findFieldLocator(nameField, 'name'));
const priceEl = findLocator(findFieldLocator(priceField, 'price_currency'));
const descriptionEl = findLocator(findFieldLocator(descriptionField, 'description'));
const notesEl = findLocator(findFieldLocator(notesField, 'note_name'));

console.log('Fixture product name:', nameEl?.textContent?.trim());
console.log('Fixture product price:', priceEl?.textContent?.trim());
console.log('Fixture description:', descriptionEl?.textContent?.trim()?.slice(0, 80));
console.log('Fixture notes:', notesEl?.textContent?.trim());

if (!nameEl || !nameEl.textContent.includes('Madaket Geranium')) {
  console.error('FAIL: name field recipe did not resolve on product fixture');
  process.exit(1);
}

if (!priceEl || !priceEl.textContent.includes('$125')) {
  console.error('FAIL: price field recipe did not resolve on product fixture');
  process.exit(1);
}

if (!descriptionEl || !descriptionEl.textContent.includes('Villandry scented candle')) {
  console.error('FAIL: description field recipe did not resolve on product fixture');
  process.exit(1);
}

if (descriptionEl.textContent.includes('Add to Bag')) {
  console.error('FAIL: description field matched product column wrapper instead of description block');
  process.exit(1);
}

if (!notesEl || !notesEl.textContent.includes('Notes: Orchid')) {
  console.error('FAIL: note_name field recipe did not resolve on product fixture');
  process.exit(1);
}

if (notesEl.textContent.trim() === '1') {
  console.error('FAIL: note_name field matched wrong li element');
  process.exit(1);
}

console.log('PASS: normalized product field recipes resolve on product fixture');
