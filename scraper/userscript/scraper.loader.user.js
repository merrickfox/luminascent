// ==UserScript==
// @name         Luminascent Scraper (loader)
// @namespace    https://luminascent.local/scraper
// @version      1.0.0
// @description  Thin loader — fetches the scraper bundle from the local server so code changes don't need re-pasting
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

// Install this once. The real scraper code lives in scraper/userscript/src/*
// and is served by the local server at GET /userscript/bundle.js. Edit a src
// file, reload the page, and the change is live — no Tampermonkey re-paste.
//
// The full @grant list above is required: GM_* APIs are only in scope for a
// userscript whose header grants them, and the fetched bundle uses them. We run
// the bundle with a DIRECT eval so it resolves GM_* up this loader's scope chain
// (an indirect eval would run in global scope and lose access to GM_*).
//
// On sites with a strict Content-Security-Policy that blocks eval, install the
// standalone build (scraper.user.js, produced by `npm run build:userscript`).

(function () {
  'use strict';

  const SERVER = 'http://127.0.0.1:8777';

  GM_xmlhttpRequest({
    method: 'GET',
    url: SERVER + '/userscript/bundle.js',
    onload(response) {
      if (response.status >= 400) {
        console.error('[Luminascent] bundle fetch failed', response.status, response.responseText);
        return;
      }
      try {
        // eslint-disable-next-line no-eval
        eval(response.responseText); // DIRECT eval — keeps GM_* in scope
      } catch (err) {
        console.error('[Luminascent] bundle eval failed', err);
      }
    },
    onerror() {
      console.error('[Luminascent] scraper server not reachable on ' + SERVER + ' — is it running? (node server/server.js)');
    },
  });
})();
