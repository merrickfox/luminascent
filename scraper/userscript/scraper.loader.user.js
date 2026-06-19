// ==UserScript==
// @name         Luminascent Scraper (loader)
// @namespace    https://luminascent.local/scraper
// @version      2.0.0
// @description  Thin loader — @require's the scraper bundle from the local server so code changes don't need re-pasting
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

// Install this once. The real scraper code lives in scraper/userscript/src/*
// and is served by the local server at GET /userscript/bundle.js. Edit a src
// file, reload the page, and the change is live — no Tampermonkey re-paste.
//
// WHY @require (not fetch + eval): the bundle uses GM_* and talks to the local
// server at 127.0.0.1:8777 via GM_xmlhttpRequest — both only work in the
// userscript sandbox, so the scraper *must* run there (a page-context blob /
// <script> would lose GM_* and be blocked by the page's connect-src + mixed
// content anyway). Sandbox code can only be delivered two ways: an inline body
// or @require — neither is eval'd, so both run under a strict Content-Security-
// Policy (e.g. Marks & Spencer, whose CSP omits 'unsafe-eval'). The previous
// fetch + direct-eval loader was blocked by exactly that CSP, in BOTH Chrome
// and Firefox. @require hands the bundle to Tampermonkey, which injects it into
// the sandbox as part of this script — no eval, so CSP can't block it.
//
// FRESHNESS: Tampermonkey caches @require resources, but its caching is not
// applied to localhost the way it is to remote URLs, and the server sends
// `Cache-Control: no-store`, so edits to src/* should appear on the next
// reload. If a change ever looks stale, force a refetch: Tampermonkey dashboard
// → this script → Externals tab → delete the cached require (or bump the
// Externals update interval to "Always" in Settings → Advanced).
//
// SERVER MUST BE RUNNING: @require is fetched at script load. If the server is
// down, Tampermonkey can't load the bundle and the scraper won't start —
// `cd scraper/server && node server.js`.
//
// GUARANTEED FALLBACK: the self-contained build `scraper.user.js`
// (`npm run build:userscript`) inlines the bundle into the script body, so it
// needs neither the server nor @require — use it if @require ever misbehaves.

// No body needed: the @require'd bundle is a self-executing IIFE.
