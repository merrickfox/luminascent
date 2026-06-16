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

function setDom(html, hostname = 'www.aerin.com') {
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

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

const INSTANCE_ATTR_PATTERNS = [
  /^id$/i, /^data-id$/i, /^data-product-id$/i, /^data-price-amount$/i,
  /^data-product-base-price$/i, /^data-price$/i,
  /^data-option-selected$/i, /^data-attribute-id$/i, /^href$/i, /^src$/i,
  /^title$/i, /^alt$/i,
];

function isLumiscrapeToken(token) {
  return /^lumiscrape-/.test(String(token || ''));
}

function isInstanceSpecificAttr(name, value) {
  if (INSTANCE_ATTR_PATTERNS.some((pattern) => pattern.test(name))) return true;
  if (name.startsWith('data-') && /^\d+$/.test(String(value || '').trim())) return true;
  if (/^data-.*price/i.test(name) && /^[\d.]+$/.test(String(value || '').trim())) return true;
  if (name === 'class' && /\d{3,}/.test(String(value || ''))) return true;
  return false;
}

function isMainContentRegion(el) {
  if (!el) return false;
  return !!el.closest('main, [role="main"], #contentarea, #content, .page-main, .main-content');
}

function isRecommendationRegion(el) {
  if (!el) return false;
  return !!el.closest('.tile-pricing-wrapper, .product-tile, .swiper-recommendations, [class*="recommendation"]');
}

function isProductDetailPrice(el) {
  if (!el) return false;
  return !!el.closest('.product-detail, .prices-add-to-cart-actions, .add-to-cart-sticky-wrapper, .price-and-qty-wrapper');
}

function filterRecipeAttrs(attrs) {
  const out = {};
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === '' && key !== 'ku-block' && key !== 'ku-product-block') continue;
    if (isInstanceSpecificAttr(key, value)) continue;
    if (key === 'class') {
      const tokens = String(value)
        .split(/\s+/)
        .filter(Boolean)
        .filter((token) => !isLumiscrapeToken(token));
      if (!tokens.length) continue;
      out[key] = tokens.join(' ');
      continue;
    }
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
        .filter((token) => !isLumiscrapeToken(token))
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

  const parts = [];

  if (attrs.id) parts.push(`#${cssEscape(attrs.id)}`);

  if (attrs.class) {
    String(attrs.class)
      .split(/\s+/)
      .filter(Boolean)
      .forEach((token) => parts.push(`.${cssEscape(token)}`));
  }

  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'id' || key === 'class') continue;
    if (key.startsWith('data-') || key === 'itemprop' || key === 'role' || key === 'name') {
      parts.push(`[${key}="${cssEscape(value)}"]`);
      continue;
    }
    if ((key === 'ku-block' || key === 'ku-product-block') && (value === '' || value == null)) {
      parts.push(`[${key}]`);
    }
  }

  if (!parts.length) return [];

  try {
    return Array.from(root.querySelectorAll(parts.join('')));
  } catch {
    return [];
  }
}

function resolveAllFromAnchorPath(root, recipe, tag) {
  if (!recipe?.anchorAttrs || !Object.keys(recipe.anchorAttrs).length) return [];

  const results = [];
  const seen = new Set();
  const anchors = queryByAttrs(root, recipe.anchorAttrs);

  for (const anchorEl of anchors) {
    let foundList = [anchorEl];
    if (recipe.relativePathFromAnchor) {
      try {
        const found = anchorEl.querySelector(recipe.relativePathFromAnchor);
        foundList = found ? [found] : [];
      } catch {
        foundList = [];
      }
    }

    for (const found of foundList) {
      if (!found) continue;
      if (tag && found.tagName.toLowerCase() !== tag) continue;
      if (seen.has(found)) continue;
      seen.add(found);
      results.push(found);
    }
  }

  return results;
}

function resolveFromAnchorPath(root, recipe, tag) {
  const matches = resolveAllFromAnchorPath(root, recipe, tag);
  return matches[0] || null;
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
  } else if (normalized.container) {
    normalized.container = {
      ...normalized.container,
      anchorAttrs: filterRecipeAttrs(normalized.container.anchorAttrs),
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

function getFieldLocators(field) {
  if (!field) return [];
  if (Array.isArray(field.locators)) return field.locators.filter(Boolean);
  return field.locator ? [field.locator] : [];
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
    if (name === 'class') {
      const tokens = String(value || '').split(/\s+/).filter(Boolean)
        .filter((token) => !/\d{3,}/.test(token))
        .filter((token) => !isLumiscrapeToken(token))
        .slice(0, 4);
      if (tokens.length) attrs.class = tokens.join(' ');
      continue;
    }
    if (name.startsWith('data-') || name === 'itemprop' || name === 'role') {
      attrs[name] = value;
    }
  }
  return attrs;
}

function getNthOfType(el) {
  if (!el.parentElement) return 1;
  let nth = 1;
  for (const sibling of el.parentElement.children) {
    if (sibling === el) break;
    if (sibling.tagName === el.tagName) nth += 1;
  }
  return nth;
}

function buildStructuralPath(el) {
  const segments = [];
  let current = el;
  while (current && current.tagName && current.tagName.toLowerCase() !== 'body') {
    segments.unshift(`${current.tagName.toLowerCase()}:nth-of-type(${getNthOfType(current)})`);
    current = current.parentElement;
  }
  return segments.join(' > ');
}

function structuralTailOverlap(targetPath, currentPath) {
  if (!targetPath || !currentPath) return 0;
  const targetParts = targetPath.split(' > ');
  const currentParts = currentPath.split(' > ');
  const max = Math.min(targetParts.length, currentParts.length);
  let overlap = 0;
  for (let i = 1; i <= max; i += 1) {
    if (targetParts[targetParts.length - i] === currentParts[currentParts.length - i]) overlap += 1;
    else break;
  }
  return overlap;
}

function scoreLocatorMatch(candidate, locator) {
  let score = 0;
  let evidence = 0;

  if (locator.tag && candidate.tagName.toLowerCase() === locator.tag) score += 2;

  const candidateAttrs = getRecipeAttributes(candidate);
  for (const [key, value] of Object.entries(locator.attrs || {})) {
    if (candidateAttrs[key] === value) {
      score += 6;
      evidence += 5;
    } else if (key === 'class' && classTokensOverlap(candidateAttrs[key], value)) {
      score += 4;
      evidence += 2;
    }
  }

  if (locator.textSample) {
    const text = normalizeText(candidate.textContent);
    if (text && text === locator.textSample) {
      score += 6;
      evidence += 3;
    } else if (text && (text.includes(locator.textSample) || locator.textSample.includes(text))) {
      score += 3;
      evidence += 1;
    }
  }

  if (locator.structuralPath) {
    const overlap = structuralTailOverlap(locator.structuralPath, buildStructuralPath(candidate));
    score += overlap * 2;
    if (overlap >= 2) evidence += Math.min(overlap, 5);
  }

  if (locator.relativePathFromAnchor && locator.anchorAttrs) {
    const resolved = resolveFromAnchorPath(document, {
      anchorAttrs: locator.anchorAttrs,
      relativePathFromAnchor: locator.relativePathFromAnchor,
    }, locator.tag);
    if (resolved === candidate) {
      score += 10;
      evidence += 8;
    }
  }

  if (isMainContentRegion(candidate)) score += 5;
  if (isProductDetailPrice(candidate)) score += 8;
  if (isRecommendationRegion(candidate)) score -= 10;

  return { score, evidence };
}

const LOCATOR_EVIDENCE_THRESHOLD = 5;

function findLocator(locator, root = document) {
  if (!locator) return null;
  const candidates = new Set();

  if (locator.anchorAttrs && Object.keys(locator.anchorAttrs).length) {
    const anchorMatches = resolveAllFromAnchorPath(root, locator, locator.tag);
    if (anchorMatches.length === 1) return anchorMatches[0];
    anchorMatches.forEach((el) => candidates.add(el));
  }

  queryByAttrs(root, locator.attrs).forEach((el) => candidates.add(el));
  if (locator.tag) root.querySelectorAll(locator.tag).forEach((el) => candidates.add(el));

  let best = null;
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    const { score, evidence } = scoreLocatorMatch(candidate, locator);
    if (evidence < LOCATOR_EVIDENCE_THRESHOLD) continue;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

function enumerateBrowseItems(browse) {
  const container = resolveFromAnchorPath(document, browse.container, browse.container?.tag);
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

function fail(message, extra) {
  console.error(`FAIL: ${message}`, extra ?? '');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(path.join(rootDir, 'sites/aerin_com/config.json'), 'utf8'));

// --- Recipe hygiene: no instance attrs, no leftover highlight classes ---
const normalizedFields = config.product.fields.map((field) => ({
  ...field,
  locators: getFieldLocators(field).map((locator) => normalizeLocatorRecipe(locator)),
}));

for (const field of normalizedFields) {
  for (const locator of field.locators) {
    const badAttrs = Object.entries(locator.attrs || {}).filter(([key, value]) => isInstanceSpecificAttr(key, value));
    if (badAttrs.length) fail(`${field.fieldKey} still has instance attrs`, badAttrs);
    if (locator.anchor) fail(`${field.fieldKey} still has example anchor text`);
    const classStr = `${locator.attrs?.class || ''} ${locator.anchorAttrs?.class || ''}`;
    if (classStr.split(/\s+/).some(isLumiscrapeToken)) fail(`${field.fieldKey} still has a lumiscrape highlight class`);
  }
}
console.log('PASS: normalized recipes carry no instance attrs or highlight classes');

// --- filterRecipeAttrs strips highlight tokens but keeps real classes ---
const stripped = filterRecipeAttrs({ class: 'value lumiscrape-highlight-strong' });
if (stripped.class !== 'value') fail('filterRecipeAttrs did not strip highlight token', stripped);
console.log('PASS: filterRecipeAttrs strips lumiscrape-* but keeps real class tokens');

// --- Product field recipes resolve on a representative product fixture ---
setDom(`
  <div></div><div></div><div></div>
  <div>
    <main>
      <div></div>
      <div>
        <div>
          <div>
            <div>
              <h1><span itemprop="name" data-ui-id="page-title-wrapper" data-dynamic="name" class="base">Madaket Geranium 9.5oz Candle</span></h1>
              <div>
                <span class="price">$125</span>
              </div>
              <div></div><div></div><div></div><div></div><div></div><div></div>
              <div>
                <div>
                  <div>
                    <div>
                      <div class="value">AERIN</div>
                    </div>
                  </div>
                  <div>
                    <div>
                      <div class="value">The Madaket Geranium scented candle was inspired by Madaket Beach.</div>
                    </div>
                  </div>
                  <div></div>
                  <div>
                    <div>
                      <div class="value">
                        <ul>
                          <li>Notes: Geranium, Pear, Rose, Jasmine, Amber</li>
                          <li>Size: 9.5 oz</li>
                          <li>Burn time: 55 hours</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>
`);

function fieldByKey(key) {
  return normalizedFields.find((field) => field.fieldKey === key);
}

const nameEl = findLocator(fieldByKey('name')?.locators[0]);
if (!nameEl || !nameEl.textContent.includes('Madaket Geranium')) fail('name recipe did not resolve');

const priceEl = findLocator(fieldByKey('price_amount')?.locators[0]);
if (!priceEl || !priceEl.textContent.includes('$125')) fail('price_amount recipe did not resolve');

const descEl = findLocator(fieldByKey('description')?.locators[0]);
if (!descEl) fail('description recipe did not resolve');
if (!descEl.className.split(/\s+/).includes('value')) {
  fail('description recipe resolved to wrong element (expected div.value)', descEl.className);
}
const descText = normalizeText(descEl.textContent);
if (descText === 'AERIN') {
  fail('description recipe resolved to brand field instead of description copy');
}
if (!descText.startsWith('The Madaket Geranium scented candle')) {
  fail('description recipe captured unexpected text', descText.slice(0, 60));
}

const noteEl = findLocator(fieldByKey('note_name')?.locators[0]);
if (!noteEl || !normalizeText(noteEl.textContent).startsWith('Notes: Geranium')) {
  fail('note_name recipe did not resolve');
}

const burnEl = findLocator(fieldByKey('burn_time_hours')?.locators[0]);
if (!burnEl || !normalizeText(burnEl.textContent).includes('Burn time: 55 hours')) {
  fail('burn_time_hours recipe did not resolve');
}

console.log('PASS: name, price, description, notes, and burn time recipes resolve to the correct nodes');

// --- Evidence gate rejects a region/tag-only match (the original over-grab bug) ---
const noEvidence = findLocator({
  tag: 'div',
  attrs: {},
  anchorAttrs: {},
  structuralPath: 'main:nth-of-type(9) > section:nth-of-type(9) > div:nth-of-type(9)',
});
if (noEvidence) fail('evidence gate allowed a div with no real matching signal', noEvidence.className);
console.log('PASS: evidence gate rejects tag-only matches (no more whole-column grabs)');

// --- Browse recipe still enumerates products on the listing fixture ---
loadDom('example-sites/aerin/dev-tools.html');
const browse = normalizeBrowseConfig(config.browse);
const items = enumerateBrowseItems(browse);
const urls = collectProductUrls(browse);
console.log('Browse items:', items.length, 'Product URLs:', urls.length);
if (!items.length || items.length !== urls.length || new Set(urls).size !== urls.length) {
  fail('browse recipe did not enumerate unique product URLs', { items: items.length, urls: urls.length });
}
console.log(`PASS: browse recipe enumerates ${urls.length} unique product URLs`);

// --- Acqua di Parma: accordion panels share data-parent; only one tab open at a time ---
const adpConfig = JSON.parse(fs.readFileSync(path.join(rootDir, 'sites/acquadiparma_com/config.json'), 'utf8'));
const adpFields = adpConfig.product.fields.map((field) => ({
  ...field,
  locators: getFieldLocators(field).map((locator) => normalizeLocatorRecipe(locator)),
}));

loadDom('sites/acquadiparma_com/example-pages/product.html', 'www.acquadiparma.com');

function adpFieldByKey(key) {
  return adpFields.find((field) => field.fieldKey === key);
}

const adpDescEl = findLocator(adpFieldByKey('description')?.locators[0]);
const adpNoteEl = findLocator(adpFieldByKey('note_name')?.locators[0]);
const adpDescText = normalizeText(adpDescEl?.textContent || '');
const adpNoteText = normalizeText(adpNoteEl?.textContent || '');

if (!adpDescEl || !adpDescText.startsWith('Diffuse enchanting scents')) {
  fail('acquadiparma description recipe did not resolve', adpDescText.slice(0, 60));
}
if (!adpNoteEl || !adpNoteText.includes('Olfactive family: Aromatic green')) {
  fail('acquadiparma note_name recipe did not resolve', adpNoteText.slice(0, 60));
}
if (adpDescText === adpNoteText) {
  fail('acquadiparma description and note_name resolved to the same content');
}
if (adpNoteText.startsWith('Diffuse enchanting scents')) {
  fail('acquadiparma note_name resolved to description accordion panel');
}

console.log('PASS: acquadiparma accordion description and tasting notes resolve independently');

loadDom('sites/acquadiparma_com/example-pages/product.html', 'www.acquadiparma.com');
const adpPrice71El = findLocator(adpFieldByKey('price_amount')?.locators[0]);
const adpPrice71Text = normalizeText(adpPrice71El?.textContent || '');
if (!adpPrice71El || !adpPrice71Text.includes('71')) {
  fail('acquadiparma price_amount did not resolve on £71 product page', adpPrice71Text);
}
if (isRecommendationRegion(adpPrice71El)) {
  fail('acquadiparma price_amount on £71 product page resolved to recommendation tile', adpPrice71Text);
}
console.log('PASS: acquadiparma price_amount resolves to main PDP price on £71 product');

loadDom('sites/acquadiparma_com/example-pages/acropora.html', 'www.acquadiparma.com');
const adpPriceHighEl = findLocator(adpFieldByKey('price_amount')?.locators[0]);
const adpPriceHighText = normalizeText(adpPriceHighEl?.textContent || '');
if (!adpPriceHighEl || !adpPriceHighText.includes('1,383')) {
  fail('acquadiparma price_amount resolved to recommendation tile instead of PDP price', adpPriceHighText);
}
if (isRecommendationRegion(adpPriceHighEl)) {
  fail('acquadiparma price_amount on acropora resolved to recommendation tile', adpPriceHighText);
}
console.log('PASS: acquadiparma price_amount resolves to main PDP price on high-price product');

console.log('\nAll recipe checks passed.');
