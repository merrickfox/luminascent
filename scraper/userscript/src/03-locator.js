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
  const firstFromSrcset = (srcset) => {
    if (!srcset) return null;
    const first = srcset.split(',')[0]?.trim().split(/\s+/)[0];
    return first || null;
  };

  // Lazy-loading sites (Squarespace, lazysizes, etc.) ship the real URL in a
  // data-* attribute and only populate `src` once the image scrolls into view.
  // Product pages captured in background child tabs often never trigger that
  // load, so `src`/`currentSrc` stay empty. Fall back to the common lazy-load
  // carriers before giving up. Generic across sites — only used when the live
  // src is missing, so it never overrides a real loaded src.
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

    if (tag === 'img') {
      return lazyImgUrl(el);
    }

    if (tag === 'source') {
      return (
        firstFromSrcset(el.getAttribute('srcset') || el.getAttribute('data-srcset')) ||
        el.getAttribute('src') ||
        el.getAttribute('data-src') ||
        null
      );
    }

    // <picture> or a generic wrapper: prefer a descendant <img>, then a <source> srcset.
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
      /* getComputedStyle unavailable (e.g. headless verify) */
    }

    return el.currentSrc || el.src || el.getAttribute?.('src') || null;
  }

  function clearHighlights() {
    state.highlightEls.forEach((el) => {
      el.classList.remove('lumiscrape-highlight');
      el.classList.remove('lumiscrape-highlight-strong');
      el.classList.remove('lumiscrape-highlight-auto');
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
