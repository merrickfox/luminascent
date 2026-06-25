  // A relative path made only of `tag:nth-of-type(n)` hops, with no class/id/attr
  // selector to pin it. These position-dependent paths are the fragile ones: a
  // site renders the same block with different inner markup across its product
  // templates, so the index drifts onto the wrong child or vanishes entirely.
  function isPositionalPath(rel) {
    return !!rel && /:nth-of-type\(\d+\)/.test(rel) && !/[.#[]/.test(rel);
  }

  // A recipe locator that reads an element's text and reaches it only by a
  // positional sub-path from its anchor. The build-time widening below avoids
  // creating these; this recognises ones already saved in a config.
  function isPositionalTextLocator(locator) {
    if (!locator) return false;
    if ((locator.extraction?.type || 'text') !== 'text') return false;
    return isPositionalPath(locator.relativePathFromAnchor);
  }

  function buildLocator(el, options = {}) {
    if (!el) return null;

    const recipeMode = options.recipeMode !== false;
    const stable = recipeMode ? findRecipeStableAncestor(el) : findStableAncestor(el);
    const attrs = recipeMode ? getRecipeAttributes(el) : getStableAttributes(el);
    const extraction = inferExtraction(el);

    // Option 2: a text element with no stable identity of its own, reachable from
    // its stable ancestor only by a positional index (e.g. `p:nth-of-type(2)`), is
    // brittle for the reason above. Re-anchor on the block itself and capture its
    // whole text; the LLM pass slices the field back out. Scoped to recipe-mode
    // text fields with a real (non-body) attributed ancestor — links/images keep
    // their precise locator since they need the exact element, not a text blob.
    if (
      recipeMode
      && extraction.type === 'text'
      && Object.keys(attrs).length === 0
      && stable.element !== el
      && stable.element !== document.body
      && Object.keys(stable.attrs || {}).length > 0
      && isPositionalPath(buildRelativePath(stable.element, el))
    ) {
      return buildLocator(stable.element, options);
    }

    const textSample = normalizeText(el.textContent).slice(0, 120);

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

    // Signature-based configs re-run the SAME group detection used at lock time and
    // return the matching group's members. This is the single source of truth: a grid
    // of heterogeneous tiles is widened (variant tiles that share the grid identity)
    // into one group keyed by its dominant signature, so a plain page-wide
    // `signature === itemSignature` match would re-fragment it and enumerate only the
    // exact-match subset (the "highlighted 16 but extracted 7" bug). Detection already
    // merges across containers (Zara's split grids) and filters hidden tiles, so we
    // still don't scope to the saved container.
    if (browse.itemSignature) {
      const groups = detectRepeatedGroups();
      const match = groups.find((group) => group.id === browse.itemSignature
        || group.itemSignature === browse.itemSignature);
      if (match && match.members.length) {
        return match.members.filter(isVisible);
      }
      // Fallback (detection drift / page changed since lock): exact page-wide match,
      // the legacy behaviour — never enumerate nothing because a group key moved.
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

  // Like structuralTailOverlap, but tolerant of a bounded number of wrapper
  // segments inserted or removed mid-path. It still aligns the tail
  // contiguously segment-for-segment — the only slack is that, on a mismatch, it
  // may drop ONE segment from the target or the candidate if doing so makes the
  // very next segment realign (an indel, i.e. a wrapper level). It never
  // substitutes mismatched segments, so unrelated branches diverge immediately
  // and score ~0; only the same element shifted by a JS-injected wrapper
  // (Magic Zoom's figure.mz-ready, a lightbox, etc.) realigns. Plain segment-LCS
  // is unusable here: repeated generic segments (div:nth-of-type(1)…) let a logo
  // in the header share a long subsequence with a deep product image. Returns
  // the number of aligned segments.
  function structuralTailOverlapTolerant(targetPath, currentPath, maxSkips) {
    if (!targetPath || !currentPath) return 0;
    const a = targetPath.split(' > ');
    const b = currentPath.split(' > ');
    let ti = a.length - 1;
    let ci = b.length - 1;
    let matched = 0;
    let skips = 0;
    while (ti >= 0 && ci >= 0) {
      if (a[ti] === b[ci]) {
        matched += 1;
        ti -= 1;
        ci -= 1;
      } else if (skips < maxSkips && ti - 1 >= 0 && a[ti - 1] === b[ci]) {
        ti -= 1; // a wrapper segment present in target, absent in candidate
        skips += 1;
      } else if (skips < maxSkips && ci - 1 >= 0 && a[ti] === b[ci - 1]) {
        ci -= 1; // a wrapper segment present in candidate, absent in target
        skips += 1;
      } else {
        break; // genuine divergence — not the same element
      }
    }
    return matched;
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
      const candidatePath = buildStructuralPath(candidate);
      const overlap = structuralTailOverlap(locator.structuralPath, candidatePath);
      score += recipeMode ? overlap * 2 : overlap;
      if (overlap >= 2) {
        evidence += Math.min(overlap, 5);
      } else if (options.allowTolerantPath) {
        // Contiguous tail diverged — usually a JS-injected/removed wrapper level
        // shifting the path (e.g. the locator was tagged inside Magic Zoom's
        // figure.mz-ready in the foreground, absent in a background capture tab).
        // Retry allowing up to two wrapper indels. Requires a long aligned tail
        // (>= 4 segments) so an unrelated element can't clear the gate. Only
        // enabled in findLocator's last-resort pass (see below), so it can never
        // change an element that already matched by normal scoring.
        const tolerant = structuralTailOverlapTolerant(locator.structuralPath, candidatePath, 2);
        if (tolerant >= 4) {
          score += recipeMode ? tolerant * 2 : tolerant;
          evidence += Math.min(tolerant, 5);
        }
      }
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

      // Option 1 safety net: an existing config whose positional sub-path no
      // longer resolves (the block's inner markup differs on this product) falls
      // back to the anchor block itself, so a text field captures the block
      // instead of null. Only when the anchor is unambiguous and the locator is a
      // positional text locator — mirrors the build-time widening above. (Where
      // the sub-path *does* resolve but to the wrong child, anchorMatches is
      // non-empty and we never reach here; that needs a re-tag, not a fallback.)
      if (!anchorMatches.length && isPositionalTextLocator(locator)) {
        const anchorsOnly = queryByAttrs(root, locator.anchorAttrs);
        if (anchorsOnly.length === 1) return anchorsOnly[0];
      }
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

    // Normal pass — unchanged scoring. Any locator that already resolved keeps
    // resolving to exactly the same element.
    const best = pickBest({ recipeMode });
    if (best) return best;

    // Last resort, media locators only: nothing cleared the evidence gate. Retry
    // permitting the wrapper-tolerant structural fallback so an image locator
    // captured inside a JS-only wrapper (a zoom/gallery/lightbox absent in
    // background tabs) can still resolve. Scoped to media because a structurally
    // approximate match is the *right* image but, for a text field, just the
    // wrong text (a price/review block that happens to sit at a similar depth) —
    // there, no match beats a confident wrong one. Gated behind "normal pass
    // found nothing", so it never changes a match the normal pass would make.
    if (!isMediaLocator(locator)) return null;
    return pickBest({ recipeMode, allowTolerantPath: true });
  }

  function isMediaLocator(locator) {
    const tag = (locator.tag || '').toLowerCase();
    if (tag === 'img' || tag === 'source' || tag === 'picture') return true;
    const ex = locator.extraction;
    return !!(ex && ex.type === 'attribute' && /^(src|currentsrc|srcset)$/i.test(ex.attribute || ''));
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

  // CDN image URLs read from lazy-load templates are frequently not usable as-is:
  // protocol-relative (`//host/...`, no scheme), root-relative (`/path`), or carrying
  // an unresolved size placeholder — Shopify ships `..._{width}x.jpg` in data-src and
  // only substitutes a real width once its own loader runs in the foreground. A
  // background capture tab never runs that loader, so we'd save the raw template and
  // the backend (which requires a valid absolute URL) rejects it. Resolve placeholders
  // to a concrete size and make the URL absolute against the page. Generic across CDNs:
  // a normal loaded `src` is already absolute and placeholder-free, so this is a no-op.
  function normalizeImageUrl(raw) {
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

  // A `src` is only "real" if it points at an actual image file. Lazy-load
  // libraries seed `src` with an inline placeholder (a 1x1 transparent
  // `data:image/svg+xml,...` or base64 gif) and keep the true URL in a data-*
  // attribute until the image scrolls into view. A `data:` URI is therefore
  // never the image we want — treat it (and empty values) as "not live" so we
  // fall through to the lazy-load carriers. Generic across CDNs/loaders.
  function isPlaceholderSrc(value) {
    if (!value) return true;
    return /^data:/i.test(String(value).trim());
  }

  // Lazy-loading sites (Squarespace, lazysizes, Shopify, etc.) ship the real
  // URL in a data-* attribute and only populate `src` once the image scrolls
  // into view. Product pages captured in background child tabs often never
  // trigger that load, so `src`/`currentSrc` stay empty or hold a placeholder.
  // Prefer a real live src; otherwise fall back to the common lazy-load
  // carriers, and only as a last resort return the placeholder. Generic across
  // sites — it never overrides a real loaded src.
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

  function extractImageSrc(el) {
    const raw = rawImageSrc(el);
    return raw == null ? raw : normalizeImageUrl(raw);
  }

  function rawImageSrc(el) {
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
