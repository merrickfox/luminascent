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

  function collectProductUrls() {
    const browse = state.config?.browse;
    if (!browse) return [];

    const linkRule = browse.linkRule || {
      selector: browse.linkStrategy === 'js-click'
        ? '[role="link"], button, [onclick], [data-href]'
        : 'a[href]',
      strategy: browse.linkStrategy || 'href',
    };

    const items = enumerateBrowseItems(browse);
    const urls = [];
    const seen = new Set();

    items.forEach((item) => {
      const link = resolveLinkFromItem(item, linkRule);
      if (link.url && !seen.has(link.url)) {
        seen.add(link.url);
        urls.push(link.url);
      }
    });

    return urls;
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