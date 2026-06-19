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
  }

  function saveExtractPrefs() {
    GM_setValue(EXTRACT_PREFS_KEY, {
      mode: state.extractMode,
      batchSize: state.extractBatchSize,
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
    const nextBatch = (extractState.queue || []).splice(0, batchSize);
    extractState.inFlight = nextBatch;
    extractState.batchStartedAt = Date.now();
    logEvent(extractState, `open ×${nextBatch.length} (${extractState.queue.length} queued)`);
    setExtractState(extractState);

    nextBatch.forEach((url) => openExtractTab(url));
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

  function startExtraction() {
    const urls = collectProductUrls();
    if (!urls.length) return;

    // Snapshot the browse page DOM as an offline backup of where these URLs came
    // from. Best-effort: don't block the run on it.
    savePageSnapshot({ scope: 'browse', url: stripScrapeFlag(location.href) });

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
    try {
      await apiPost('/page', {
        host: state.host,
        scope: options.scope,
        url: options.url,
        urlSlug: options.urlSlug || null,
        html: captureRenderedHtml(),
      });
    } catch (err) {
      console.warn('[Luminascent] Failed to save page snapshot', err);
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

  async function runAutoScrapeTab() {
    const tabStartedAt = Date.now();
    const cleanUrl = stripScrapeFlag(location.href);
    const requiredLocators = [
      ...(state.config?.product?.fields || []).flatMap((field) => getFieldLocators(field)),
      ...(state.config?.images || []).map((image) => image.locator),
    ].filter(Boolean);

    await waitForReady(requiredLocators);

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
      } catch (err) {
        console.warn('[Luminascent] Failed to save image', src, err);
      }
    }

    reportResult(cleanUrl, true, null, Date.now() - tabStartedAt);
    window.close();
  }