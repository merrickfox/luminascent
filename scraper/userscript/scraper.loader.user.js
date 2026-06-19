// ==UserScript==
// @name         Luminascent Scraper (loader)
// @namespace    https://luminascent.local/scraper
// @version      3.1.0
// @description  Thin loader — live-fetches the scraper bundle from the local server each reload, with a CSP-safe @require fallback
// @author       Luminascent
// @match        *://*/*
// @connect      localhost
// @connect      127.0.0.1
// @connect      *
// @require      http://127.0.0.1:8777/userscript/bundle.js
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_openInTab
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

// Install this once. The real scraper code lives in scraper/userscript/src/* and is
// served by the local server at GET /userscript/bundle.js (assembled fresh per request).
//
// TWO PATHS, picked at runtime per page:
//
//   1. LIVE (default, normal sites): the body below fetches the bundle fresh via
//      GM_xmlhttpRequest (cache-busted) and evals it, so editing a src/* file and
//      reloading the page shows the change immediately — no Tampermonkey re-paste,
//      no waiting on Tampermonkey's @require cache.
//
//   2. FALLBACK (strict-CSP sites, e.g. Marks & Spencer): pages whose CSP omits
//      'unsafe-eval' block the eval in path 1. We catch that and run the @require'd
//      bundle instead. @require is injected into the sandbox by Tampermonkey as part
//      of this script — not eval'd — so it runs under any CSP. The trade-off is that
//      Tampermonkey caches @require externals on its OWN schedule (it ignores the
//      server's Cache-Control), so the fallback copy can be stale; that's fine because
//      you don't iterate scraper code on strict-CSP sites. To force the fallback fresh:
//      Tampermonkey dashboard → this script → Externals → delete the cached require.
//
// The freshness stamp the bundle logs ("src last modified …") reflects whichever path
// ran, so you can always see whether the live fetch reached the page.
//
// The server-served bundle is DEFINE-ONLY: it registers window.__lumiscrapeFactory and
// returns it, but does not auto-run. This loader decides which copy (fresh vs cached)
// actually starts, and the entrypoint is idempotent so it never double-starts.
//
// WHY A FACTORY: the bundle needs the GM_* sandbox APIs, which are scoped identifiers
// here (granted above) but are NOT visible to code run via eval in page/global scope.
// So the loader captures them in this sandbox scope and hands them to the factory —
// without this, eval'd code throws `GM_getValue is not defined`.
//
// SERVER MUST BE RUNNING for the live path: `cd scraper && node server/server.js`.
// If the server is down on a normal site, the live fetch fails and we fall back to the
// @require'd copy (which only loads if it was cached while the server was up).
//
// GUARANTEED FALLBACK: the self-contained build `scraper.user.js`
// (`npm run build:userscript`) inlines the bundle and auto-runs — needs neither the
// server nor @require. Use it if this loader ever misbehaves.

(function () {
  'use strict';

  var BUNDLE_URL = 'http://127.0.0.1:8777/userscript/bundle.js';

  // Capture the granted GM_* APIs from this sandbox scope to hand to the bundle factory.
  // typeof guards keep a missing grant from throwing ReferenceError here.
  function gmEnv() {
    return {
      GM_addStyle: typeof GM_addStyle !== 'undefined' ? GM_addStyle : undefined,
      GM_deleteValue: typeof GM_deleteValue !== 'undefined' ? GM_deleteValue : undefined,
      GM_getValue: typeof GM_getValue !== 'undefined' ? GM_getValue : undefined,
      GM_listValues: typeof GM_listValues !== 'undefined' ? GM_listValues : undefined,
      GM_openInTab: typeof GM_openInTab !== 'undefined' ? GM_openInTab : undefined,
      GM_setValue: typeof GM_setValue !== 'undefined' ? GM_setValue : undefined,
      GM_xmlhttpRequest: typeof GM_xmlhttpRequest !== 'undefined' ? GM_xmlhttpRequest : undefined,
    };
  }

  function start(factory, note) {
    if (typeof factory !== 'function') {
      console.error('[Luminascent] no scraper bundle available — is the local server running?', note || '');
      return;
    }
    if (note) console.warn('[Luminascent] ' + note);
    try {
      factory(gmEnv())();
    } catch (err) {
      console.error('[Luminascent] scraper failed to start', err);
    }
  }

  function runCached(reason) {
    start(window.__lumiscrapeFactory, reason ? 'using cached @require bundle: ' + reason : null);
  }

  try {
    GM_xmlhttpRequest({
      method: 'GET',
      // Cache-bust so neither the browser nor any proxy serves a stale body.
      url: BUNDLE_URL + '?t=' + Date.now(),
      onload: function (res) {
        if (res.status < 200 || res.status >= 300) {
          runCached('server returned ' + res.status);
          return;
        }
        var factory;
        try {
          // The bundle is `(function(){ …; return __lumiscrapeFactory; })()`. Indirect
          // eval runs it in global scope and yields the fresh factory. Throws on
          // strict-CSP pages → fall back to the @require'd cached factory.
          factory = (0, eval)(res.responseText);
        } catch (err) {
          runCached('eval blocked (likely page CSP): ' + (err && err.message));
          return;
        }
        start(factory, null);
      },
      onerror: function () {
        runCached('server unreachable');
      },
    });
  } catch (err) {
    runCached('GM_xmlhttpRequest unavailable: ' + (err && err.message));
  }
})();
