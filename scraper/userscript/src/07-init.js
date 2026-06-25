
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

    // Pick on pointerdown, not click: page-builder / editable widgets (Shogun,
    // Squarespace, etc.) routinely swallow the `click` event for their own content
    // — a capture-phase listener that stops it, or DOM that mutates between
    // mousedown and mouseup so no `click` is ever synthesised. Those elements still
    // highlight on hover (mousemove) but couldn't be tagged. pointerdown fires before
    // any of that and isn't subject to it, so tagging works on every element the user
    // can see highlighted. (See onProductClick for the primary-button guard.)
    document.addEventListener('pointerdown', onProductClick, true);
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