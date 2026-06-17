
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