
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
