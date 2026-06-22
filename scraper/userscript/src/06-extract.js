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
  function reportResult(url, ok, error, ms, info) {
    if (childReported) return;
    childReported = true;
    const cleanUrl = stripScrapeFlag(url);
    GM_setValue(RESULT_PREFIX + cleanUrl, {
      url: cleanUrl,
      ok: !!ok,
      error: error || null,
      ms: ms || null,
      info: info || null,
      ts: Date.now(),
    });
    if (ok) {
      console.log('[Luminascent]', `scraped ${shortUrl(cleanUrl)}${captureDetail(info)}`);
    } else {
      console.log('[Luminascent]', `failed ${shortUrl(cleanUrl)}: ${error || 'error'}`);
    }
  }

  /**
   * One-line capture coverage for the run log / console. A tab can report `done`
   * while a positional or stale locator quietly resolved to nothing (or to the
   * wrong row), so we surface how many configured fields actually came back, name
   * the empty ones, and flag a capture that found nothing at all. '' when no
   * summary was reported (older results, missing-config skips, etc).
   */
  function captureDetail(info) {
    if (!info) return '';
    const parts = [`${info.fields}/${info.total} fields`];
    if (info.missing && info.missing.length) parts.push(`missing ${info.missing.join(', ')}`);
    if (info.imagesConfigured) parts.push(`${info.images}/${info.imagesConfigured} img`);
    const warn = info.fields === 0 ? ' ⚠' : '';
    return ` ·${warn} ${parts.join(' · ')}`;
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
          logEvent(extractState, `done ${shortUrl(url)}${secs}${captureDetail(payload.info)}`);
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
    // A bad image URL (e.g. an unresolved lazy-load template) often still resolves with
    // a non-2xx status whose body is a CDN error page, not an image. Saving that yields a
    // broken image, so reject anything that isn't a 2xx image response and let the caller
    // skip it. (The server applies the same magic-byte check as a backstop.)
    const status = response.status || 0;
    if (status && (status < 200 || status >= 300)) {
      throw new Error(`image fetch returned HTTP ${status}`);
    }
    const blob = response.response;
    if (blob && blob.type && !/^image\//i.test(blob.type)) {
      throw new Error(`image fetch returned non-image content-type: ${blob.type}`);
    }
    return blob;
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

  /**
   * Field-level capture summary for the run log. Compares the configured product
   * fields against what `buildScrapedData` actually resolved so silent
   * locator failures (empty / wrong-row captures) become visible per product.
   */
  function summarizeCapture(data, imageCount) {
    const configured = (state.config?.product?.fields || []).map((field) => field.fieldKey);
    const captured = configured.filter((key) => {
      const value = data.fields?.[key];
      return value != null && value !== '';
    });
    return {
      fields: captured.length,
      total: configured.length,
      missing: configured.filter((key) => !captured.includes(key)),
      images: imageCount,
      imagesConfigured: (state.config?.images || []).length,
    };
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

    return { urlSlug, imageCount, summary: summarizeCapture(data, imageCount) };
  }

  async function runAutoScrapeTab() {
    const tabStartedAt = Date.now();
    const cleanUrl = stripScrapeFlag(location.href);

    await waitForReady(getRequiredProductLocators());
    const result = await scrapeCurrentPage();

    reportResult(cleanUrl, true, null, Date.now() - tabStartedAt, result.summary);
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
      const { fields, total, missing } = result.summary;
      const miss = missing.length ? ` (missing ${missing.join(', ')})` : '';
      setAdhocStatus(`Saved ${result.urlSlug} · ${fields}/${total} fields${miss} · ${result.imageCount} image(s)`);
    } catch (err) {
      console.error('[Luminascent] Ad-hoc extraction failed', err);
      setAdhocStatus(`Failed: ${err.message || 'error'}`);
    }
  }