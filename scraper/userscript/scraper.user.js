// ==UserScript==
// @name         Luminascent Scraper
// @namespace    https://luminascent.local/scraper
// @version      1.7.0
// @description  Blueprint-driven visual scraper for product sites
// @author       Luminascent
// @match        *://*/*
// @connect      localhost
// @connect      127.0.0.1
// @connect      *
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_openInTab
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  console.log('[Luminascent] scraper bundle — src last modified 2026-06-19 13:33:13 BST');

  const SERVER = 'http://127.0.0.1:8777';
  const SCRAPE_HASH = '#lumiscrape=1';
  const EXTRACT_KEY = 'lumiscrape_extract_state';
  const EXTRACT_PREFS_KEY = 'lumiscrape_extract_prefs';
  const EXCLUDED_HOSTS_KEY = 'lumiscrape_excluded_hosts';
  // Child tabs report their outcome to a unique per-URL key under this prefix.
  // The controller tab is the sole writer of EXTRACT_KEY; it drains these keys
  // each tick. Unique keys mean two tabs never clobber each other's result.
  const RESULT_PREFIX = 'lumiscrape_result:';
  const BATCH_TIMEOUT_MS = 90000;
  // Grace after a tab closes with no result written before we call it failed,
  // instead of waiting out the full batch timeout.
  const CLOSE_GRACE_MS = 5000;
  const LOG_MAX = 50;

  // Controller-tab-local: when each opened tab fires onclose, in ms. Used to
  // detect tabs that vanished without reporting (crash, navigation, hibernation).
  const closedAtByUrl = new Map();
  // Child-tab-local: guards against double-reporting (success + pagehide).
  let childReported = false;

  const state = {
    mode: 'start',
    host: location.hostname,
    schema: null,
    config: null,
    hasConfig: false,
    browseCandidates: [],
    selectedBrowseGroupId: null,
    highlightEls: [],
    selectedElement: null,
    pendingTagElement: null,
    pendingTagPreview: '',
    lastTaggedMessage: '',
    pendingContainmentAdd: null,
    pendingRetagFieldKey: null,
    pendingAddTagFieldKey: null,
    imageCandidates: [],
    imageSelections: [],
    extractRunning: false,
    extractMode: 'all',
    extractBatchSize: 5,
    extractGapSeconds: 0,
    // Sub-selection within a browse grid: URLs the user has unchecked for this
    // page. Empty/absent = extract everything (preserves default behavior).
    extractDeselected: null,
    extractRefineOpen: false,
    extractItems: [],
    adhocStatus: '',
    browseScanStatus: 'idle',
  };

  let shadowRoot = null;
  let panelEl = null;
  let highlightLayer = null;
  let contextMenuEl = null;
  let mutationObserver = null;
  let browseWatchObserver = null;
  let browseDetectTimer = null;
  let browseDetectRunning = false;
  let extractController = false;

  const STABLE_ATTRS = [
    'id',
    'name',
    'role',
    'aria-label',
    'itemprop',
    'data-testid',
    'data-test',
    'data-ui-id',
    'data-dynamic',
    'data-block-id',
    'data-attribute-code',
    'data-price-type',
    'data-gallery-role',
    'data-role',
  ];

  const RECIPE_ATTRS = [
    'itemprop',
    'role',
    'name',
    'data-ui-id',
    'data-dynamic',
    'data-block-id',
    'data-testid',
    'data-test',
    'data-attribute-code',
    'data-price-type',
    'data-gallery-role',
    'data-role',
    'ku-block',
    'ku-product-block',
  ];

  function gmRequest(options) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: options.method || 'GET',
        url: options.url,
        headers: options.headers || { 'Content-Type': 'application/json' },
        data: options.data,
        responseType: options.responseType || 'text',
        onload(response) {
          resolve(response);
        },
        onerror(error) {
          reject(error);
        },
      });
    });
  }

  async function apiGet(path) {
    const response = await gmRequest({ url: `${SERVER}${path}` });
    if (response.status >= 400) {
      const err = new Error(`GET ${path} failed (${response.status})`);
      err.status = response.status;
      err.body = response.responseText;
      throw err;
    }
    return JSON.parse(response.responseText);
  }

  async function apiPost(path, body) {
    const response = await gmRequest({
      method: 'POST',
      url: `${SERVER}${path}`,
      data: JSON.stringify(body),
    });
    if (response.status >= 400) {
      throw new Error(`POST ${path} failed (${response.status}): ${response.responseText}`);
    }
    return JSON.parse(response.responseText);
  }

  function cssEscape(value) {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  function normalizeText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function isVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function getStableAttributes(el) {
    const attrs = {};
    if (!el || !el.attributes) return attrs;

    for (const attr of STABLE_ATTRS) {
      const value = el.getAttribute(attr);
      if (value) attrs[attr] = value;
    }

    for (const attr of el.attributes) {
      if (attr.name.startsWith('data-') && !attrs[attr.name]) {
        attrs[attr.name] = attr.value;
      }
    }

    return attrs;
  }

  function elementFingerprint(el) {
    if (!el || el.nodeType !== 1) return '';
    const tag = el.tagName.toLowerCase();
    const attrs = getStableAttributes(el);
    const attrKeys = Object.keys(attrs).sort().slice(0, 4);
    const attrPart = attrKeys.map((k) => `${k}=${attrs[k]}`).join('|');
    const childTags = Array.from(el.children)
      .slice(0, 6)
      .map((child) => child.tagName.toLowerCase())
      .join(',');
    return `${tag}[${attrPart}]{${childTags}}`;
  }

  const INSTANCE_ATTR_PATTERNS = [
    /^id$/i,
    /^data-id$/i,
    /^data-product-id$/i,
    /^data-sku$/i,
    /^data-entity-id$/i,
    /^data-item-id$/i,
    /^data-record-id$/i,
    /^data-index$/i,
    /^data-position$/i,
    /^data-pos$/i,
    /^data-uuid$/i,
    /^data-guid$/i,
    /^data-key$/i,
    /^data-price-amount$/i,
    /^data-product-base-price$/i,
    /^data-price$/i,
    /^data-option-selected$/i,
    /^data-attribute-id$/i,
    /^aria-controls$/i,
    /^for$/i,
    /^href$/i,
    /^src$/i,
    /^style$/i,
    /^origin$/i,
    /^onerror$/i,
    /^title$/i,
    /^alt$/i,
  ];

  function isLumiscrapeToken(token) {
    return /^lumiscrape-/.test(String(token || ''));
  }

  function isInstanceSpecificAttr(name, value) {
    if (INSTANCE_ATTR_PATTERNS.some((pattern) => pattern.test(name))) return true;
    if (name.startsWith('data-') && /^\d+$/.test(String(value || '').trim())) return true;
    if (/^data-.*price/i.test(name) && /^[\d.]+$/.test(String(value || '').trim())) return true;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''))) {
      return true;
    }
    if (name === 'class' && /\b(?:slick-|swiper-|slide|cloned|active|current|selected|hover|focus|wishlist-item-icon)\b/i.test(value)) {
      return true;
    }
    if (name === 'class' && /\d{3,}/.test(String(value || ''))) return true;
    return false;
  }

  function filterRecipeAttrs(attrs) {
    if (!attrs) return {};
    const out = {};
    for (const [key, value] of Object.entries(attrs)) {
      if (!value || isInstanceSpecificAttr(key, value)) continue;
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

  function classTokensOverlap(candidateValue, targetValue) {
    const candidateTokens = new Set(String(candidateValue || '').split(/\s+/).filter(Boolean));
    const targetTokens = String(targetValue || '').split(/\s+/).filter(Boolean);
    if (!targetTokens.length) return false;
    return targetTokens.every((token) => candidateTokens.has(token));
  }

  function getRecipeAttributes(el) {
    const attrs = {};
    if (!el?.attributes) return attrs;

    for (const name of RECIPE_ATTRS) {
      const value = el.getAttribute(name);
      if (value && !isInstanceSpecificAttr(name, value)) {
        attrs[name] = value;
      } else if (el.hasAttribute(name) && !value) {
        attrs[name] = '';
      }
    }

    if (el.classList?.length) {
      const tokens = Array.from(el.classList)
        .filter((token) => !/\d{3,}/.test(token))
        .filter((token) => !isLumiscrapeToken(token))
        .filter((token) => !/\b(?:active|current|selected|hover|focus|cloned|slick-|swiper-)\b/i.test(token))
        .slice(0, 4);
      if (tokens.length) attrs.class = tokens.join(' ');
    }

    for (const attr of el.attributes) {
      const name = attr.name;
      const value = attr.value;
      if (attrs[name] != null) continue;
      if (!name.startsWith('data-') && name !== 'itemprop' && name !== 'role') continue;
      if (isInstanceSpecificAttr(name, value)) continue;
      attrs[name] = value;
    }

    return attrs;
  }

  function findRecipeStableAncestor(el, maxDepth = 10) {
    let current = el;
    let depth = 0;
    while (current && current !== document.body && depth < maxDepth) {
      const attrs = getRecipeAttributes(current);
      if (Object.keys(attrs).length > 0) {
        return { element: current, attrs };
      }
      current = current.parentElement;
      depth += 1;
    }
    return { element: document.body, attrs: {} };
  }

  function normalizeTypeAttrValue(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/\d+/g, '#')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 48);
  }

  function elementTypeFingerprint(el) {
    if (!el || el.nodeType !== 1) return '';

    const tag = el.tagName.toLowerCase();
    const typeAttrs = [];

    for (const attr of el.attributes) {
      const name = attr.name;
      const value = attr.value;
      if (isInstanceSpecificAttr(name, value)) continue;

      if (name === 'class') {
        const tokens = String(value || '')
          .split(/\s+/)
          .filter(Boolean)
          .filter((token) => !/\d{3,}/.test(token))
          .filter((token) => !isLumiscrapeToken(token))
          .slice(0, 4)
          .map((token) => normalizeTypeAttrValue(token));
        if (tokens.length) typeAttrs.push(`class~${tokens.sort().join('.')}`);
        continue;
      }

      if (!value || value === name) {
        typeAttrs.push(name);
      } else {
        typeAttrs.push(`${name}~${normalizeTypeAttrValue(value)}`);
      }
    }

    typeAttrs.sort();

    const childTags = Array.from(el.children)
      .slice(0, 8)
      .map((child) => child.tagName.toLowerCase())
      .join(',');

    const childCount = Math.min(Array.from(el.children).length, 24);

    return `${tag}[${typeAttrs.slice(0, 8).join('|')}]{${childTags}}@${childCount}`;
  }

  // A "type fingerprint" keys an element on its full structure (tag, attrs, child
  // tags AND child count). That over-splits a grid: two visually identical tiles
  // fragment apart when one carries an extra badge/swatch/sold-out node, and tiles
  // in different layout blocks (carousel vs grid) never merge. The item *signature*
  // keys only on the stable identity an element advertises — its non-instance class
  // tokens and type-level data/role/itemprop attrs — so repeated members of the same
  // logical grid share a signature regardless of where they sit or minor per-tile DOM
  // differences. Structural shape is used only as a fallback for class-less items.
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

    for (const attr of el.attributes) {
      const { name, value } = attr;
      if (name === 'class') continue;
      if (isInstanceSpecificAttr(name, value)) continue;
      if (name.startsWith('data-') || name === 'role' || name === 'itemprop') {
        if (!value || value === name) {
          tokens.push(name);
          continue;
        }
        // A value carrying digits is an instance identifier (product key, index,
        // price) whose exact shape varies per item — even normalized, the digit
        // pattern can differ and split otherwise-identical tiles apart. Keep the
        // attribute *name* as a type signal, but drop its varying value.
        const normalized = normalizeTypeAttrValue(value);
        tokens.push(normalized.includes('#') ? name : `${name}~${normalized}`);
      }
    }

    if (tokens.length) {
      tokens.sort();
      return `${tag}[${tokens.join('|')}]`;
    }

    // Class-less / attr-less items: fall back to structural shape, but drop the child
    // count so a stray extra/missing child doesn't split otherwise-identical members.
    const childTags = Array.from(el.children)
      .slice(0, 6)
      .map((child) => child.tagName.toLowerCase())
      .join(',');
    if (!childTags) return '';
    return `${tag}{${childTags}}`;
  }

  function pairLowestCommonAncestor(a, b) {
    if (!a || !b) return null;
    const ancestors = new Set();
    let cur = a;
    while (cur) {
      ancestors.add(cur);
      cur = cur.parentElement;
    }
    cur = b;
    while (cur) {
      if (ancestors.has(cur)) return cur;
      cur = cur.parentElement;
    }
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

  function getMemberLinks(member) {
    return Array.from(member.querySelectorAll('a[href], [role="link"][href]')).filter((link) => {
      if (!link.href || link.href.startsWith('javascript:')) return false;
      if (link.href.startsWith('#')) return false;
      return true;
    });
  }

  function looksLikeProductMember(member) {
    const links = getMemberLinks(member);
    const hasImage = !!member.querySelector('img, picture, [style*="background-image"]');
    const text = normalizeText(member.textContent);
    const hasReasonableText = text.length >= 8 && text.length <= 500;
    const sameHostLinks = links.filter((link) => {
      try {
        return new URL(link.href).hostname === location.hostname;
      } catch {
        return false;
      }
    });

    let score = 0;
    if (hasImage) score += 2;
    if (hasReasonableText) score += 1;
    if (sameHostLinks.length > 0) score += 3;
    return score >= 3;
  }

  function scoreRepeatedGroup(container, members) {
    const links = members.flatMap((member) => getMemberLinks(member));
    const hrefLinks = links.filter((link) => link.href && !link.href.startsWith('javascript:'));
    const productLikeCount = members.filter(looksLikeProductMember).length;

    let score = members.length;
    if (hrefLinks.length >= members.length) score += 8;
    else if (hrefLinks.length >= Math.ceil(members.length * 0.6)) score += 5;
    else if (hrefLinks.length > 0) score += 2;

    score += Math.min(productLikeCount, members.length);

    if (isMainContentRegion(container)) score += 6;
    if (isChromeRegion(container)) score -= 10;

    return score;
  }

  function getNthOfType(el) {
    if (!el || !el.parentElement) return 1;
    const tag = el.tagName;
    let index = 1;
    for (const sibling of el.parentElement.children) {
      if (sibling.tagName === tag) {
        if (sibling === el) return index;
        index += 1;
      }
    }
    return 1;
  }

  function findStableAncestor(el, maxDepth = 8) {
    let current = el;
    let depth = 0;
    while (current && current !== document.body && depth < maxDepth) {
      const attrs = getStableAttributes(current);
      if (attrs.id || Object.keys(attrs).some((k) => k.startsWith('data-'))) {
        return { element: current, attrs };
      }
      current = current.parentElement;
      depth += 1;
    }
    return { element: document.body, attrs: {} };
  }

  function buildStructuralPath(el) {
    const segments = [];
    let current = el;
    let depth = 0;

    while (current && current !== document.body && depth < 12) {
      const tag = current.tagName.toLowerCase();
      const nth = getNthOfType(current);
      segments.unshift(`${tag}:nth-of-type(${nth})`);
      current = current.parentElement;
      depth += 1;
    }

    return segments.join(' > ');
  }

  function findNearbyLabel(el) {
    if (!el) return null;

    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy);
      if (labelEl) return normalizeText(labelEl.textContent);
    }

    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return normalizeText(ariaLabel);

    if (el.id) {
      const label = document.querySelector(`label[for="${cssEscape(el.id)}"]`);
      if (label) return normalizeText(label.textContent);
    }

    let sibling = el.previousElementSibling;
    let hops = 0;
    while (sibling && hops < 3) {
      const text = normalizeText(sibling.textContent);
      if (text && text.length <= 80) return text;
      sibling = sibling.previousElementSibling;
      hops += 1;
    }

    let parent = el.parentElement;
    hops = 0;
    while (parent && hops < 4) {
      const heading = parent.querySelector('h1,h2,h3,h4,h5,h6,dt,label,strong');
      if (heading && heading !== el && !el.contains(heading)) {
        const text = normalizeText(heading.textContent);
        if (text && text.length <= 80) return text;
      }
      parent = parent.parentElement;
      hops += 1;
    }

    return null;
  }

  function inferExtraction(el) {
    if (!el) return { type: 'text' };
    const tag = el.tagName.toLowerCase();

    if (tag === 'img') {
      return {
        type: 'attribute',
        attribute: el.currentSrc || el.src ? 'src' : 'currentSrc',
      };
    }

    if (tag === 'a' && el.href) {
      return { type: 'attribute', attribute: 'href' };
    }

    if (tag === 'meta' && el.content) {
      return { type: 'attribute', attribute: 'content' };
    }

    return { type: 'text' };
  }

  function buildLocator(el, options = {}) {
    if (!el) return null;

    const recipeMode = options.recipeMode !== false;
    const stable = recipeMode ? findRecipeStableAncestor(el) : findStableAncestor(el);
    const attrs = recipeMode ? getRecipeAttributes(el) : getStableAttributes(el);
    const textSample = normalizeText(el.textContent).slice(0, 120);
    const extraction = inferExtraction(el);

    return {
      version: 1,
      tag: el.tagName.toLowerCase(),
      attrs,
      anchor: recipeMode ? null : findNearbyLabel(el),
      textSample,
      matchMode: recipeMode ? 'recipe' : 'legacy',
      structuralPath: buildStructuralPath(el),
      anchorPath: stable.element === document.body ? null : buildStructuralPath(stable.element),
      anchorAttrs: stable.attrs,
      relativePathFromAnchor: stable.element === document.body
        ? buildStructuralPath(el)
        : buildRelativePath(stable.element, el),
      extraction,
      signals: {
        tag: el.tagName.toLowerCase(),
        attrs,
        anchor: recipeMode ? null : findNearbyLabel(el),
        textSample,
        structuralPath: buildStructuralPath(el),
      },
    };
  }

  function normalizeLocatorRecipe(locator) {
    if (!locator) return locator;
    return {
      ...locator,
      matchMode: 'recipe',
      anchor: null,
      attrs: filterRecipeAttrs(locator.attrs),
      anchorAttrs: filterRecipeAttrs(locator.anchorAttrs),
      signals: locator.signals
        ? {
            ...locator.signals,
            anchor: null,
            attrs: filterRecipeAttrs(locator.signals.attrs),
          }
        : undefined,
    };
  }

  function buildContainerRecipe(containerEl) {
    if (!containerEl) return null;

    const stable = findRecipeStableAncestor(containerEl);
    const relativePathFromAnchor = stable.element === containerEl
      ? ''
      : buildRelativePath(stable.element, containerEl);

    return {
      version: 1,
      tag: containerEl.tagName.toLowerCase(),
      anchorAttrs: stable.attrs,
      relativePathFromAnchor,
    };
  }

  function buildLinkRule(members) {
    const links = (members || []).flatMap((member) => getMemberLinks(member));
    const hrefLinks = links.filter((link) => link.href && !link.href.startsWith('javascript:'));
    const classCounts = new Map();

    hrefLinks.forEach((link) => {
      Array.from(link.classList || []).forEach((token) => {
        if (!token || /\d/.test(token)) return;
        classCounts.set(token, (classCounts.get(token) || 0) + 1);
      });
    });

    const memberCount = Math.max((members || []).length, 1);
    const commonClass = Array.from(classCounts.entries())
      .filter(([, count]) => count >= Math.ceil(memberCount * 0.6))
      .sort((a, b) => b[1] - a[1])[0]?.[0];

    const strategy = hrefLinks.length >= Math.ceil(memberCount * 0.6) ? 'href' : 'js-click';
    let selector = 'a[href]';
    if (commonClass) {
      selector = `a.${cssEscape(commonClass)}[href]`;
    } else if (strategy === 'js-click') {
      selector = '[role="link"], button, [onclick], [data-href]';
    }

    return {
      version: 1,
      selector,
      strategy,
    };
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

  function resolveBrowseContainer(browse) {
    if (!browse) return null;

    if (browse.container) {
      const resolved = resolveFromAnchorPath(document, browse.container, browse.container.tag);
      if (resolved) return resolved;
    }

    if (browse.containerLocator) {
      return findLocator(browse.containerLocator, document, { recipeMode: true });
    }

    return null;
  }

  function enumerateBrowseItems(browse) {
    if (!browse) return [];

    // Signature-based configs match members page-wide, mirroring how detection found
    // them. We deliberately do NOT scope to the saved container: a listing page can
    // hold several containers with the same anchor class (Zara renders a hidden
    // `--is-template` grid alongside the live one), and resolving to the first match
    // could trap the search inside an empty/hidden subtree and enumerate nothing. The
    // signature is specific enough to stand alone, and the visibility filter drops any
    // hidden template tiles that share it.
    if (browse.itemSignature) {
      return Array.from(document.querySelectorAll('*')).filter(
        (el) => isVisible(el) && elementItemSignature(el) === browse.itemSignature,
      );
    }

    // Legacy configs: items are the same-fingerprint direct children of the container.
    const container = resolveBrowseContainer(browse);
    if (!container) return [];

    const fingerprint = browse.itemFingerprint || browse.typeFingerprint || browse.fingerprint;
    if (fingerprint) {
      return Array.from(container.children).filter(
        (child) => isVisible(child) && elementTypeFingerprint(child) === fingerprint,
      );
    }

    return Array.from(container.children).filter(isVisible);
  }

  function normalizeBrowseConfig(browse) {
    if (!browse) return browse;

    const normalized = { ...browse };

    if (!normalized.container) {
      if (normalized.containerLocator) {
        normalized.container = {
          version: 1,
          tag: normalized.containerLocator.tag,
          anchorAttrs: filterRecipeAttrs(normalized.containerLocator.anchorAttrs),
          relativePathFromAnchor: normalized.containerLocator.relativePathFromAnchor || '',
        };
      }
    } else {
      normalized.container = {
        ...normalized.container,
        anchorAttrs: filterRecipeAttrs(normalized.container.anchorAttrs),
      };
    }

    normalized.itemSignature = normalized.itemSignature || null;

    normalized.itemFingerprint = normalized.itemFingerprint
      || normalized.typeFingerprint
      || normalized.fingerprint
      || null;

    if (!normalized.linkRule) {
      normalized.linkRule = {
        version: 1,
        selector: normalized.linkStrategy === 'js-click'
          ? '[role="link"], button, [onclick], [data-href]'
          : 'a[href]',
        strategy: normalized.linkStrategy || 'href',
      };
    }

    return normalized;
  }

  function normalizeConfigRecipes(config) {
    if (!config) return config;

    const normalized = { ...config };

    if (normalized.browse) {
      normalized.browse = normalizeBrowseConfig(normalized.browse);
    }

    if (normalized.product?.fields) {
      normalized.product = {
        ...normalized.product,
        fields: normalized.product.fields.map((field) => {
          const locators = Array.isArray(field.locators)
            ? field.locators
            : (field.locator ? [field.locator] : []);
          const next = {
            ...field,
            locators: locators.map((locator) => normalizeLocatorRecipe(locator)),
          };
          delete next.locator;
          return next;
        }),
      };
    }

    if (normalized.images) {
      normalized.images = normalized.images.map((image) => ({
        ...image,
        locator: normalizeLocatorRecipe(image.locator),
      }));
    }

    return normalized;
  }

  function buildRelativePath(root, target) {
    const segments = [];
    let current = target;

    while (current && current !== root && current !== document.body) {
      segments.unshift(`${current.tagName.toLowerCase()}:nth-of-type(${getNthOfType(current)})`);
      current = current.parentElement;
    }

    return segments.join(' > ');
  }

  function queryByAttrs(root, attrs) {
    if (!attrs || !Object.keys(attrs).length) return [];

    const parts = [];

    if (attrs.id) {
      parts.push(`#${cssEscape(attrs.id)}`);
    }

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

  function structuralTailOverlap(targetPath, currentPath) {
    if (!targetPath || !currentPath) return 0;
    const targetParts = targetPath.split(' > ');
    const currentParts = currentPath.split(' > ');
    const max = Math.min(targetParts.length, currentParts.length);
    let overlap = 0;
    for (let i = 1; i <= max; i += 1) {
      if (targetParts[targetParts.length - i] === currentParts[currentParts.length - i]) {
        overlap += 1;
      } else {
        break;
      }
    }
    return overlap;
  }

  // Returns { score, evidence }. `score` ranks candidates (region/visibility
  // included as tiebreakers); `evidence` counts only "real" matches (attrs,
  // resolved anchor path, structural tail, exact text) and gates acceptance so a
  // generic tag-in-main element can never win on region bonus alone.
  function scoreLocatorMatch(candidate, locator, options = {}) {
    if (!candidate || !locator) return { score: 0, evidence: 0 };
    const recipeMode = options.recipeMode || locator.matchMode === 'recipe';
    let score = 0;
    let evidence = 0;

    if (locator.tag && candidate.tagName.toLowerCase() === locator.tag) score += 2;

    const candidateAttrs = recipeMode ? getRecipeAttributes(candidate) : getStableAttributes(candidate);
    const targetAttrs = locator.attrs || {};
    // A class identifies an element; relational/structural attributes shared by siblings
    // (e.g. data-parent pointing at a common container) do not. When a recipe specifies a
    // class, only let other attribute matches count as identity *evidence* if the candidate
    // also matches that class — otherwise, when the real target is absent, a sibling that
    // merely shares a container pointer can clear the evidence gate and impersonate it.
    const targetClass = targetAttrs.class;
    const classGatePasses =
      !targetClass ||
      candidateAttrs.class === targetClass ||
      classTokensOverlap(candidateAttrs.class, targetClass);
    for (const [key, value] of Object.entries(targetAttrs)) {
      if (candidateAttrs[key] === value) {
        score += recipeMode ? 6 : 4;
        if (key === 'class' || classGatePasses) evidence += 5;
      } else if (key === 'class' && classTokensOverlap(candidateAttrs[key], value)) {
        score += recipeMode ? 4 : 2;
        evidence += 2;
      }
    }

    if (!recipeMode && locator.anchor) {
      const nearby = findNearbyLabel(candidate);
      if (nearby && nearby.toLowerCase() === locator.anchor.toLowerCase()) {
        score += 5;
        evidence += 4;
      } else if (nearby && nearby.toLowerCase().includes(locator.anchor.toLowerCase())) {
        score += 2;
        evidence += 1;
      }
    }

    // textSample is a positive, non-required signal. Field text (e.g. a
    // description) legitimately varies between products, so a mismatch is never
    // penalized.
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
      score += recipeMode ? overlap * 2 : overlap;
      if (overlap >= 2) evidence += Math.min(overlap, 5);
    }

    if (recipeMode && locator.relativePathFromAnchor && locator.anchorAttrs) {
      const resolved = resolveFromAnchorPath(document, {
        anchorAttrs: locator.anchorAttrs,
        relativePathFromAnchor: locator.relativePathFromAnchor,
      }, locator.tag);
      if (resolved === candidate) {
        score += 10;
        evidence += 8;
      }
    }

    if (recipeMode) {
      if (isMainContentRegion(candidate)) score += 5;
      if (isChromeRegion(candidate)) score -= 8;
      if (isProductDetailPrice(candidate)) score += 8;
      if (isRecommendationRegion(candidate)) score -= 10;
    }

    if (isVisible(candidate)) score += 1;

    return { score, evidence };
  }

  const LOCATOR_EVIDENCE_THRESHOLD = 5;

  function findLocator(locator, root = document, options = {}) {
    if (!locator) return null;

    const recipeMode = options.recipeMode || locator.matchMode === 'recipe';
    const candidates = new Set();

    if (recipeMode && locator.anchorAttrs && Object.keys(locator.anchorAttrs).length) {
      const anchorMatches = resolveAllFromAnchorPath(root, locator, locator.tag);
      if (anchorMatches.length === 1) return anchorMatches[0];
      anchorMatches.forEach((el) => candidates.add(el));
    }

    queryByAttrs(root, locator.attrs).forEach((el) => candidates.add(el));

    if (!recipeMode && locator.anchor) {
      root.querySelectorAll('h1,h2,h3,h4,h5,h6,label,dt,strong,span,p').forEach((el) => {
        const text = normalizeText(el.textContent);
        if (text && text.toLowerCase().includes(locator.anchor.toLowerCase())) {
          let sibling = el.nextElementSibling;
          if (sibling) candidates.add(sibling);
          if (el.parentElement) {
            Array.from(el.parentElement.children).forEach((child) => candidates.add(child));
          }
        }
      });
    }

    if (locator.tag) {
      root.querySelectorAll(locator.tag).forEach((el) => candidates.add(el));
    }

    if (locator.relativePathFromAnchor && locator.anchorAttrs) {
      const anchors = queryByAttrs(root, locator.anchorAttrs);
      for (const anchorEl of anchors) {
        try {
          const found = anchorEl.querySelector(locator.relativePathFromAnchor.replace(/ > /g, ' > '));
          if (found) candidates.add(found);
        } catch {
          /* ignore */
        }
      }
    }

    let best = null;
    let bestScore = -Infinity;

    for (const candidate of candidates) {
      const { score, evidence } = scoreLocatorMatch(candidate, locator, { recipeMode });
      if (evidence < LOCATOR_EVIDENCE_THRESHOLD) continue;
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    return best;
  }

  function extractValue(el, extraction) {
    if (!el) return null;
    const rule = extraction || inferExtraction(el);

    if (rule.type === 'attribute') {
      const attr = rule.attribute || 'href';
      if (attr === 'src' || attr === 'currentSrc') {
        return el.currentSrc || el.src || el.getAttribute('src') || null;
      }
      return el.getAttribute(attr);
    }

    return normalizeText(el.textContent);
  }

  // Resolve the live image URL from whatever element the image locator matched on the
  // current product page. A saved selection often anchors on a <picture> (or a wrapper)
  // rather than the <img> itself — those carry no `src`, so a plain attribute read
  // returns null and the caller would fall back to the stale config-time URL, stamping
  // the same image onto every product. Handle each carrier explicitly instead.
  function extractImageSrc(el) {
    if (!el) return null;
    const tag = el.tagName?.toLowerCase();

    if (tag === 'img') {
      return el.currentSrc || el.src || el.getAttribute('src') || null;
    }

    const firstFromSrcset = (srcset) => {
      if (!srcset) return null;
      const first = srcset.split(',')[0]?.trim().split(/\s+/)[0];
      return first || null;
    };

    if (tag === 'source') {
      return firstFromSrcset(el.getAttribute('srcset')) || el.getAttribute('src') || null;
    }

    // <picture> or a generic wrapper: prefer a descendant <img>, then a <source> srcset.
    const img = el.querySelector?.('img');
    if (img) {
      const fromImg = img.currentSrc || img.src || img.getAttribute('src');
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
      /* getComputedStyle unavailable (e.g. headless verify) */
    }

    return el.currentSrc || el.src || el.getAttribute?.('src') || null;
  }

  function clearHighlights() {
    state.highlightEls.forEach((el) => {
      el.classList.remove('lumiscrape-highlight');
      el.classList.remove('lumiscrape-highlight-strong');
    });
    state.highlightEls = [];
  }

  function highlightElements(elements, strong = false) {
    clearHighlights();
    elements.forEach((el) => {
      if (!el) return;
      el.classList.add(strong ? 'lumiscrape-highlight-strong' : 'lumiscrape-highlight');
      state.highlightEls.push(el);
    });
  }

  function detectRepeatedGroups() {
    const skipTags = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'PATH', 'IFRAME']);

    // Collect members by signature, but only admit an element when it appears as one
    // of >=3 same-signature siblings under some container. That sibling gate is what
    // keeps inner parts (a single figure/link per tile) from forming their own group —
    // they never repeat >=3 times under one parent. Keying on the signature then merges
    // those members page-wide, so a grid split across many layout blocks (Zara's
    // carousel + secondary + dynamic-grid blocks) collapses into one group instead of
    // one per block.
    const bySignature = new Map();

    document.querySelectorAll('*').forEach((container) => {
      if (skipTags.has(container.tagName)) return;
      if (!isVisible(container)) return;

      const children = Array.from(container.children).filter((child) => isVisible(child));
      if (children.length < 3) return;

      const signatureCounts = new Map();
      children.forEach((child) => {
        const sig = elementItemSignature(child);
        if (!sig) return;
        signatureCounts.set(sig, (signatureCounts.get(sig) || 0) + 1);
      });

      for (const [sig, count] of signatureCounts.entries()) {
        if (count < 3) continue;
        let set = bySignature.get(sig);
        if (!set) {
          set = new Set();
          bySignature.set(sig, set);
        }
        children.forEach((child) => {
          if (elementItemSignature(child) === sig) set.add(child);
        });
      }
    });

    const groups = [];

    for (const [sig, set] of bySignature.entries()) {
      const members = Array.from(set);
      if (members.length < 3) continue;

      const container = lowestCommonAncestor(members) || document.body;
      const score = scoreRepeatedGroup(container, members);
      if (score < 4) continue;

      const sampleText = normalizeText(members[0]?.textContent || '').slice(0, 60);

      groups.push({
        id: sig,
        container,
        members,
        itemSignature: sig,
        typeFingerprint: sig,
        fingerprint: sig,
        count: members.length,
        score,
        sampleText,
        containerRecipe: buildContainerRecipe(container),
        linkRule: buildLinkRule(members),
      });
    }

    return groups.sort((a, b) => b.score - a.score).slice(0, 15);
  }

  function getBrowseGroupById(groupId) {
    if (!groupId) return null;
    return state.browseCandidates.find((group) => group.id === groupId) || null;
  }

  function getSelectedBrowseGroup() {
    return getBrowseGroupById(state.selectedBrowseGroupId);
  }

  function showBrowseHighlights(group) {
    highlightElements(group?.members || [], true);
  }

  function restoreBrowseHighlights() {
    const selected = getSelectedBrowseGroup();
    if (selected) showBrowseHighlights(selected);
    else clearHighlights();
  }

  function selectBrowseGroup(group) {
    state.selectedBrowseGroupId = group?.id || null;
    if (group) showBrowseHighlights(group);
    else clearHighlights();
  }

  function browseStatusText() {
    return {
      idle: 'Idle',
      scanning: 'Scanning page…',
      watching: 'Content changed, re-scanning…',
      waiting: 'No groups yet — waiting for content to load',
      ready: `${state.browseCandidates.length} group(s) found`,
    }[state.browseScanStatus] || state.browseScanStatus;
  }

  function updateBrowsePanelStatus() {
    const statusEl = panelEl?.querySelector('#lumiscrape-browse-status');
    if (statusEl) statusEl.textContent = browseStatusText();
  }

  function updateBrowseSelectionUi() {
    if (!panelEl || state.mode !== 'browse') return;

    panelEl.querySelectorAll('[data-group-index]').forEach((itemEl) => {
      const index = Number(itemEl.getAttribute('data-group-index'));
      const group = state.browseCandidates[index];
      itemEl.classList.toggle('selected', !!(group && group.id === state.selectedBrowseGroupId));
    });

    const lockBtn = panelEl.querySelector('#lumiscrape-lock-browse');
    if (lockBtn) lockBtn.disabled = !state.selectedBrowseGroupId;
  }

  function isScraperOwnedMutation(mutation) {
    if (!(mutation.target instanceof Element)) return false;

    if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
      const el = mutation.target;
      return (
        el.classList.contains('lumiscrape-highlight')
        || el.classList.contains('lumiscrape-highlight-strong')
        || el.classList.contains('lumiscrape-selectable-hover')
      );
    }

    return mutation.target.closest?.('#lumiscrape-root') != null;
  }

  function mutationIsRelevantForBrowse(mutations) {
    return mutations.some((mutation) => !isScraperOwnedMutation(mutation));
  }

  function reconcileBrowseSelection() {
    if (state.selectedBrowseGroupId && !getBrowseGroupById(state.selectedBrowseGroupId)) {
      state.selectedBrowseGroupId = null;
    }
  }

  function waitForDomQuiet(timeoutMs = 10000, quietMs = 700) {
    return new Promise((resolve) => {
      let settled = false;
      let quietTimer = null;
      const observer = new MutationObserver(() => {
        clearTimeout(quietTimer);
        quietTimer = setTimeout(finish, quietMs);
      });

      const finish = () => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        clearTimeout(quietTimer);
        clearTimeout(maxTimer);
        resolve();
      };

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
      });

      quietTimer = setTimeout(finish, quietMs);
      const maxTimer = setTimeout(finish, timeoutMs);
    });
  }

  function stopBrowseWatch() {
    if (browseWatchObserver) {
      browseWatchObserver.disconnect();
      browseWatchObserver = null;
    }
    if (browseDetectTimer) {
      clearTimeout(browseDetectTimer);
      browseDetectTimer = null;
    }
  }

  function scheduleBrowseDetection(delayMs = 700) {
    if (state.mode !== 'browse') return;
    if (browseDetectTimer) clearTimeout(browseDetectTimer);
    browseDetectTimer = setTimeout(() => {
      runBrowseDetection({ quiet: false });
    }, delayMs);
  }

  function startBrowseWatch() {
    stopBrowseWatch();
    browseWatchObserver = new MutationObserver((mutations) => {
      if (!mutationIsRelevantForBrowse(mutations)) return;
      state.browseScanStatus = 'watching';
      updateBrowsePanelStatus();
      scheduleBrowseDetection(800);
    });

    browseWatchObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  async function runBrowseDetection(options = {}) {
    if (state.mode !== 'browse' || browseDetectRunning) return;

    browseDetectRunning = true;
    state.browseScanStatus = 'scanning';
    updateBrowsePanelStatus();

    try {
      if (options.quiet !== false) {
        await waitForDomQuiet(options.timeoutMs || 10000, options.quietMs || 700);
      }

      if (state.mode !== 'browse') return;

      state.browseCandidates = detectRepeatedGroups();
      reconcileBrowseSelection();
      state.browseScanStatus = state.browseCandidates.length ? 'ready' : 'waiting';
      renderPanel();
      restoreBrowseHighlights();
    } finally {
      browseDetectRunning = false;
    }
  }

  function resolveLinkFromItem(itemEl, linkRule) {
    if (!itemEl) return { type: 'none', url: null, element: null };

    const selector = linkRule?.selector;
    const strategy = linkRule?.strategy || 'href';

    if (selector && strategy !== 'js-click') {
      const matchedLinks = Array.from(itemEl.querySelectorAll(selector)).filter((link) => {
        if (!link.href || link.href.startsWith('javascript:') || link.href.startsWith('#')) return false;
        try {
          return new URL(link.href).hostname === location.hostname;
        } catch {
          return false;
        }
      });
      if (matchedLinks.length) {
        return { type: 'href', url: matchedLinks[0].href, element: matchedLinks[0] };
      }
    }

    const links = getMemberLinks(itemEl);
    if (links.length) {
      return { type: 'href', url: links[0].href, element: links[0] };
    }

    const anchor = itemEl.querySelector('a[href]') || (itemEl.matches('a[href]') ? itemEl : null);
    if (anchor && anchor.href && !anchor.href.startsWith('javascript:') && !anchor.href.startsWith('#')) {
      return { type: 'href', url: anchor.href, element: anchor };
    }

    const clickable = itemEl.querySelector('[role="link"], button, [onclick]') || itemEl;
    if (clickable) {
      const dataHref = clickable.getAttribute('data-href') || clickable.getAttribute('href');
      if (dataHref && !dataHref.startsWith('javascript:')) {
        return { type: 'data-href', url: new URL(dataHref, location.href).href, element: clickable };
      }
      return { type: 'js-click', url: null, element: clickable };
    }

    return { type: 'none', url: null, element: null };
  }

  /**
   * Enumerate the browse grid as {url, element, label} records. The element is
   * kept so the UI can highlight a row's tile on hover; the label is a short
   * snippet of the tile text to help decide which products to keep.
   */
  function collectProductItems() {
    const browse = state.config?.browse;
    if (!browse) return [];

    const linkRule = browse.linkRule || {
      selector: browse.linkStrategy === 'js-click'
        ? '[role="link"], button, [onclick], [data-href]'
        : 'a[href]',
      strategy: browse.linkStrategy || 'href',
    };

    const items = enumerateBrowseItems(browse);
    const records = [];
    const seen = new Set();

    items.forEach((item) => {
      const link = resolveLinkFromItem(item, linkRule);
      if (!link.url || seen.has(link.url)) return;
      seen.add(link.url);
      const label = normalizeText(item.textContent || '').slice(0, 60);
      records.push({ url: link.url, element: link.element || item, label });
    });

    return records;
  }

  function collectProductUrls() {
    return collectProductItems().map((record) => record.url);
  }

  function gatherImages() {
    const images = [];
    const seen = new Set();

    function addCandidate(el, src, kind) {
      if (!src || src.startsWith('data:') || seen.has(src)) return;
      seen.add(src);
      images.push({
        id: `${kind}-${images.length}`,
        src,
        element: el,
        locator: buildLocator(el),
        kind,
      });
    }

    document.querySelectorAll('img').forEach((img) => {
      const src = img.currentSrc || img.src;
      addCandidate(img, src, 'img');
    });

    document.querySelectorAll('picture source').forEach((source) => {
      const srcset = source.getAttribute('srcset');
      if (!srcset) return;
      const src = srcset.split(',')[0]?.trim().split(' ')[0];
      addCandidate(source.parentElement || source, src, 'picture');
    });

    document.querySelectorAll('*').forEach((el) => {
      const bg = window.getComputedStyle(el).backgroundImage;
      if (!bg || bg === 'none') return;
      const match = bg.match(/url\(["']?(.*?)["']?\)/);
      if (match && match[1]) addCandidate(el, match[1], 'background');
    });

    return images.filter((item) => item.src);
  }

  function waitForReady(requiredLocators = [], timeoutMs = 15000) {
    return new Promise((resolve) => {
      let settled = false;
      let quietTimer = null;
      const start = Date.now();

      const finish = () => {
        if (settled) return;
        settled = true;
        if (mutationObserver) mutationObserver.disconnect();
        resolve();
      };

      const check = () => {
        if (Date.now() - start > timeoutMs) {
          finish();
          return;
        }

        const resolved = requiredLocators.filter((locator) => findLocator(locator)).length;
        const enoughResolved = requiredLocators.length === 0 || resolved >= Math.ceil(requiredLocators.length * 0.6);

        if (document.readyState === 'complete' && enoughResolved) {
          if (window.requestIdleCallback) {
            window.requestIdleCallback(() => finish(), { timeout: 500 });
          } else {
            setTimeout(finish, 300);
          }
        }
      };

      mutationObserver = new MutationObserver(() => {
        clearTimeout(quietTimer);
        quietTimer = setTimeout(check, 500);
      });

      mutationObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
      });

      quietTimer = setTimeout(check, 700);
      setTimeout(finish, timeoutMs);
    });
  }

  async function saveConfig(partial) {
    state.config = {
      ...(state.config || {}),
      ...partial,
      host: state.host,
      updatedAt: new Date().toISOString(),
    };

    const result = await apiPost('/config', {
      host: state.host,
      config: state.config,
    });

    state.config = result.config;
    state.hasConfig = true;
    renderPanel();
  }

  async function loadSchemaAndConfig() {
    try {
      state.schema = await apiGet('/schema');
    } catch (err) {
      console.warn('[Luminascent] Failed to load schema', err);
    }

    try {
      state.config = await apiGet(`/config?host=${encodeURIComponent(state.host)}`);
      state.config = normalizeConfigRecipes(state.config);
      state.hasConfig = true;
    } catch (err) {
      if (err.status !== 404) console.warn('[Luminascent] Failed to load config', err);
      state.config = null;
      state.hasConfig = false;
    }
  }

  function ensureUi() {
    if (shadowRoot) return;

    const host = document.createElement('div');
    host.id = 'lumiscrape-root';
    host.style.all = 'initial';
    document.documentElement.appendChild(host);
    shadowRoot = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      *, *::before, *::after { box-sizing: border-box; }
      .panel {
        position: fixed;
        top: 16px;
        right: 16px;
        width: 340px;
        max-width: calc(100vw - 32px);
        max-height: calc(100vh - 32px);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        background: #111827;
        color: #f9fafb;
        border: 1px solid #374151;
        border-radius: 12px;
        box-shadow: 0 20px 40px rgba(0,0,0,0.35);
        font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        z-index: 2147483646;
      }
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        flex-shrink: 0;
        min-width: 0;
        padding: 12px 14px;
        border-bottom: 1px solid #374151;
        cursor: grab;
        user-select: none;
      }
      .header > div:first-child { min-width: 0; flex: 1; }
      .header .btn { flex-shrink: 0; }
      .header.dragging { cursor: grabbing; }
      .title { font-weight: 700; font-size: 14px; overflow-wrap: anywhere; }
      .subtle {
        color: #9ca3af;
        font-size: 12px;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      .body {
        padding: 12px 14px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        flex: 1;
        min-height: 0;
        overflow: hidden;
      }
      .body > .status { flex-shrink: 0; }
      .mode-content {
        display: flex;
        flex-direction: column;
        gap: 10px;
        flex: 1;
        min-height: 0;
        overflow: hidden;
      }
      .scroll-region {
        flex: 1;
        min-height: 0;
        overflow-x: hidden;
        overflow-y: auto;
        display: grid;
        gap: 10px;
        align-content: start;
      }
      .panel-actions {
        flex-shrink: 0;
        display: grid;
        gap: 8px;
        padding-top: 8px;
        border-top: 1px solid #374151;
        background: #111827;
      }
      .tagging-zone {
        flex-shrink: 0;
        display: grid;
        gap: 10px;
        padding-bottom: 10px;
        border-bottom: 1px solid #374151;
        max-height: min(340px, 45vh);
        min-height: 0;
        overflow-x: hidden;
        overflow-y: auto;
      }
      .tagged-list-region {
        flex: 1;
        min-height: 60px;
      }
      .wrap-text { overflow-wrap: anywhere; word-break: break-word; }
      .btn {
        appearance: none;
        border: 1px solid #4b5563;
        background: #1f2937;
        color: #f9fafb;
        border-radius: 8px;
        padding: 8px 10px;
        cursor: pointer;
        text-align: left;
        max-width: 100%;
        overflow-wrap: anywhere;
      }
      .btn:hover { background: #374151; }
      .btn:disabled { opacity: 0.45; cursor: not-allowed; }
      .btn:disabled:hover { background: #1f2937; }
      .btn.primary { background: #2563eb; border-color: #2563eb; }
      .btn.primary:hover { background: #1d4ed8; }
      .btn.active { outline: 2px solid #60a5fa; }
      .row { display: flex; gap: 8px; flex-wrap: wrap; }
      .list { display: grid; gap: 6px; }
      .item {
        border: 1px solid #374151;
        border-radius: 8px;
        padding: 8px;
        cursor: pointer;
        background: #0f172a;
        min-width: 0;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      .item:hover { border-color: #60a5fa; }
      .item.selected {
        border-color: #f59e0b;
        background: #1f2937;
        box-shadow: inset 0 0 0 1px #f59e0b;
      }
      .tag {
        display: inline-block;
        padding: 2px 6px;
        border-radius: 999px;
        background: #374151;
        font-size: 11px;
        margin-right: 4px;
        max-width: 100%;
        overflow-wrap: anywhere;
      }
      .field-card-header .tag { flex: 1; min-width: 0; }
      .context-menu {
        position: fixed;
        min-width: 220px;
        max-width: min(320px, calc(100vw - 16px));
        background: #111827;
        border: 1px solid #374151;
        border-radius: 8px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.35);
        padding: 6px;
        z-index: 2147483647;
      }
      .context-item {
        padding: 8px 10px;
        border-radius: 6px;
        cursor: pointer;
      }
      .context-item:hover { background: #1f2937; }
      .image-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
      }
      .image-card {
        position: relative;
        border: 2px solid transparent;
        border-radius: 8px;
        overflow: hidden;
        cursor: pointer;
        background: #0f172a;
      }
      .image-card img { width: 100%; height: 80px; object-fit: cover; display: block; }
      .image-card.selected { border-color: #60a5fa; }
      .image-order {
        position: absolute;
        top: 4px;
        right: 4px;
        background: #2563eb;
        color: white;
        border-radius: 999px;
        width: 22px;
        height: 22px;
        display: grid;
        place-items: center;
        font-size: 11px;
        font-weight: 700;
      }
      .status {
        padding: 8px;
        background: #0f172a;
        border-radius: 8px;
        min-width: 0;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      .run-log {
        margin: 6px 0 0;
        padding: 8px;
        background: #0b1120;
        border: 1px solid #1e293b;
        border-radius: 8px;
        max-height: 160px;
        overflow-y: auto;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11px;
        line-height: 1.5;
        color: #94a3b8;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .field-picker { display: grid; gap: 10px; max-height: 200px; overflow-x: hidden; overflow-y: auto; }
      .field-scope .row { margin-top: 4px; }
      .field-tag-btn { font-size: 12px; padding: 6px 8px; flex: 1 1 calc(50% - 4px); min-width: 0; max-width: 100%; }
      .tag-actions { display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
      .tag-actions .btn { font-size: 11px; padding: 4px 8px; flex: 1 1 auto; min-width: 0; }
      .field-card.active { border-color: #f59e0b; box-shadow: inset 0 0 0 1px #f59e0b; }
      .field-card.retagging { border-color: #60a5fa; box-shadow: inset 0 0 0 1px #60a5fa; }
      .field-card-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; min-width: 0; }
      .field-card-actions { display: flex; gap: 4px; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; }
      .field-card-actions .btn { font-size: 11px; padding: 2px 6px; }
      .field-card-actions .btn.danger { color: #fca5a5; border-color: #7f1d1d; }
      .context-item.danger { color: #fca5a5; }
      .context-item.danger:hover { background: #450a0a; }
      .containment-group { margin-top: 8px; padding-top: 8px; border-top: 1px solid #374151; }
      .containment-group.pending { background: #1f2937; border-radius: 6px; padding: 6px 8px; margin-top: 6px; }
      .containment-header { display: flex; justify-content: space-between; align-items: center; gap: 6px; min-width: 0; flex-wrap: wrap; }
      .containment-header .btn { font-size: 11px; padding: 4px 8px; flex-shrink: 0; }
      .containment-list { display: grid; gap: 4px; margin-top: 4px; }
      .containment-entry { display: flex; justify-content: space-between; align-items: flex-start; gap: 6px; min-width: 0; }
      .containment-entry .btn { font-size: 11px; padding: 2px 6px; flex-shrink: 0; }
      .containment-entry .subtle { flex: 1; min-width: 0; overflow-wrap: anywhere; word-break: break-word; }
      .field-tag-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 6px; margin-top: 2px; min-width: 0; }
      .field-tag-row .btn { font-size: 11px; padding: 0 6px; flex-shrink: 0; }
      .field-tag-row .subtle { flex: 1; min-width: 0; overflow-wrap: anywhere; word-break: break-word; }
      .batch-size-row { display: flex; align-items: center; gap: 8px; }
      .extract-pick { display: flex; align-items: center; gap: 8px; cursor: pointer; }
      .extract-pick input { flex-shrink: 0; }
      .adhoc-sep { margin-top: 12px; text-align: center; opacity: 0.8; }
      .batch-size-input {
        width: 64px;
        padding: 4px 6px;
        border-radius: 6px;
        border: 1px solid #4b5563;
        background: #1f2937;
        color: #f9fafb;
        font: inherit;
      }
      .brand-input {
        width: 100%;
        box-sizing: border-box;
        padding: 6px 8px;
        border-radius: 6px;
        border: 1px solid #4b5563;
        background: #1f2937;
        color: #f9fafb;
        font: inherit;
      }
      .brand-row { display: flex; align-items: center; gap: 8px; }
      .brand-row .brand-input { flex: 1; min-width: 0; }
    `;
    shadowRoot.appendChild(style);

    panelEl = document.createElement('div');
    panelEl.className = 'panel';
    shadowRoot.appendChild(panelEl);
    setupPanelDrag();

    contextMenuEl = document.createElement('div');
    contextMenuEl.className = 'context-menu';
    contextMenuEl.style.display = 'none';
    shadowRoot.appendChild(contextMenuEl);

    GM_addStyle(`
      .lumiscrape-highlight {
        outline: 2px dashed #60a5fa !important;
        outline-offset: 2px !important;
      }
      .lumiscrape-highlight-strong {
        outline: 3px solid #f59e0b !important;
        outline-offset: 2px !important;
      }
      .lumiscrape-selectable-hover {
        outline: 2px dotted #34d399 !important;
        outline-offset: 2px !important;
        cursor: crosshair !important;
      }
    `);
  }

  function hideContextMenu() {
    contextMenuEl.style.display = 'none';
    contextMenuEl.innerHTML = '';
  }

  function showContextMenu(x, y, items) {
    contextMenuEl.innerHTML = '';
    items.forEach((item) => {
      const row = document.createElement('div');
      row.className = `context-item${item.danger ? ' danger' : ''}`;
      row.textContent = item.label;
      row.addEventListener('click', (event) => {
        event.stopPropagation();
        hideContextMenu();
        item.onClick();
      });
      contextMenuEl.appendChild(row);
    });
    contextMenuEl.style.left = `${x}px`;
    contextMenuEl.style.top = `${y}px`;
    contextMenuEl.style.display = 'block';

    const rect = contextMenuEl.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width - 8;
    const maxY = window.innerHeight - rect.height - 8;
    contextMenuEl.style.left = `${Math.max(8, Math.min(x, maxX))}px`;
    contextMenuEl.style.top = `${Math.max(8, Math.min(y, maxY))}px`;
  }

  function setMode(mode) {
    state.mode = mode;
    clearHighlights();
    hideContextMenu();

    if (mode !== 'browse') {
      state.selectedBrowseGroupId = null;
      stopBrowseWatch();
      state.browseScanStatus = 'idle';
      clearHighlights();
    }

    if (mode === 'browse') {
      state.browseScanStatus = 'scanning';
      startBrowseWatch();
      runBrowseDetection();
    }

    if (mode === 'product') {
      ensureProductConfig();
      state.pendingTagElement = null;
      state.pendingTagPreview = '';
      state.pendingContainmentAdd = null;
      state.pendingRetagFieldKey = null;
      state.lastTaggedMessage = '';
    }

    if (mode === 'images') {
      state.imageCandidates = gatherImages();
      state.imageSelections = [...(state.config?.images || [])];
    }

    if (mode === 'extract') {
      state.extractRunning = !!getExtractState().active;
      state.adhocStatus = '';
    }

    renderPanel();
  }

  function ensureProductConfig() {
    if (!state.config) {
      state.config = {
        host: state.host,
        product: { fields: [] },
        images: [],
      };
    }
    if (!state.config.product) state.config.product = { fields: [] };
    if (!state.config.product.fields) state.config.product.fields = [];
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function locatorSample(locator) {
    if (!locator) return '';
    return locator.textSample || locator.anchor || locator.tag || '';
  }

  function getPendingTagPreview(el) {
    if (!el) return '';
    const text = normalizeText(el.textContent);
    if (text) return text.slice(0, 80);
    if (el.tagName === 'IMG') {
      return `[image] ${normalizeText(el.getAttribute('alt') || el.getAttribute('src') || '')}`.slice(0, 80);
    }
    return `<${el.tagName.toLowerCase()}>`;
  }

  const CONTAINMENT_MODES = ['also_contains', 'sometimes_contains'];

  function containmentModeLabel(mode) {
    if (mode === 'also_contains') return 'Also contains';
    if (mode === 'sometimes_contains') return 'Sometimes contains';
    return String(mode || '').replace(/_/g, ' ');
  }

  function containmentEntryKey(entry) {
    if (typeof entry === 'string') return entry;
    if (entry?.fieldKey) return entry.fieldKey;
    return null;
  }

  function normalizeContainmentArray(arr) {
    return [...new Set((arr || []).map(containmentEntryKey).filter(Boolean))];
  }

  function getSchemaFieldLabel(fieldKey) {
    const schemaField = state.schema?.fields?.find((field) => field.key === fieldKey);
    return schemaField?.label || fieldKey;
  }

  function normalizeFieldEntry(field) {
    if (!field) return field;
    field.also_contains = normalizeContainmentArray(field.also_contains);
    field.sometimes_contains = normalizeContainmentArray(field.sometimes_contains);
    if (field.containment) delete field.containment;

    // Migrate the legacy single `locator` shape to a `locators` array. Each
    // entry is one tag and captures raw text/attribute independently.
    if (!Array.isArray(field.locators)) {
      field.locators = field.locator ? [field.locator] : [];
    }
    if (field.locator) delete field.locator;
    if (field.extraction) delete field.extraction;

    return field;
  }

  function getFieldLocators(field) {
    if (!field) return [];
    if (Array.isArray(field.locators)) return field.locators.filter(Boolean);
    return field.locator ? [field.locator] : [];
  }

  function getTaggedField(fieldKey) {
    const field = (state.config?.product?.fields || []).find((item) => item.fieldKey === fieldKey);
    return field ? normalizeFieldEntry(field) : null;
  }

  function startContainmentAdd(fieldKey, mode) {
    const field = getTaggedField(fieldKey);
    if (!field || state.pendingRetagFieldKey) return;
    hideContextMenu();
    state.pendingContainmentAdd = { fieldKey, mode };
    state.pendingTagElement = null;
    state.pendingTagPreview = '';
    state.lastTaggedMessage = '';
    renderPanel();
  }

  function cancelContainmentAdd() {
    state.pendingContainmentAdd = null;
    state.pendingTagElement = null;
    state.pendingTagPreview = '';
    clearHighlights();
    renderPanel();
  }

  function startRetagField(fieldKey) {
    if (!getTaggedField(fieldKey)) return;
    hideContextMenu();
    state.pendingRetagFieldKey = fieldKey;
    state.pendingAddTagFieldKey = null;
    state.pendingContainmentAdd = null;
    state.pendingTagElement = null;
    state.pendingTagPreview = '';
    state.lastTaggedMessage = '';
    clearHighlights();
    renderPanel();
  }

  function startAddTag(fieldKey) {
    if (!getTaggedField(fieldKey)) return;
    hideContextMenu();
    state.pendingAddTagFieldKey = fieldKey;
    state.pendingRetagFieldKey = null;
    state.pendingContainmentAdd = null;
    state.pendingTagElement = null;
    state.pendingTagPreview = '';
    state.lastTaggedMessage = '';
    clearHighlights();
    renderPanel();
  }

  function cancelAddTag() {
    state.pendingAddTagFieldKey = null;
    state.pendingTagElement = null;
    state.pendingTagPreview = '';
    clearHighlights();
    renderPanel();
  }

  function cancelRetagField() {
    state.pendingRetagFieldKey = null;
    state.pendingTagElement = null;
    state.pendingTagPreview = '';
    clearHighlights();
    renderPanel();
  }

  function deleteTaggedField(fieldKey, options = {}) {
    if (!fieldKey) return;
    ensureProductConfig();

    const label = getSchemaFieldLabel(fieldKey);
    if (!options.skipConfirm
      && !window.confirm(`Delete "${label}" (${fieldKey})? Its tags and containment links will be removed.`)) {
      return;
    }

    hideContextMenu();
    const fields = state.config.product.fields
      .filter((field) => field.fieldKey !== fieldKey)
      .map((field) => {
        const next = { ...field };
        normalizeFieldEntry(next);
        next.also_contains = (next.also_contains || []).filter((key) => key !== fieldKey);
        next.sometimes_contains = (next.sometimes_contains || []).filter((key) => key !== fieldKey);
        return next;
      });

    state.config.product = { ...state.config.product, fields };

    if (state.pendingRetagFieldKey === fieldKey) {
      state.pendingRetagFieldKey = null;
    }
    if (state.pendingContainmentAdd?.fieldKey === fieldKey) {
      state.pendingContainmentAdd = null;
    }
    state.pendingTagElement = null;
    state.pendingTagPreview = '';
    state.lastTaggedMessage = `Deleted ${label}. Click an element to tag it again.`;
    clearHighlights();
    renderPanel();
  }

  function getContainmentCandidates(parentFieldKey, mode) {
    const parent = getTaggedField(parentFieldKey);
    if (!parent) return [];
    const existing = new Set(parent[mode] || []);
    return (state.schema?.fields || [])
      .filter((field) => field.scope !== 'image')
      .filter((field) => field.key !== parentFieldKey)
      .filter((field) => !existing.has(field.key));
  }

  function renderContainmentFieldPicker(parentFieldKey, mode) {
    const candidates = getContainmentCandidates(parentFieldKey, mode);
    if (!candidates.length) {
      return '<div class="subtle">No more schema fields available to add.</div>';
    }

    const scopeLabels = {
      product: 'Product',
      size: 'Size / Price',
      note: 'Notes',
      accord: 'Accords',
    };
    const scopes = ['product', 'size', 'note', 'accord'];

    return scopes
      .map((scope) => {
        const scopeFields = candidates.filter((field) => field.scope === scope);
        if (!scopeFields.length) return '';
        const buttons = scopeFields
          .map(
            (field) => `
              <button
                class="btn field-tag-btn"
                data-containment-pick="${parentFieldKey}"
                data-containment-mode="${mode}"
                data-field-key="${field.key}"
                title="${field.key}"
              >${field.label}</button>
            `,
          )
          .join('');
        return `
          <div class="field-scope">
            <div class="subtle">${scopeLabels[scope] || scope}</div>
            <div class="row">${buttons}</div>
          </div>
        `;
      })
      .join('');
  }

  function renderContainmentGroup(field, mode) {
    normalizeFieldEntry(field);
    const tags = field[mode] || [];
    const isPending = state.pendingContainmentAdd?.fieldKey === field.fieldKey
      && state.pendingContainmentAdd?.mode === mode;
    const items = tags
      .map(
        (containedKey, index) => `
          <div class="containment-entry">
            <span class="tag">${containedKey}</span>
            <span class="subtle">${getSchemaFieldLabel(containedKey)}</span>
            <button class="btn" data-remove-containment="${field.fieldKey}" data-containment-mode="${mode}" data-containment-index="${index}">×</button>
          </div>
        `,
      )
      .join('');

    return `
      <div class="containment-group ${isPending ? 'pending' : ''}">
        <div class="containment-header">
          <span class="subtle">${containmentModeLabel(mode)}</span>
          <button
            class="btn ${isPending ? 'active' : ''}"
            data-add-containment="${field.fieldKey}"
            data-containment-mode="${mode}"
            ${(state.pendingContainmentAdd && !isPending) || state.pendingRetagFieldKey ? 'disabled' : ''}
          >${isPending ? 'Pick field…' : '+ Add field'}</button>
        </div>
        ${items ? `<div class="containment-list">${items}</div>` : ''}
      </div>
    `;
  }

  function renderProductFieldPicker() {
    const schemaFields = (state.schema?.fields || []).filter((field) => field.scope !== 'image');
    if (!schemaFields.length) {
      return '<div class="status">Schema not loaded. Is the local server running?</div>';
    }

    if (state.pendingContainmentAdd) {
      const { fieldKey, mode } = state.pendingContainmentAdd;
      return `
        <div class="status">
          <strong>${fieldKey}</strong> → ${containmentModeLabel(mode)}
        </div>
        <div class="subtle">Pick a schema field that ${containmentModeLabel(mode).toLowerCase()} inside this region:</div>
        <div class="field-picker">${renderContainmentFieldPicker(fieldKey, mode)}</div>
        <button class="btn" id="lumiscrape-cancel-containment">Cancel</button>
        ${state.lastTaggedMessage ? `<div class="status">${state.lastTaggedMessage}</div>` : ''}
      `;
    }

    if (state.pendingRetagFieldKey) {
      const label = getSchemaFieldLabel(state.pendingRetagFieldKey);
      return `
        <div class="status">
          Re-tagging <strong>${label}</strong> (<code>${state.pendingRetagFieldKey}</code>)
        </div>
        <div class="subtle">Click the correct element on the page. This replaces all current tags; containment links are kept.</div>
        <button class="btn" id="lumiscrape-cancel-retag">Cancel</button>
        ${state.lastTaggedMessage ? `<div class="status">${state.lastTaggedMessage}</div>` : ''}
      `;
    }

    if (state.pendingAddTagFieldKey) {
      const label = getSchemaFieldLabel(state.pendingAddTagFieldKey);
      return `
        <div class="status">
          Adding a tag to <strong>${label}</strong> (<code>${state.pendingAddTagFieldKey}</code>)
        </div>
        <div class="subtle">Click another element on the page that also holds this field's data.</div>
        <button class="btn" id="lumiscrape-cancel-addtag">Cancel</button>
        ${state.lastTaggedMessage ? `<div class="status">${state.lastTaggedMessage}</div>` : ''}
      `;
    }

    if (!state.pendingTagElement) {
      return `
        <div class="status">Click an element on the page to tag a new field.</div>
        <div class="subtle">On each tagged field card, use Also/Sometimes contains to link other schema fields.</div>
        ${state.lastTaggedMessage ? `<div class="status">${state.lastTaggedMessage}</div>` : ''}
      `;
    }

    const preview = state.pendingTagPreview || getPendingTagPreview(state.pendingTagElement);
    const scopeLabels = {
      product: 'Product',
      size: 'Size / Price',
      note: 'Notes',
      accord: 'Accords',
    };

    const scopes = ['product', 'size', 'note', 'accord'];
    const fieldButtons = scopes
      .map((scope) => {
        const scopeFields = schemaFields.filter((field) => field.scope === scope);
        if (!scopeFields.length) return '';
        const buttons = scopeFields
          .map(
            (field) => `
              <button class="btn field-tag-btn" data-field-key="${field.key}" title="${field.key}">
                ${field.label}
              </button>
            `,
          )
          .join('');
        return `
          <div class="field-scope">
            <div class="subtle">${scopeLabels[scope] || scope}</div>
            <div class="row">${buttons}</div>
          </div>
        `;
      })
      .join('');

    return `
      <div class="status wrap-text"><strong>Selected:</strong> ${escapeHtml(preview) || '(element)'}</div>
      <div class="subtle">Choose a field to tag:</div>
      <div class="field-picker">${fieldButtons}</div>
      <button class="btn" id="lumiscrape-clear-tag-selection">Clear selection</button>
      ${state.lastTaggedMessage ? `<div class="status wrap-text">${escapeHtml(state.lastTaggedMessage)}</div>` : ''}
    `;
  }

  function setupPanelDrag() {
    if (!panelEl || panelEl.dataset.dragBound) return;
    panelEl.dataset.dragBound = '1';

    panelEl.addEventListener('mousedown', (e) => {
      const header = e.target.closest('.header');
      if (!header || !panelEl.contains(header)) return;
      if (e.button !== 0) return;
      if (e.target.closest('button, a, input, select, textarea')) return;

      e.preventDefault();
      const rect = panelEl.getBoundingClientRect();
      panelEl.style.right = 'auto';
      panelEl.style.left = `${rect.left}px`;
      panelEl.style.top = `${rect.top}px`;

      const offsetX = e.clientX - rect.left;
      const offsetY = e.clientY - rect.top;
      header.classList.add('dragging');

      function onMove(ev) {
        const maxX = window.innerWidth - panelEl.offsetWidth;
        const maxY = window.innerHeight - panelEl.offsetHeight;
        const x = Math.max(0, Math.min(maxX, ev.clientX - offsetX));
        const y = Math.max(0, Math.min(maxY, ev.clientY - offsetY));
        panelEl.style.left = `${x}px`;
        panelEl.style.top = `${y}px`;
      }

      function onUp() {
        header.classList.remove('dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  function renderPanel() {
    if (!panelEl) return;

    const browseDone = !!state.config?.browse;
    const fieldsCount = state.config?.product?.fields?.length || 0;
    const imagesCount = state.config?.images?.length || 0;

    panelEl.innerHTML = `
      <div class="header">
        <div>
          <div class="title">Luminascent Scraper</div>
          <div class="subtle">${state.host}</div>
        </div>
        <button class="btn" id="lumiscrape-minimize">—</button>
      </div>
      <div class="body">
        <div class="status wrap-text">
          ${state.hasConfig ? 'Configured' : 'Not configured'} ·
          Browse ${browseDone ? '✓' : '—'} ·
          Fields ${fieldsCount} ·
          Images ${imagesCount}
        </div>
        <div class="mode-content">
          ${renderModeBody()}
        </div>
      </div>
    `;

    panelEl.querySelector('#lumiscrape-minimize')?.addEventListener('click', () => {
      panelEl.style.display = panelEl.style.display === 'none' ? 'block' : 'none';
    });

    bindPanelEvents();
  }

  function renderModeBody() {
    if (state.mode === 'start') {
      if (!state.hasConfig) {
        return `
          <input class="brand-input" id="lumiscrape-brand" type="text" placeholder="Brand (optional)" />
          <div class="subtle">Names the local data folder and the brand stored in the database. Leave blank for multi-brand retailers — the brand is then derived from the site host.</div>
          <button class="btn primary" id="lumiscrape-configure">Configure for scraping</button>
          <div class="subtle">Creates the site folder on the local scraper server.</div>
          <button class="btn" id="lumiscrape-exclude">Exclude this site</button>
          <div class="subtle">Hides the scraper on this site permanently. Re-enable by clearing the userscript's stored values.</div>
        `;
      }

      const brandName = state.config?.brand?.name || '';
      return `
        <div class="row">
          <button class="btn" data-mode="browse">Browse mode</button>
          <button class="btn" data-mode="product">Product mode</button>
          <button class="btn" data-mode="images">Images mode</button>
          <button class="btn" data-mode="extract">Extract mode</button>
        </div>
        <div class="subtle">Workflow: browse → product → images → extract</div>
        <div class="brand-row">
          <input class="brand-input" id="lumiscrape-brand" type="text" placeholder="Brand (optional)" value="${escapeHtml(brandName)}" />
          <button class="btn" id="lumiscrape-save-brand">Save brand</button>
        </div>
        <div class="subtle">${brandName ? `Folder locked to “${escapeHtml(state.config?.siteSlug || state.config?.hostSlug || '')}”. Editing the brand updates the database name only.` : 'Add a brand to set the database name. The data folder keeps its current name.'}</div>
        <button class="btn" id="lumiscrape-exclude">Exclude this site</button>
        <div class="subtle">Hides the scraper on this site permanently. Re-enable by clearing the userscript's stored values.</div>
      `;
    }

    if (state.mode === 'browse') {
      const items = state.browseCandidates
        .map(
          (group, index) => `
            <div class="item ${group.id === state.selectedBrowseGroupId ? 'selected' : ''}" data-group-index="${index}">
              <div><span class="tag">${group.count} items</span><span class="tag">score ${group.score}</span></div>
              <div class="wrap-text">${escapeHtml(group.sampleText) || '(no sample text)'}</div>
            </div>
          `,
        )
        .join('');

      return `
        <div class="scroll-region">
          <div class="subtle">Hover to preview. Click a group to select it, then lock.</div>
          <div class="status" id="lumiscrape-browse-status">${browseStatusText()}</div>
          <button class="btn" id="lumiscrape-detect-groups">Detect groups now</button>
          <div class="subtle">Auto-watches for late-loaded content (API grids, infinite scroll).</div>
          <div class="list">${items || '<div class="subtle">No groups detected yet.</div>'}</div>
        </div>
        <div class="panel-actions">
          <button class="btn primary" id="lumiscrape-lock-browse" ${state.selectedBrowseGroupId ? '' : 'disabled'}>
            Lock selected group
          </button>
          <button class="btn" data-mode="start">Back</button>
        </div>
      `;
    }

    if (state.mode === 'product') {
      const pendingBusy = state.pendingContainmentAdd
        || state.pendingRetagFieldKey
        || state.pendingAddTagFieldKey
        || state.pendingTagElement;

      const tagged = (state.config?.product?.fields || [])
        .map((field) => {
          normalizeFieldEntry(field);
          const isActiveCard = state.pendingContainmentAdd?.fieldKey === field.fieldKey;
          const isRetagging = state.pendingRetagFieldKey === field.fieldKey;
          const isAdding = state.pendingAddTagFieldKey === field.fieldKey;
          const cardClass = [
            'item',
            'field-card',
            isActiveCard ? 'active' : '',
            (isRetagging || isAdding) ? 'retagging' : '',
          ].filter(Boolean).join(' ');

          const locators = getFieldLocators(field);
          const tagsList = locators
            .map((locator, index) => `
              <div class="field-tag-row">
                <span class="subtle">${index + 1}. ${escapeHtml(locatorSample(locator)) || '(element)'}</span>
                <button
                  class="btn"
                  data-remove-locator="${field.fieldKey}"
                  data-locator-index="${index}"
                  ${pendingBusy ? 'disabled' : ''}
                  title="Remove this tag"
                >×</button>
              </div>
            `)
            .join('');

          return `
            <div class="${cardClass}" data-field-card="${field.fieldKey}">
              <div class="field-card-header">
                <span class="tag">${field.fieldKey}${locators.length > 1 ? ` ·${locators.length}` : ''}</span>
                <div class="field-card-actions">
                  <button
                    class="btn"
                    data-addtag-field="${field.fieldKey}"
                    ${pendingBusy ? 'disabled' : ''}
                  >Add tag</button>
                  <button
                    class="btn"
                    data-retag-field="${field.fieldKey}"
                    ${pendingBusy ? 'disabled' : ''}
                  >Re-tag</button>
                  <button
                    class="btn danger"
                    data-delete-field="${field.fieldKey}"
                    ${state.pendingContainmentAdd || state.pendingRetagFieldKey || state.pendingAddTagFieldKey ? 'disabled' : ''}
                  >Delete</button>
                </div>
              </div>
              ${tagsList || '<div class="subtle">(no tags)</div>'}
              ${renderContainmentGroup(field, 'also_contains')}
              ${renderContainmentGroup(field, 'sometimes_contains')}
            </div>
          `;
        })
        .join('');

      const productInstructions = state.pendingRetagFieldKey
        ? `Click an element on the page to re-tag <strong>${getSchemaFieldLabel(state.pendingRetagFieldKey)}</strong> (replaces all its tags).`
        : state.pendingAddTagFieldKey
        ? `Click an element to add another tag to <strong>${getSchemaFieldLabel(state.pendingAddTagFieldKey)}</strong>.`
        : state.pendingContainmentAdd
        ? `Pick a schema field for <strong>${state.pendingContainmentAdd.fieldKey}</strong> → ${containmentModeLabel(state.pendingContainmentAdd.mode)}.`
        : '1. Click an element to tag a field · 2. Add more tags or link related fields · 3. Save';

      return `
        <div class="tagging-zone">
          <div class="subtle">${productInstructions}</div>
          ${renderProductFieldPicker()}
        </div>
        <div class="scroll-region tagged-list-region">
          <div class="subtle">Tagged fields (${(state.config?.product?.fields || []).length}) · Add tag / Re-tag / Delete on each card, or right-click for options</div>
          <div class="list">${tagged || '<div class="subtle">No fields tagged yet.</div>'}</div>
        </div>
        <div class="panel-actions">
          <button class="btn primary" id="lumiscrape-save-product">Save product blueprint</button>
          <button class="btn" data-mode="start">Back</button>
        </div>
      `;
    }

    if (state.mode === 'images') {
      const cards = state.imageCandidates
        .map((image) => {
          const selected = state.imageSelections.find((sel) => sel.src === image.src);
          return `
            <div class="image-card ${selected ? 'selected' : ''}" data-image-id="${image.id}">
              <img src="${image.src}" alt="" />
              ${selected ? `<div class="image-order">${selected.order}</div>` : ''}
            </div>
          `;
        })
        .join('');

      return `
        <div class="subtle">Click images to assign order. Click again to remove.</div>
        <div class="scroll-region">
          <div class="image-grid">${cards || '<div class="subtle">No images found.</div>'}</div>
        </div>
        <div class="panel-actions">
          <button class="btn primary" id="lumiscrape-save-images">Save image selections</button>
          <button class="btn" data-mode="start">Back</button>
        </div>
      `;
    }

    if (state.mode === 'extract') {
      const items = collectProductItems();
      state.extractItems = items;
      const deselected = getExtractDeselected();
      const selectedCount = items.filter((item) => !deselected.has(item.url)).length;
      const extractState = getExtractState();
      const extractionActive = !!extractState.active;
      const modeLocked = extractController && extractionActive;
      const hasProductBlueprint = !!state.config?.product?.fields?.length;
      const batchControls = state.extractMode === 'batch'
        ? `
          <label class="subtle batch-size-row">
            Tabs per batch
            <input
              type="number"
              id="lumiscrape-batch-size"
              class="batch-size-input"
              min="1"
              value="${state.extractBatchSize}"
              ${modeLocked ? 'disabled' : ''}
            />
          </label>
          <label class="subtle batch-size-row">
            Gap between tabs (s)
            <input
              type="number"
              id="lumiscrape-batch-gap"
              class="batch-size-input"
              min="0"
              step="0.5"
              value="${state.extractGapSeconds}"
              ${modeLocked ? 'disabled' : ''}
            />
          </label>
          <div class="subtle">0 = open the whole batch at once.</div>
        `
        : '';

      const refineList = state.extractRefineOpen
        ? `
          <div class="row">
            <button class="btn" id="lumiscrape-select-all" ${modeLocked ? 'disabled' : ''}>Select all</button>
            <button class="btn" id="lumiscrape-select-none" ${modeLocked ? 'disabled' : ''}>Select none</button>
          </div>
          <div class="scroll-region">
            <div class="list">
              ${items
                .map(
                  (item, index) => `
                    <label class="item extract-pick" data-extract-index="${index}">
                      <input
                        type="checkbox"
                        data-extract-url="${escapeHtml(item.url)}"
                        ${deselected.has(item.url) ? '' : 'checked'}
                        ${modeLocked ? 'disabled' : ''}
                      />
                      <span class="wrap-text">${escapeHtml(item.label) || escapeHtml(shortUrl(item.url))}</span>
                    </label>
                  `,
                )
                .join('') || '<div class="subtle">No products detected.</div>'}
            </div>
          </div>
        `
        : '';

      return `
        <div class="subtle" id="lumiscrape-extract-count">${selectedCount} of ${items.length} products selected from browse grid.</div>
        ${items.length
          ? `<button class="btn" id="lumiscrape-toggle-refine" ${modeLocked ? 'disabled' : ''}>${state.extractRefineOpen ? 'Hide selection' : 'Refine selection'}</button>`
          : ''}
        ${refineList}
        <div class="subtle">Extraction mode</div>
        <div class="row">
          <button
            type="button"
            id="lumiscrape-extract-mode-all"
            class="btn ${state.extractMode === 'all' ? 'active' : ''}"
            ${modeLocked ? 'disabled' : ''}
          >All at once</button>
          <button
            type="button"
            id="lumiscrape-extract-mode-batch"
            class="btn ${state.extractMode === 'batch' ? 'active' : ''}"
            ${modeLocked ? 'disabled' : ''}
          >Batched</button>
        </div>
        ${batchControls}
        <div class="status" id="lumiscrape-extract-status">${extractionActive ? 'Running…' : 'Idle'}</div>
        ${renderRunLog(extractState)}
        <div class="panel-actions">
          <button class="btn primary" id="lumiscrape-run-extract" ${selectedCount && !extractionActive ? '' : 'disabled'}>
            Start extraction
          </button>
          <button class="btn" id="lumiscrape-stop-extract" ${extractionActive ? '' : 'disabled'}>Stop extraction</button>
        </div>
        <div class="subtle adhoc-sep">— or extract just this page (no browse needed) —</div>
        <button class="btn" id="lumiscrape-extract-this-page" ${hasProductBlueprint && !extractionActive ? '' : 'disabled'}>
          Extract this page
        </button>
        <div class="status" id="lumiscrape-adhoc-status">${escapeHtml(state.adhocStatus || (hasProductBlueprint ? 'Scrapes the current page using the saved product blueprint.' : 'Tag a product blueprint first (Product mode).'))}</div>
        <div class="panel-actions">
          <button class="btn" data-mode="start">Back</button>
        </div>
      `;
    }

    return '';
  }

  function renderRunLog(extractState) {
    const log = extractState?.log || [];
    if (!log.length) return '';
    const lines = log.slice(-15).reverse().map((line) => escapeHtml(line)).join('\n');
    return `<pre class="run-log" id="lumiscrape-run-log">${lines}</pre>`;
  }

  function bindPanelEvents() {
    panelEl.querySelector('#lumiscrape-configure')?.addEventListener('click', async () => {
      const brand = panelEl.querySelector('#lumiscrape-brand')?.value.trim() || null;
      await saveConfig({
        host: state.host,
        version: 1,
        createdAt: new Date().toISOString(),
        brand,
        browse: null,
        product: { fields: [] },
        images: [],
      });
      setMode('start');
    });

    panelEl.querySelector('#lumiscrape-save-brand')?.addEventListener('click', async () => {
      const brand = panelEl.querySelector('#lumiscrape-brand')?.value.trim() || null;
      await saveConfig({ brand });
    });

    panelEl.querySelector('#lumiscrape-exclude')?.addEventListener('click', () => {
      excludeHost(state.host);
      shadowRoot?.host?.remove();
      shadowRoot = null;
      panelEl = null;
    });

    panelEl.querySelectorAll('[data-mode]').forEach((btn) => {
      btn.addEventListener('click', () => setMode(btn.getAttribute('data-mode')));
    });

    panelEl.querySelector('#lumiscrape-detect-groups')?.addEventListener('click', () => {
      runBrowseDetection();
    });

    panelEl.querySelectorAll('[data-group-index]').forEach((itemEl) => {
      const index = Number(itemEl.getAttribute('data-group-index'));
      itemEl.addEventListener('mouseenter', () => {
        const group = state.browseCandidates[index];
        if (group) showBrowseHighlights(group);
      });
      itemEl.addEventListener('mouseleave', () => {
        if (state.mode === 'browse') restoreBrowseHighlights();
      });
      itemEl.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const group = state.browseCandidates[index];
        selectBrowseGroup(group);
        updateBrowseSelectionUi();
      });
    });

    panelEl.querySelector('#lumiscrape-lock-browse')?.addEventListener('click', async () => {
      const group = getSelectedBrowseGroup();
      if (!group) return;

      const linkSamples = group.members.map(resolveLinkFromItem);
      const hrefCount = linkSamples.filter((sample) => sample.type === 'href' || sample.type === 'data-href').length;
      const jsCount = linkSamples.filter((sample) => sample.type === 'js-click').length;
      const linkRule = group.linkRule || buildLinkRule(group.members);

      await saveConfig({
        browse: {
          container: group.containerRecipe || buildContainerRecipe(group.container),
          itemSignature: group.itemSignature || group.typeFingerprint,
          itemFingerprint: group.typeFingerprint,
          linkRule: {
            ...linkRule,
            strategy: hrefCount >= jsCount ? 'href' : 'js-click',
          },
          fingerprint: group.fingerprint,
          linkStrategy: hrefCount >= jsCount ? 'href' : 'js-click',
          lockedAt: new Date().toISOString(),
          _debug: {
            count: group.count,
            sampleText: group.sampleText,
          },
        },
      });

      setMode('start');
    });

    panelEl.querySelector('#lumiscrape-save-product')?.addEventListener('click', async () => {
      ensureProductConfig();
      await saveConfig({ product: state.config.product });
      setMode('start');
    });

    panelEl.querySelectorAll('[data-field-key]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const fieldKey = btn.getAttribute('data-field-key');
        const field = state.schema?.fields?.find((item) => item.key === fieldKey);
        if (field && state.pendingTagElement) {
          tagField(field, state.pendingTagElement);
        }
      });
    });

    panelEl.querySelector('#lumiscrape-clear-tag-selection')?.addEventListener('click', () => {
      state.pendingTagElement = null;
      state.pendingTagPreview = '';
      clearHighlights();
      renderPanel();
    });

    panelEl.querySelector('#lumiscrape-cancel-containment')?.addEventListener('click', () => {
      cancelContainmentAdd();
    });

    panelEl.querySelector('#lumiscrape-cancel-retag')?.addEventListener('click', () => {
      cancelRetagField();
    });

    panelEl.querySelector('#lumiscrape-cancel-addtag')?.addEventListener('click', () => {
      cancelAddTag();
    });

    panelEl.querySelectorAll('[data-retag-field]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        startRetagField(btn.getAttribute('data-retag-field'));
      });
    });

    panelEl.querySelectorAll('[data-addtag-field]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        startAddTag(btn.getAttribute('data-addtag-field'));
      });
    });

    panelEl.querySelectorAll('[data-remove-locator]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        removeFieldLocator(
          btn.getAttribute('data-remove-locator'),
          Number(btn.getAttribute('data-locator-index')),
        );
      });
    });

    panelEl.querySelectorAll('[data-delete-field]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        deleteTaggedField(btn.getAttribute('data-delete-field'));
      });
    });

    panelEl.querySelectorAll('[data-add-containment]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        startContainmentAdd(
          btn.getAttribute('data-add-containment'),
          btn.getAttribute('data-containment-mode'),
        );
      });
    });

    panelEl.querySelectorAll('[data-remove-containment]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        removeContainmentTag(
          btn.getAttribute('data-remove-containment'),
          btn.getAttribute('data-containment-mode'),
          Number(btn.getAttribute('data-containment-index')),
        );
      });
    });

    panelEl.querySelectorAll('[data-containment-pick]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        addContainmentField(
          btn.getAttribute('data-containment-pick'),
          btn.getAttribute('data-containment-mode'),
          btn.getAttribute('data-field-key'),
        );
      });
    });

    panelEl.querySelectorAll('[data-field-card]').forEach((card) => {
      card.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (state.pendingContainmentAdd
          || state.pendingTagElement
          || state.pendingRetagFieldKey
          || state.pendingAddTagFieldKey) return;
        const fieldKey = card.getAttribute('data-field-card');
        if (!fieldKey) return;
        const rect = card.getBoundingClientRect();
        showContextMenu(rect.right - 8, rect.top + 8, [
          {
            label: 'Add another tag…',
            onClick: () => startAddTag(fieldKey),
          },
          {
            label: 'Re-tag field (replace all)…',
            onClick: () => startRetagField(fieldKey),
          },
          {
            label: 'Add also contains field…',
            onClick: () => startContainmentAdd(fieldKey, 'also_contains'),
          },
          {
            label: 'Add sometimes contains field…',
            onClick: () => startContainmentAdd(fieldKey, 'sometimes_contains'),
          },
          {
            label: 'Delete field…',
            danger: true,
            onClick: () => deleteTaggedField(fieldKey),
          },
        ]);
      });
    });

    panelEl.querySelectorAll('[data-image-id]').forEach((card) => {
      card.addEventListener('click', () => {
        const id = card.getAttribute('data-image-id');
        const image = state.imageCandidates.find((item) => item.id === id);
        if (!image) return;

        const existingIndex = state.imageSelections.findIndex((sel) => sel.src === image.src);
        if (existingIndex >= 0) {
          const removedOrder = state.imageSelections[existingIndex].order;
          state.imageSelections.splice(existingIndex, 1);
          state.imageSelections = state.imageSelections
            .sort((a, b) => a.order - b.order)
            .map((sel, idx) => ({ ...sel, order: idx + 1 }));
          if (removedOrder <= state.imageSelections.length) {
            state.imageSelections = state.imageSelections.map((sel) => ({
              ...sel,
              order: sel.order > removedOrder ? sel.order - 1 : sel.order,
            }));
          }
        } else {
          state.imageSelections.push({
            order: state.imageSelections.length + 1,
            src: image.src,
            locator: image.locator,
            kind: image.kind,
          });
        }

        renderPanel();
      });
    });

    panelEl.querySelector('#lumiscrape-save-images')?.addEventListener('click', async () => {
      await saveConfig({
        images: state.imageSelections.sort((a, b) => a.order - b.order),
      });
      setMode('start');
    });

    panelEl.querySelector('#lumiscrape-extract-mode-all')?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      setExtractMode('all');
    });

    panelEl.querySelector('#lumiscrape-extract-mode-batch')?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      setExtractMode('batch');
    });

    panelEl.querySelector('#lumiscrape-batch-size')?.addEventListener('change', (event) => {
      const value = parseInt(event.target.value, 10);
      state.extractBatchSize = Math.max(1, Number.isNaN(value) ? 5 : value);
      saveExtractPrefs();
      renderPanel();
    });

    panelEl.querySelector('#lumiscrape-batch-gap')?.addEventListener('change', (event) => {
      const value = parseFloat(event.target.value);
      state.extractGapSeconds = Math.max(0, Number.isNaN(value) ? 0 : value);
      saveExtractPrefs();
      renderPanel();
    });

    panelEl.querySelector('#lumiscrape-run-extract')?.addEventListener('click', () => {
      startExtraction();
    });

    panelEl.querySelector('#lumiscrape-stop-extract')?.addEventListener('click', () => {
      stopExtraction();
    });

    panelEl.querySelector('#lumiscrape-toggle-refine')?.addEventListener('click', () => {
      state.extractRefineOpen = !state.extractRefineOpen;
      renderPanel();
    });

    panelEl.querySelector('#lumiscrape-select-all')?.addEventListener('click', () => {
      getExtractDeselected().clear();
      renderPanel();
    });

    panelEl.querySelector('#lumiscrape-select-none')?.addEventListener('click', () => {
      const deselected = getExtractDeselected();
      (state.extractItems || []).forEach((item) => deselected.add(item.url));
      renderPanel();
    });

    panelEl.querySelectorAll('[data-extract-url]').forEach((checkbox) => {
      checkbox.addEventListener('change', (event) => {
        const url = event.target.getAttribute('data-extract-url');
        const deselected = getExtractDeselected();
        if (event.target.checked) deselected.delete(url);
        else deselected.add(url);
        updateExtractSelectionUi();
      });
    });

    panelEl.querySelectorAll('.extract-pick[data-extract-index]').forEach((rowEl) => {
      const index = Number(rowEl.getAttribute('data-extract-index'));
      rowEl.addEventListener('mouseenter', () => {
        const item = (state.extractItems || [])[index];
        if (item?.element) highlightElements([item.element], true);
      });
      rowEl.addEventListener('mouseleave', () => {
        if (state.mode === 'extract') clearHighlights();
      });
    });

    panelEl.querySelector('#lumiscrape-extract-this-page')?.addEventListener('click', () => {
      extractCurrentPage();
    });
  }

  function getElementFromEvent(event) {
    const target = event.target;
    if (!(target instanceof Element)) return null;
    if (shadowRoot && (target === shadowRoot.host || shadowRoot.contains(target))) return null;
    return target;
  }

  function onProductClick(event) {
    if (state.mode !== 'product') return;
    if (state.pendingContainmentAdd) return;

    const el = getElementFromEvent(event);
    if (!el) return;

    event.preventDefault();
    event.stopPropagation();

    if (state.pendingRetagFieldKey) {
      const schemaField = state.schema?.fields?.find((field) => field.key === state.pendingRetagFieldKey);
      if (!schemaField) {
        state.lastTaggedMessage = `Schema field "${state.pendingRetagFieldKey}" not found.`;
        state.pendingRetagFieldKey = null;
        renderPanel();
        return;
      }
      highlightElements([el], true);
      tagField(schemaField, el, { retag: true });
      return;
    }

    if (state.pendingAddTagFieldKey) {
      const schemaField = state.schema?.fields?.find((field) => field.key === state.pendingAddTagFieldKey);
      if (!schemaField) {
        state.lastTaggedMessage = `Schema field "${state.pendingAddTagFieldKey}" not found.`;
        state.pendingAddTagFieldKey = null;
        renderPanel();
        return;
      }
      highlightElements([el], true);
      tagField(schemaField, el, { append: true });
      return;
    }

    state.pendingTagElement = el;
    state.pendingTagPreview = getPendingTagPreview(el);
    state.selectedElement = el;
    highlightElements([el], true);
    renderPanel();
  }

  function tagField(field, el, options = {}) {
    if (state.pendingContainmentAdd) return;
    ensureProductConfig();
    const locator = buildLocator(el);

    const fields = [...state.config.product.fields];
    const existingIndex = fields.findIndex((item) => item.fieldKey === field.key);
    const append = !!options.append && existingIndex >= 0;
    const isRetag = !append && (options.retag || existingIndex >= 0);

    let message;
    if (existingIndex >= 0) {
      const existing = normalizeFieldEntry({ ...fields[existingIndex] });
      // append: add another tag/locator. retag or re-tag of an existing field:
      // replace the whole locator set. Containment links are always preserved.
      const locators = append ? [...getFieldLocators(existing), locator] : [locator];
      fields[existingIndex] = {
        ...existing,
        scope: field.scope,
        type: field.type,
        locators,
        taggedAt: new Date().toISOString(),
      };
      message = append
        ? `Added another tag to ${field.label} (${locators.length} total). Click the next element.`
        : `Re-tagged ${field.label}. Click the next element.`;
    } else {
      fields.push({
        fieldKey: field.key,
        scope: field.scope,
        type: field.type,
        locators: [locator],
        also_contains: [],
        sometimes_contains: [],
        taggedAt: new Date().toISOString(),
      });
      message = `Tagged as ${field.label}. Click the next element.`;
    }

    state.config.product = { ...state.config.product, fields };
    state.pendingContainmentAdd = null;
    state.pendingRetagFieldKey = null;
    state.pendingAddTagFieldKey = null;
    state.pendingTagElement = null;
    state.pendingTagPreview = '';
    state.lastTaggedMessage = message;
    clearHighlights();
    renderPanel();
  }

  function removeFieldLocator(fieldKey, index) {
    if (!fieldKey || Number.isNaN(index)) return;
    ensureProductConfig();
    const fields = [...state.config.product.fields];
    const fieldIndex = fields.findIndex((item) => item.fieldKey === fieldKey);
    if (fieldIndex < 0) return;

    const field = normalizeFieldEntry({ ...fields[fieldIndex] });
    const locators = getFieldLocators(field).filter((_, i) => i !== index);

    if (!locators.length) {
      // Removing the last tag deletes the field entirely (and its inbound links).
      deleteTaggedField(fieldKey, { skipConfirm: true });
      return;
    }

    fields[fieldIndex] = { ...field, locators };
    state.config.product = { ...state.config.product, fields };
    renderPanel();
  }

  function addContainmentField(parentFieldKey, mode, containedFieldKey) {
    if (!CONTAINMENT_MODES.includes(mode) || !containedFieldKey) return;
    if (parentFieldKey === containedFieldKey) return;
    ensureProductConfig();

    const parentIndex = state.config.product.fields.findIndex((field) => field.fieldKey === parentFieldKey);
    if (parentIndex < 0) return;

    const fields = [...state.config.product.fields];
    const parentField = { ...fields[parentIndex] };
    normalizeFieldEntry(parentField);

    if ((parentField[mode] || []).includes(containedFieldKey)) {
      cancelContainmentAdd();
      return;
    }

    parentField[mode] = [...(parentField[mode] || []), containedFieldKey];
    fields[parentIndex] = parentField;
    state.config.product = { ...state.config.product, fields };
    state.pendingContainmentAdd = null;
    state.lastTaggedMessage = `Linked ${getSchemaFieldLabel(containedFieldKey)} to ${parentFieldKey} (${containmentModeLabel(mode)}).`;
    renderPanel();
  }

  function removeContainmentTag(fieldKey, mode, index) {
    if (!CONTAINMENT_MODES.includes(mode) || Number.isNaN(index)) return;
    ensureProductConfig();

    const parentIndex = state.config.product.fields.findIndex((field) => field.fieldKey === fieldKey);
    if (parentIndex < 0) return;

    const fields = [...state.config.product.fields];
    const parentField = { ...fields[parentIndex] };
    normalizeFieldEntry(parentField);
    parentField[mode] = (parentField[mode] || []).filter((_, i) => i !== index);
    fields[parentIndex] = parentField;
    state.config.product = { ...state.config.product, fields };
    renderPanel();
  }

  function onHoverSelectable(event) {
    if (state.mode !== 'product') return;
    const el = getElementFromEvent(event);
    document.querySelectorAll('.lumiscrape-selectable-hover').forEach((node) => {
      node.classList.remove('lumiscrape-selectable-hover');
    });
    if (el) el.classList.add('lumiscrape-selectable-hover');
  }

  function getExcludedHosts() {
    const raw = GM_getValue(EXCLUDED_HOSTS_KEY, []);
    return Array.isArray(raw) ? raw : [];
  }

  function isHostExcluded(host) {
    return getExcludedHosts().includes(host);
  }

  function excludeHost(host) {
    const hosts = getExcludedHosts();
    if (!hosts.includes(host)) {
      hosts.push(host);
      GM_setValue(EXCLUDED_HOSTS_KEY, hosts);
    }
  }

  function loadExtractPrefs() {
    const prefs = GM_getValue(EXTRACT_PREFS_KEY, null);
    if (!prefs) return;
    if (prefs.mode === 'batch' || prefs.mode === 'all') state.extractMode = prefs.mode;
    if (prefs.batchSize) state.extractBatchSize = Math.max(1, Number(prefs.batchSize) || 5);
    if (prefs.gapSeconds != null) state.extractGapSeconds = Math.max(0, Number(prefs.gapSeconds) || 0);
  }

  function saveExtractPrefs() {
    GM_setValue(EXTRACT_PREFS_KEY, {
      mode: state.extractMode,
      batchSize: state.extractBatchSize,
      gapSeconds: state.extractGapSeconds,
    });
  }

  function setExtractMode(mode) {
    if (extractController && getExtractState().active) return;
    if (mode !== 'all' && mode !== 'batch') return;
    state.extractMode = mode;
    saveExtractPrefs();
    renderPanel();
  }

  function getDefaultExtractState() {
    return {
      active: false,
      mode: 'all',
      batchSize: 0,
      queue: [],
      batchStartedAt: null,
      inFlight: [],
      completed: [],
      failed: [],
      total: 0,
      log: [],
    };
  }

  function getExtractState() {
    return {
      ...getDefaultExtractState(),
      ...GM_getValue(EXTRACT_KEY, getDefaultExtractState()),
    };
  }

  function setExtractState(next) {
    GM_setValue(EXTRACT_KEY, next);
  }

  function stopExtraction() {
    state.extractRunning = false;
    extractController = false;
    clearResultKeys();
    closedAtByUrl.clear();
    setExtractState(getDefaultExtractState());
    renderPanel();
  }

  function withScrapeFlag(urlString) {
    const parsed = new URL(urlString, location.href);
    parsed.hash = parsed.hash ? `${parsed.hash.replace(/^#/, '')}&lumiscrape=1` : 'lumiscrape=1';
    if (!parsed.hash.startsWith('#')) parsed.hash = `#${parsed.hash}`;
    return parsed.href;
  }

  function stripScrapeFlag(urlString) {
    try {
      const parsed = new URL(urlString);
      parsed.hash = parsed.hash
        .replace(/^#/, '')
        .split('&')
        .filter((part) => part !== 'lumiscrape=1')
        .join('&');
      return parsed.href.replace(/#$/, '');
    } catch {
      return String(urlString).replace(/[#&]lumiscrape=1/g, '');
    }
  }

  function shortUrl(url) {
    try {
      const parsed = new URL(stripScrapeFlag(url));
      const seg = parsed.pathname.split('/').filter(Boolean).pop();
      return seg ? decodeURIComponent(seg) : parsed.hostname;
    } catch {
      return String(url).slice(-40);
    }
  }

  function nowClock() {
    return new Date().toTimeString().slice(0, 8);
  }

  /** Append a line to the run log (controller is the sole writer of extractState). */
  function logEvent(extractState, message) {
    const line = `${nowClock()} ${message}`;
    extractState.log = [...(extractState.log || []), line].slice(-LOG_MAX);
    console.log('[Luminascent]', message);
  }

  /**
   * Append a line to the persisted run log from outside the tick loop (e.g. an
   * async snapshot finishing). Runs only in the controller tab; the get/mutate/set
   * has no await inside it, so it can't interleave with the tick's own writes.
   */
  function appendExtractLog(message) {
    if (!extractController) return;
    const extractState = getExtractState();
    if (!extractState.active) return;
    logEvent(extractState, message);
    setExtractState(extractState);
    if (state.mode === 'extract') renderPanel();
  }

  /**
   * Child tab → controller hand-off. Writes a unique per-URL key rather than
   * mutating the shared extractState, so concurrent finishers never clobber
   * each other. The controller drains these in drainResults().
   */
  function reportResult(url, ok, error, ms) {
    if (childReported) return;
    childReported = true;
    const cleanUrl = stripScrapeFlag(url);
    GM_setValue(RESULT_PREFIX + cleanUrl, {
      url: cleanUrl,
      ok: !!ok,
      error: error || null,
      ms: ms || null,
      ts: Date.now(),
    });
    console.log('[Luminascent]', ok ? `scraped ${shortUrl(cleanUrl)}` : `failed ${shortUrl(cleanUrl)}: ${error || 'error'}`);
  }

  function clearResultKeys() {
    if (typeof GM_listValues !== 'function') return;
    GM_listValues()
      .filter((key) => key.indexOf(RESULT_PREFIX) === 0)
      .forEach((key) => GM_deleteValue(key));
  }

  function openExtractTab(url) {
    const tab = GM_openInTab(withScrapeFlag(url), {
      active: false,
      insert: true,
    });
    // Runs in the controller tab; just record when the tab vanished. The tick
    // decides (after a grace) whether it closed cleanly or died silently.
    if (tab) tab.onclose = () => closedAtByUrl.set(stripScrapeFlag(url), Date.now());
    return tab;
  }

  function launchExtractTabs(urls) {
    urls.forEach((url) => openExtractTab(url));
    updateExtractStatus();
  }

  function updateExtractStatus() {
    const statusEl = panelEl?.querySelector('#lumiscrape-extract-status');
    if (!statusEl) return;
    const extractState = getExtractState();
    if (!extractState.active) {
      statusEl.textContent = 'Idle';
      return;
    }

    const queuePart = extractState.mode === 'batch'
      ? ` · queued ${(extractState.queue || []).length}`
      : '';
    statusEl.textContent = `Running · open ${extractState.inFlight.length}${queuePart} · done ${extractState.completed.length} · failed ${extractState.failed.length} · total ${extractState.total}`;
  }

  /** Drain child-written result keys into extractState. Mutates in place. */
  function drainResults(extractState) {
    if (typeof GM_listValues !== 'function') return false;
    let changed = false;

    GM_listValues()
      .filter((key) => key.indexOf(RESULT_PREFIX) === 0)
      .forEach((key) => {
        const payload = GM_getValue(key, null);
        GM_deleteValue(key);
        if (!payload) return;

        const url = stripScrapeFlag(payload.url || key.slice(RESULT_PREFIX.length));
        const idx = extractState.inFlight.findIndex((item) => stripScrapeFlag(item) === url);
        if (idx === -1) return; // already resolved or not part of this run

        extractState.inFlight.splice(idx, 1);
        closedAtByUrl.delete(url);
        if (payload.ok) {
          extractState.completed.push(url);
          const secs = payload.ms ? ` (${(payload.ms / 1000).toFixed(1)}s)` : '';
          logEvent(extractState, `done ${shortUrl(url)}${secs}`);
        } else {
          extractState.failed.push({ url, error: payload.error || 'error' });
          logEvent(extractState, `fail ${shortUrl(url)}: ${payload.error || 'error'}`);
        }
        changed = true;
      });

    return changed;
  }

  /** Fail tabs that closed without a result (after a grace) and batch timeouts. */
  function handleTimeouts(extractState) {
    let changed = false;
    const now = Date.now();

    for (const item of [...extractState.inFlight]) {
      const url = stripScrapeFlag(item);
      const closedAt = closedAtByUrl.get(url);
      if (closedAt && now - closedAt > CLOSE_GRACE_MS) {
        extractState.inFlight = extractState.inFlight.filter((u) => stripScrapeFlag(u) !== url);
        extractState.failed.push({ url, error: 'closed without result' });
        closedAtByUrl.delete(url);
        logEvent(extractState, `fail ${shortUrl(url)}: closed without result`);
        changed = true;
      }
    }

    if (
      extractState.inFlight.length > 0 &&
      extractState.batchStartedAt &&
      now - extractState.batchStartedAt > BATCH_TIMEOUT_MS
    ) {
      for (const item of extractState.inFlight) {
        const url = stripScrapeFlag(item);
        extractState.failed.push({ url, error: 'batch timeout' });
        logEvent(extractState, `timeout ${shortUrl(url)}`);
      }
      extractState.inFlight = [];
      extractState.batchStartedAt = null;
      changed = true;
    }

    return changed;
  }

  /** Open the next batch of tabs. Mutates + persists extractState. */
  function launchNextBatch(extractState) {
    const batchSize = Math.max(1, extractState.batchSize || state.extractBatchSize || 5);
    const gapMs = Math.max(0, Number(extractState.gapSeconds) || 0) * 1000;
    const nextBatch = (extractState.queue || []).splice(0, batchSize);
    // inFlight holds the whole batch up front so the tick doesn't think the
    // batch is done while staggered tabs are still waiting to open.
    extractState.inFlight = nextBatch;
    extractState.batchStartedAt = Date.now();
    const gapNote = gapMs ? `, ${extractState.gapSeconds}s gap` : '';
    logEvent(extractState, `open ×${nextBatch.length} (${extractState.queue.length} queued${gapNote})`);
    setExtractState(extractState);

    nextBatch.forEach((url, index) => {
      if (gapMs) setTimeout(() => openExtractTab(url), index * gapMs);
      else openExtractTab(url);
    });
    updateExtractStatus();
    if (state.mode === 'extract') renderPanel();
  }

  function finishExtraction(extractState) {
    extractState.active = false;
    state.extractRunning = false;
    extractController = false;
    logEvent(extractState, `done · ${extractState.completed.length} ok · ${extractState.failed.length} failed`);
    setExtractState(extractState);
    updateExtractStatus();
    clearResultKeys();
    closedAtByUrl.clear();
    if (state.mode === 'extract') renderPanel();
  }

  function tickExtraction() {
    if (!extractController) return;

    const extractState = getExtractState();
    if (!extractState.active) return;

    let changed = drainResults(extractState);
    changed = handleTimeouts(extractState) || changed;

    if (extractState.inFlight.length === 0) {
      if (extractState.mode === 'batch' && extractState.queue && extractState.queue.length > 0) {
        launchNextBatch(extractState);
        return;
      }
      finishExtraction(extractState);
      return;
    }

    if (changed) {
      setExtractState(extractState);
      updateExtractStatus();
      if (state.mode === 'extract') renderPanel();
    }
  }

  function getExtractDeselected() {
    if (!state.extractDeselected) state.extractDeselected = new Set();
    return state.extractDeselected;
  }

  /** URLs to extract: the full grid minus any the user unchecked for this page. */
  function selectedProductUrls() {
    const deselected = getExtractDeselected();
    return collectProductUrls().filter((url) => !deselected.has(url));
  }

  /** Refresh the selected count + Start button after a checkbox toggle, without
   *  re-rendering the whole list (keeps scroll position). */
  function updateExtractSelectionUi() {
    if (!panelEl) return;
    const items = state.extractItems || [];
    const deselected = getExtractDeselected();
    const selectedCount = items.filter((item) => !deselected.has(item.url)).length;

    const countEl = panelEl.querySelector('#lumiscrape-extract-count');
    if (countEl) countEl.textContent = `${selectedCount} of ${items.length} products selected from browse grid.`;

    const runBtn = panelEl.querySelector('#lumiscrape-run-extract');
    if (runBtn) runBtn.disabled = !(selectedCount && !getExtractState().active);
  }

  function startExtraction() {
    const urls = selectedProductUrls();
    if (!urls.length) return;

    // Snapshot the browse page DOM as an offline backup of where these URLs came
    // from. Best-effort: don't block the run on it.
    savePageSnapshot({ scope: 'browse', url: stripScrapeFlag(location.href), log: appendExtractLog });

    // Fresh run: drop any leftover result keys / close markers from a prior run.
    clearResultKeys();
    closedAtByUrl.clear();
    extractController = true;
    state.extractRunning = true;
    const startedAt = new Date().toISOString();
    const baseState = {
      active: true,
      completed: [],
      failed: [],
      total: urls.length,
      host: state.host,
      startedAt,
      log: [`${nowClock()} start · ${urls.length} URLs · ${state.extractMode}`],
    };

    if (state.extractMode === 'batch') {
      const batchSize = Math.max(1, state.extractBatchSize || 5);
      const extractState = {
        ...baseState,
        mode: 'batch',
        batchSize,
        gapSeconds: Math.max(0, Number(state.extractGapSeconds) || 0),
        queue: [...urls],
        inFlight: [],
        batchStartedAt: null,
      };
      // launchNextBatch persists state and opens the first batch.
      launchNextBatch(extractState);
    } else {
      // 'all' mode has no batch deadline; close-grace + result keys resolve tabs.
      setExtractState({
        ...baseState,
        mode: 'all',
        batchSize: 0,
        queue: [],
        inFlight: [...urls],
        batchStartedAt: null,
      });
      launchExtractTabs(urls);
    }

    renderPanel();
  }

  async function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        resolve(result.split(',')[1] || '');
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function fetchImageBlob(imageUrl) {
    const response = await gmRequest({
      url: imageUrl,
      responseType: 'blob',
    });
    return response.response;
  }

  function extensionFromUrl(imageUrl) {
    try {
      const pathname = new URL(imageUrl).pathname;
      const ext = pathname.split('.').pop();
      if (ext && ext.length <= 5) return ext.toLowerCase();
    } catch {
      /* ignore */
    }
    return 'jpg';
  }

  /**
   * Serialize the live, fully-rendered DOM as the scraper sees it, minus the
   * scraper's own UI. Saved as an offline backup so later passes can work
   * against captured pages instead of re-hitting the site.
   */
  function captureRenderedHtml() {
    const root = document.documentElement.cloneNode(true);
    // Drop the scraper's injected host element (its UI lives in a shadow root,
    // which outerHTML doesn't serialize, but the host div would still appear).
    root.querySelectorAll('#lumiscrape-root').forEach((el) => el.remove());
    // Strip the transient highlight classes the scraper paints onto page nodes.
    root.querySelectorAll('[class*="lumiscrape-"]').forEach((el) => {
      ['lumiscrape-highlight', 'lumiscrape-highlight-strong', 'lumiscrape-selectable-hover']
        .forEach((cls) => el.classList.remove(cls));
      if (el.getAttribute('class') === '') el.removeAttribute('class');
    });

    const doctype = document.doctype ? `<!DOCTYPE ${document.doctype.name}>\n` : '<!DOCTYPE html>\n';
    return doctype + root.outerHTML;
  }

  /** Best-effort POST of the rendered DOM to the local server. Never throws. */
  async function savePageSnapshot(options) {
    const label = options.scope === 'browse' ? 'browse page' : shortUrl(options.url);
    try {
      const result = await apiPost('/page', {
        host: state.host,
        scope: options.scope,
        url: options.url,
        urlSlug: options.urlSlug || null,
        html: captureRenderedHtml(),
      });
      const kb = result?.bytes ? ` (${Math.round(result.bytes / 1024)}kb)` : '';
      console.log('[Luminascent]', `saved ${label} snapshot${kb}`);
      if (options.log) options.log(`snapshot ${label}${kb}`);
    } catch (err) {
      console.warn('[Luminascent] Failed to save page snapshot', err);
      if (options.log) options.log(`snapshot failed (${label}): ${err.message}`);
    }
  }

  function buildScrapedData() {
    const fields = state.config?.product?.fields || [];
    const data = {
      source_url: stripScrapeFlag(location.href),
      scrapedAt: new Date().toISOString(),
      fields: {},
    };

    // Each tagged field captures raw text/attribute from one or more locators.
    // No structuring (notes/accords/sizes splitting) happens here; that is the
    // job of the later LLM step. Cardinality is intentionally ignored: a single
    // tag yields a string, multiple tags yield an array of raw strings.
    fields.forEach((field) => {
      const locators = getFieldLocators(field);
      const values = [];
      locators.forEach((locator) => {
        const el = findLocator(locator);
        const value = extractValue(el, locator?.extraction);
        if (value == null || value === '') return;
        if (!values.includes(value)) values.push(value);
      });
      if (!values.length) return;
      data.fields[field.fieldKey] = values.length === 1 ? values[0] : values;
    });

    const images = [];
    (state.config?.images || []).forEach((imageSel) => {
      const el = findLocator(imageSel.locator);
      const src = extractImageSrc(el);
      if (!src) return;
      images.push({
        source_url: src,
        position: imageSel.order - 1,
        is_primary: imageSel.order === 1,
      });
    });

    if (images.length) data.images = images;

    return data;
  }

  function getRequiredProductLocators() {
    return [
      ...(state.config?.product?.fields || []).flatMap((field) => getFieldLocators(field)),
      ...(state.config?.images || []).map((image) => image.locator),
    ].filter(Boolean);
  }

  /**
   * Extract + persist the product on the current page (data.json, DOM snapshot,
   * images). Shared by the auto-scrape child tabs and the ad-hoc "extract this
   * page" action. Does not navigate or close the tab.
   */
  async function scrapeCurrentPage() {
    const cleanUrl = stripScrapeFlag(location.href);

    const data = buildScrapedData();
    data.source_url = cleanUrl;
    const slugResult = await apiGet(`/slug?url=${encodeURIComponent(cleanUrl)}`);
    const urlSlug = slugResult.urlSlug;

    await apiPost('/product', {
      host: state.host,
      url: cleanUrl,
      urlSlug,
      data,
    });

    await savePageSnapshot({ scope: 'product', url: cleanUrl, urlSlug });

    let imageCount = 0;
    for (const imageSel of state.config?.images || []) {
      const el = findLocator(imageSel.locator);
      const src = extractImageSrc(el);
      if (!src) continue;

      try {
        const blob = await fetchImageBlob(src);
        const dataBase64 = await blobToBase64(blob);
        await apiPost('/image', {
          host: state.host,
          urlSlug,
          order: imageSel.order,
          ext: extensionFromUrl(src),
          dataBase64,
        });
        imageCount += 1;
      } catch (err) {
        console.warn('[Luminascent] Failed to save image', src, err);
      }
    }

    return { urlSlug, imageCount };
  }

  async function runAutoScrapeTab() {
    const tabStartedAt = Date.now();
    const cleanUrl = stripScrapeFlag(location.href);

    await waitForReady(getRequiredProductLocators());
    await scrapeCurrentPage();

    reportResult(cleanUrl, true, null, Date.now() - tabStartedAt);
    window.close();
  }

  function setAdhocStatus(message) {
    state.adhocStatus = message || '';
    const statusEl = panelEl?.querySelector('#lumiscrape-adhoc-status');
    if (statusEl) statusEl.textContent = state.adhocStatus;
  }

  /**
   * Ad-hoc extraction: scrape the page the user is currently viewing, without
   * the browse blueprint or opening child tabs. Needs only a saved product
   * blueprint (tagged fields).
   */
  async function extractCurrentPage() {
    if (!state.config?.product?.fields?.length) {
      setAdhocStatus('No product blueprint yet — tag fields in Product mode first.');
      return;
    }
    setAdhocStatus('Waiting for page to settle…');
    try {
      await waitForReady(getRequiredProductLocators());
      setAdhocStatus('Extracting current page…');
      const result = await scrapeCurrentPage();
      setAdhocStatus(`Saved ${result.urlSlug} · ${result.imageCount} image(s)`);
    } catch (err) {
      console.error('[Luminascent] Ad-hoc extraction failed', err);
      setAdhocStatus(`Failed: ${err.message || 'error'}`);
    }
  }

  async function init() {
    if (isHostExcluded(state.host)) return;

    ensureUi();

    if (location.hash.includes('lumiscrape=1')) {
      // If the tab is torn down before it reports (navigation, manual close),
      // emit a skip so the controller doesn't wait out the grace/timeout.
      window.addEventListener('pagehide', () => {
        reportResult(location.href, false, 'skipped');
      });

      await loadSchemaAndConfig();
      if (!state.config) {
        console.warn('[Luminascent] No config for auto scrape tab');
        reportResult(location.href, false, 'missing config');
        return;
      }

      try {
        await runAutoScrapeTab();
      } catch (err) {
        console.error('[Luminascent] Auto scrape failed', err);
        reportResult(location.href, false, err.message);
      }
      return;
    }

    loadExtractPrefs();
    await loadSchemaAndConfig();
    renderPanel();

    document.addEventListener('click', onProductClick, true);
    document.addEventListener('mousemove', onHoverSelectable, true);
    document.addEventListener('click', (event) => {
      if (event.composedPath().includes(contextMenuEl)) return;
      hideContextMenu();
    });

    setInterval(() => {
      tickExtraction();
      if (state.mode === 'extract') updateExtractStatus();
    }, 1000);
  }

  init().catch((err) => {
    console.error('[Luminascent] init failed', err);
  });
})();
