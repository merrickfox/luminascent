// Node-side recipe resolver.
//
// This is the offline mirror of the browser userscript's locator/browse logic
// (`userscript/src/03-locator.js` + `04-browse.js`), recipe-mode only — which is
// the only mode saved configs use. It was previously inlined inside
// `scripts/verify-recipes.mjs`; it now lives here so both that regression harness
// AND the local server's `/recipe/preview` endpoint resolve recipes the same way,
// against a `linkedom`-parsed saved DOM, with NO third copy to drift.
//
// Callers MUST set `globalThis.document` / `globalThis.window` / `globalThis.location`
// from a parsed DOM before invoking (see `withDom` below) — the functions read those
// globals, exactly as the userscript reads the live page.

import { parseHTML } from 'linkedom';

function cssEscape(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

// In a headless DOM every element is "visible"; the userscript's visibility filter
// (offsetParent/display checks) has no meaning without layout, so we keep everything.
function isVisible() {
  return true;
}

export function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

const INSTANCE_ATTR_PATTERNS = [
  /^id$/i, /^data-id$/i, /^data-product-id$/i, /^data-price-amount$/i,
  /^data-product-base-price$/i, /^data-price$/i,
  /^data-option-selected$/i, /^data-attribute-id$/i, /^href$/i, /^src$/i,
  /^title$/i, /^alt$/i,
];

export function isLumiscrapeToken(token) {
  return /^lumiscrape-/.test(String(token || ''));
}

export function isInstanceSpecificAttr(name, value) {
  if (INSTANCE_ATTR_PATTERNS.some((pattern) => pattern.test(name))) return true;
  if (name.startsWith('data-') && /^\d+$/.test(String(value || '').trim())) return true;
  if (/^data-.*price/i.test(name) && /^[\d.]+$/.test(String(value || '').trim())) return true;
  if (name === 'class' && /\d{3,}/.test(String(value || ''))) return true;
  return false;
}

function isChromeRegion(el) {
  if (!el) return false;
  return !!el.closest('nav, header, footer, [role="navigation"], [role="banner"], [role="contentinfo"]');
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

export function filterRecipeAttrs(attrs) {
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

export function elementItemSignature(el) {
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

function isPlaceholderSrc(value) {
  if (!value) return true;
  return /^data:/i.test(String(value).trim());
}

function lazyImgUrl(img) {
  if (!img) return null;
  const live = img.currentSrc || img.src || img.getAttribute('src');
  if (live && !isPlaceholderSrc(live)) return live;
  const dataAttrs = ['data-src', 'data-image', 'data-original', 'data-lazy-src', 'data-lazy'];
  for (const attr of dataAttrs) {
    const v = img.getAttribute?.(attr);
    if (v && !isPlaceholderSrc(v)) return v;
  }
  const fromSrcset = firstFromSrcset(img.getAttribute?.('data-srcset') || img.getAttribute?.('srcset'));
  if (fromSrcset && !isPlaceholderSrc(fromSrcset)) return fromSrcset;
  return live || null;
}

export function normalizeImageUrl(raw) {
  if (!raw) return raw;
  let url = String(raw).trim();
  if (!url || url.startsWith('data:')) return url || raw;
  url = url.replace(/\{width\}/gi, '1024').replace(/\{height\}/gi, '1024');
  try {
    return new URL(url, location.href).href;
  } catch {
    return url;
  }
}

export function extractImageSrc(el) {
  const raw = rawImageSrc(el);
  return raw == null ? raw : normalizeImageUrl(raw);
}

function rawImageSrc(el) {
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

export function queryByAttrs(root, attrs) {
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

export function normalizeBrowseConfig(browse) {
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

export function normalizeLocatorRecipe(locator) {
  if (!locator) return locator;
  return {
    ...locator,
    matchMode: 'recipe',
    anchor: null,
    attrs: filterRecipeAttrs(locator.attrs),
    anchorAttrs: filterRecipeAttrs(locator.anchorAttrs),
  };
}

export function getFieldLocators(field) {
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

// Mirror of userscript structuralTailOverlapTolerant — contiguous tail align
// with up to maxSkips wrapper indels (zoom/gallery/lightbox shift), no
// substitutions, so unrelated branches score ~0.
function structuralTailOverlapTolerant(targetPath, currentPath, maxSkips) {
  if (!targetPath || !currentPath) return 0;
  const a = targetPath.split(' > ');
  const b = currentPath.split(' > ');
  let ti = a.length - 1;
  let ci = b.length - 1;
  let matched = 0;
  let skips = 0;
  while (ti >= 0 && ci >= 0) {
    if (a[ti] === b[ci]) { matched += 1; ti -= 1; ci -= 1; }
    else if (skips < maxSkips && ti - 1 >= 0 && a[ti - 1] === b[ci]) { ti -= 1; skips += 1; }
    else if (skips < maxSkips && ci - 1 >= 0 && a[ti] === b[ci - 1]) { ci -= 1; skips += 1; }
    else break;
  }
  return matched;
}

function scoreLocatorMatch(candidate, locator, options = {}) {
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
    const candidatePath = buildStructuralPath(candidate);
    const overlap = structuralTailOverlap(locator.structuralPath, candidatePath);
    score += overlap * 2;
    if (overlap >= 2) {
      evidence += Math.min(overlap, 5);
    } else if (options.allowTolerantPath) {
      const tolerant = structuralTailOverlapTolerant(locator.structuralPath, candidatePath, 2);
      if (tolerant >= 4) {
        score += tolerant * 2;
        evidence += Math.min(tolerant, 5);
      }
    }
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
  if (isChromeRegion(candidate)) score -= 8;
  if (isProductDetailPrice(candidate)) score += 8;
  if (isRecommendationRegion(candidate)) score -= 10;

  return { score, evidence };
}

const LOCATOR_EVIDENCE_THRESHOLD = 5;

export function findLocator(locator, root = document) {
  if (!locator) return null;
  const candidates = new Set();

  if (locator.anchorAttrs && Object.keys(locator.anchorAttrs).length) {
    const anchorMatches = resolveAllFromAnchorPath(root, locator, locator.tag);
    if (anchorMatches.length === 1) return anchorMatches[0];
    anchorMatches.forEach((el) => candidates.add(el));
  }

  queryByAttrs(root, locator.attrs).forEach((el) => candidates.add(el));
  if (locator.tag) root.querySelectorAll(locator.tag).forEach((el) => candidates.add(el));

  const pickBest = (scoreOptions) => {
    let best = null;
    let bestScore = -Infinity;
    for (const candidate of candidates) {
      const { score, evidence } = scoreLocatorMatch(candidate, locator, scoreOptions);
      if (evidence < LOCATOR_EVIDENCE_THRESHOLD) continue;
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    return best;
  };

  const best = pickBest({});
  if (best) return best;
  if (!isMediaLocator(locator)) return null;
  return pickBest({ allowTolerantPath: true });
}

function isMediaLocator(locator) {
  const tag = (locator.tag || '').toLowerCase();
  if (tag === 'img' || tag === 'source' || tag === 'picture') return true;
  const ex = locator.extraction;
  return !!(ex && ex.type === 'attribute' && /^(src|currentsrc|srcset)$/i.test(ex.attribute || ''));
}

// Mirror of the userscript's extractValue: read text, or an attribute when the
// recipe says so. When no extraction rule is present (older configs), default to
// text — the common case for product fields.
export function extractValue(el, extraction) {
  if (!el) return null;
  const rule = extraction || { type: 'text' };
  if (rule.type === 'attribute') {
    const attr = rule.attribute || 'href';
    if (attr === 'src' || attr === 'currentSrc') {
      return el.currentSrc || el.src || el.getAttribute('src') || null;
    }
    return el.getAttribute(attr);
  }
  return normalizeText(el.textContent);
}

export function enumerateBrowseItems(browse) {
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

export function resolveLinkFromItem(itemEl, linkRule) {
  const links = Array.from(itemEl.querySelectorAll(linkRule.selector)).filter((link) => {
    if (!link.href || link.href.startsWith('javascript:') || link.href.startsWith('#')) return false;
    return true;
  });
  return links[0]?.href || null;
}

export function collectProductUrls(browse) {
  return enumerateBrowseItems(browse)
    .map((item) => resolveLinkFromItem(item, browse.linkRule))
    .filter(Boolean);
}

// Parse `html` into a DOM, install the globals the resolver functions read, run
// `fn(document)`, and restore the previous globals. This is the only seam the
// server / tests need — everything above operates on the installed globals.
export function withDom(html, hostname, fn) {
  const { document, window } = parseHTML(html);
  const prev = {
    document: globalThis.document,
    window: globalThis.window,
    location: globalThis.location,
  };
  globalThis.document = document;
  globalThis.window = window;
  globalThis.location = { hostname, href: `https://${hostname}/` };
  try {
    return fn(document);
  } finally {
    globalThis.document = prev.document;
    globalThis.window = prev.window;
    globalThis.location = prev.location;
  }
}
