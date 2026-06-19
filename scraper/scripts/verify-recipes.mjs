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

function elementItemSignature(el) {
  if (!el || el.nodeType !== 1) return '';
  const tag = el.tagName.toLowerCase();
  const tokens = [];
  if (el.classList?.length) {
    Array.from(el.classList)
      .filter((token) => !/\d{3,}/.test(token))
      .filter((token) => !isLumiscrapeToken(token))
      .filter((token) => !/\b(?:active|current|selected|hover|focus|cloned|slick-|swiper-)\b/i.test(token))
      .map((token) => normalizeTypeAttrValue(token))
      .filter(Boolean)
      .forEach((token) => tokens.push(`c~${token}`));
  }
  for (const attr of el.attributes || []) {
    const { name, value } = attr;
    if (name === 'class') continue;
    if (isInstanceSpecificAttr(name, value)) continue;
    if (name.startsWith('data-') || name === 'role' || name === 'itemprop') {
      if (!value || value === name) { tokens.push(name); continue; }
      const normalized = normalizeTypeAttrValue(value);
      tokens.push(normalized.includes('#') ? name : `${name}~${normalized}`);
    }
  }
  if (tokens.length) {
    tokens.sort();
    return `${tag}[${tokens.join('|')}]`;
  }
  const childTags = Array.from(el.children).slice(0, 6).map((child) => child.tagName.toLowerCase()).join(',');
  if (!childTags) return '';
  return `${tag}{${childTags}}`;
}

const firstFromSrcset = (srcset) => {
  if (!srcset) return null;
  const first = srcset.split(',')[0]?.trim().split(/\s+/)[0];
  return first || null;
};

function lazyImgUrl(img) {
  if (!img) return null;
  const live = img.currentSrc || img.src || img.getAttribute('src');
  if (live) return live;
  const dataAttrs = ['data-src', 'data-image', 'data-original', 'data-lazy-src', 'data-lazy'];
  for (const attr of dataAttrs) {
    const v = img.getAttribute?.(attr);
    if (v) return v;
  }
  return firstFromSrcset(img.getAttribute?.('data-srcset') || img.getAttribute?.('srcset'));
}

function extractImageSrc(el) {
  if (!el) return null;
  const tag = el.tagName?.toLowerCase();
  if (tag === 'img') return lazyImgUrl(el);
  if (tag === 'source') {
    return (
      firstFromSrcset(el.getAttribute('srcset') || el.getAttribute('data-srcset')) ||
      el.getAttribute('src') ||
      el.getAttribute('data-src') ||
      null
    );
  }
  const img = el.querySelector?.('img');
  if (img) {
    const fromImg = lazyImgUrl(img);
    if (fromImg) return fromImg;
  }
  const source = el.querySelector?.('source[srcset]');
  if (source) {
    const fromSource = firstFromSrcset(source.getAttribute('srcset'));
    if (fromSource) return fromSource;
  }
  try {
    const bg = window.getComputedStyle(el).backgroundImage;
    const match = bg && bg !== 'none' ? bg.match(/url\(["']?(.*?)["']?\)/) : null;
    if (match && match[1]) return match[1];
  } catch {
    /* getComputedStyle unavailable */
  }
  return el.currentSrc || el.src || el.getAttribute?.('src') || null;
}

function pairLowestCommonAncestor(a, b) {
  if (!a || !b) return null;
  const ancestors = new Set();
  let cur = a;
  while (cur) { ancestors.add(cur); cur = cur.parentElement; }
  cur = b;
  while (cur) { if (ancestors.has(cur)) return cur; cur = cur.parentElement; }
  return null;
}

function lowestCommonAncestor(elements) {
  if (!elements || !elements.length) return null;
  let lca = elements[0];
  for (let i = 1; i < elements.length && lca; i += 1) {
    lca = pairLowestCommonAncestor(lca, elements[i]);
  }
  return lca || document.body;
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
  normalized.itemSignature = normalized.itemSignature || null;
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
  // Mirror userscript: a non-class attribute (e.g. a shared data-parent container pointer)
  // is only identity evidence when the recipe's class also matches the candidate.
  const targetClass = (locator.attrs || {}).class;
  const classGatePasses =
    !targetClass ||
    candidateAttrs.class === targetClass ||
    classTokensOverlap(candidateAttrs.class, targetClass);
  for (const [key, value] of Object.entries(locator.attrs || {})) {
    if (candidateAttrs[key] === value) {
      score += 6;
      if (key === 'class' || classGatePasses) evidence += 5;
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
  if (browse.itemSignature) {
    return Array.from(document.querySelectorAll('*')).filter(
      (el) => isVisible(el) && elementItemSignature(el) === browse.itemSignature,
    );
  }
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

// --- Fragmented grid (Zara-style): product tiles are NOT direct siblings under one
// container. They are scattered across many sibling "block" containers, sit at varying
// depth, and a couple carry an extra badge node. A signature-based browse config must
// still enumerate every tile across all blocks (the bug was getting only one block's
// worth), while NOT pulling in an adjacent carousel block that uses a different tile class.
function tile(href, extraBadge = false) {
  return `
    <li class="product-grid-product _product secondary-product zoom1-columns" data-productkey="123-456-e1">
      <div class="product-grid-product__figure">
        <a class="product-link" href="${href}"><img src="x.jpg"></a>
        <div class="product-grid-product-info">Scented Candle 200 G 15.99 GBP</div>
        ${extraBadge ? '<div class="product-badge">New</div>' : ''}
      </div>
    </li>`;
}
function carouselTile(href) {
  return `
    <div class="zds-carousel-item">
      <div class="product-grid-product _product carousel__product zoom1-columns" data-productkey="789-111-e1">
        <a class="product-link" href="${href}"><img src="y.jpg"></a>
        <div class="product-grid-product-info">Carousel Candle 100 G 9.99 GBP</div>
      </div>
    </div>`;
}
// 13 secondary blocks (8 + 8 + ... + 6 tiles), each block a separate <ul> container.
const blockSizes = [8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 7, 6];
let tileIndex = 0;
const blocks = blockSizes
  .map((n) => {
    const lis = Array.from({ length: n }, () => {
      tileIndex += 1;
      // every ~10th tile carries the extra badge node
      return tile(`https://shop.example.com/p/candle-${tileIndex}`, tileIndex % 10 === 0);
    }).join('');
    return `<li class="product-grid-block"><ul class="secondary-products-container">${lis}</ul></li>`;
  })
  .join('');
const totalSecondary = blockSizes.reduce((a, b) => a + b, 0);
const carousel = `<li class="dynamic-carousel">${Array.from({ length: 5 }, (_, i) => carouselTile(`https://shop.example.com/p/carousel-${i}`)).join('')}</li>`;

setDom(
  `<main><div class="products-category-grid"><ul class="product-grid__product-list">${blocks}${carousel}</ul></div></main>`,
  'shop.example.com',
);

const sampleTile = document.querySelector('li.secondary-product');
const fragSignature = elementItemSignature(sampleTile);
const fragBrowse = normalizeBrowseConfig({
  itemSignature: fragSignature,
  container: { version: 1, tag: 'ul', anchorAttrs: { class: 'product-grid__product-list' }, relativePathFromAnchor: '' },
  linkRule: { version: 1, selector: 'a[href]', strategy: 'href' },
});

const fragItems = enumerateBrowseItems(fragBrowse);
const fragUrls = collectProductUrls(fragBrowse);
const largestBlock = Math.max(...blockSizes);

if (fragItems.length !== totalSecondary) {
  fail('fragmented grid did not enumerate every tile across blocks', { got: fragItems.length, expected: totalSecondary });
}
if (fragItems.length <= largestBlock) {
  fail('fragmented grid only saw a single block (the original bug)', { got: fragItems.length, largestBlock });
}
if (fragItems.some((el) => el.className.includes('carousel__product'))) {
  fail('fragmented grid pulled in the adjacent carousel block (different tile class)');
}
if (new Set(fragUrls).size !== totalSecondary) {
  fail('fragmented grid produced wrong unique URL count', { urls: new Set(fragUrls).size, expected: totalSecondary });
}
console.log(`PASS: fragmented grid merges ${fragItems.length} tiles across ${blockSizes.length} blocks (largest block: ${largestBlock}), excludes carousel`);

// --- Image extraction reads the live src per element carrier. A saved image selection
// frequently anchors on a <picture> or <source> (which have no `src`); a naive attribute
// read returns null, which previously fell back to the stale config-time URL and stamped
// one product's image onto every product. extractImageSrc must resolve a real URL from
// each carrier so each product yields its own image.
setDom(
  `<main>
    <img class="hero" src="https://cdn.example.com/p1/main.jpg">
    <picture class="media-image"><source srcset="https://cdn.example.com/p1/alt.webp 1x"><img src="https://cdn.example.com/p1/alt.jpg"></picture>
    <picture class="srcset-only"><source srcset="https://cdn.example.com/p1/only.webp 1x, https://cdn.example.com/p1/only-2x.webp 2x"></picture>
    <source class="bare" srcset="https://cdn.example.com/p1/bare.webp 1x">
    <img class="lazy" data-load="false" data-src="https://cdn.example.com/p1/lazy.png" data-image="https://cdn.example.com/p1/lazy.png">
    <img class="lazy-srcset" data-srcset="https://cdn.example.com/p1/lazy-1.png 1x, https://cdn.example.com/p1/lazy-2.png 2x">
  </main>`,
  'shop.example.com',
);
const imgSrc = extractImageSrc(document.querySelector('img.hero'));
if (imgSrc !== 'https://cdn.example.com/p1/main.jpg') fail('extractImageSrc did not read <img> src', imgSrc);
const pictureSrc = extractImageSrc(document.querySelector('picture.media-image'));
if (pictureSrc !== 'https://cdn.example.com/p1/alt.jpg') fail('extractImageSrc did not read descendant <img> of <picture>', pictureSrc);
const srcsetSrc = extractImageSrc(document.querySelector('picture.srcset-only'));
if (srcsetSrc !== 'https://cdn.example.com/p1/only.webp') fail('extractImageSrc did not fall back to <source> srcset', srcsetSrc);
const bareSource = extractImageSrc(document.querySelector('source.bare'));
if (bareSource !== 'https://cdn.example.com/p1/bare.webp') fail('extractImageSrc did not read <source> srcset', bareSource);
// Lazy-loaded <img> (Squarespace/lazysizes): real URL only in data-src/data-image until scrolled into view.
const lazySrc = extractImageSrc(document.querySelector('img.lazy'));
if (lazySrc !== 'https://cdn.example.com/p1/lazy.png') fail('extractImageSrc did not fall back to lazy data-src', lazySrc);
const lazySrcset = extractImageSrc(document.querySelector('img.lazy-srcset'));
if (lazySrcset !== 'https://cdn.example.com/p1/lazy-1.png') fail('extractImageSrc did not fall back to lazy data-srcset', lazySrcset);
if (extractImageSrc(null) !== null) fail('extractImageSrc(null) should be null');
console.log('PASS: extractImageSrc resolves a live URL from <img>, <picture>, <source>, and lazy-loaded carriers');

// --- Acqua di Parma accordion: sibling panels share data-parent="#productInfoSection",
// distinguished only by class (tab-more-information vs tab-tasting-notes). Self-contained
// (the live config lives under the gitignored sites/, so the recipes are inlined here).
const adpDescLocator = normalizeLocatorRecipe({
  version: 1,
  tag: 'div',
  attrs: { class: 'collapse-content tab-more-information text-m longDescription', 'data-parent': '#productInfoSection' },
  anchorAttrs: { class: 'collapse-content tab-more-information text-m longDescription', 'data-parent': '#productInfoSection' },
  relativePathFromAnchor: '',
  textSample: 'Diffuse enchanting scents for a sensuous yet fresh awakening to your day.',
});
const adpNoteLocator = normalizeLocatorRecipe({
  version: 1,
  tag: 'div',
  attrs: { class: 'collapse-content tab-tasting-notes text-m collapse', 'data-parent': '#productInfoSection' },
  anchorAttrs: { class: 'collapse-content tab-tasting-notes text-m collapse', 'data-parent': '#productInfoSection' },
  relativePathFromAnchor: '',
  textSample: 'Olfactive family: Aromatic green Tasting Notes: Italian lemon, mint leaves, rosemary.',
});

// Product WITH both panels: description and tasting notes must resolve independently,
// even though the tasting-notes panel is collapsed (display:none in the live DOM).
setDom(
  `<main><div id="productInfoSection">
    <div class="accordion-item">
      <div class="collapse-content tab-more-information text-m longDescription" data-parent="#productInfoSection">Diffuse enchanting scents for a sensuous yet fresh awakening to your day. As the first rays of the morning light filter through, this candle fills your home with a luminous fragrance.</div>
    </div>
    <div class="accordion-item">
      <div class="collapse-content tab-tasting-notes text-m collapse" data-parent="#productInfoSection" style="display:none">Olfactive family: Aromatic green Tasting Notes: Italian lemon, mint leaves, rosemary, lavandin, jasmine, cedarwood, musk.</div>
    </div>
  </div></main>`,
  'www.acquadiparma.com',
);

const adpDescEl = findLocator(adpDescLocator);
const adpNoteEl = findLocator(adpNoteLocator);
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

// Product WITHOUT a tasting-notes panel (decorative cubes, sets, bases): note_name must
// NOT fall back to the description panel just because it shares data-parent. This is the
// regression that duplicated the description into note_name across ~8 products.
setDom(
  `<main><div id="productInfoSection">
    <div class="accordion-item">
      <div class="collapse-content tab-more-information text-m longDescription" data-parent="#productInfoSection">A unique candle entirely hand crafted. The sophisticated black wax cube candle is delicately embossed with the Acqua di Parma logo.</div>
    </div>
  </div></main>`,
  'www.acquadiparma.com',
);

const adpDescOnlyEl = findLocator(adpDescLocator);
const adpNoteAbsentEl = findLocator(adpNoteLocator);
if (!adpDescOnlyEl || !normalizeText(adpDescOnlyEl.textContent).startsWith('A unique candle')) {
  fail('acquadiparma description recipe did not resolve on notes-less product', normalizeText(adpDescOnlyEl?.textContent || '').slice(0, 60));
}
if (adpNoteAbsentEl) {
  fail('acquadiparma note_name fell back to a sibling panel when tasting notes were absent', normalizeText(adpNoteAbsentEl.textContent).slice(0, 60));
}
console.log('PASS: acquadiparma note_name stays empty when the tasting-notes panel is absent');

console.log('\nAll recipe checks passed.');
