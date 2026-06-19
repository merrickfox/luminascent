import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SRC_DIR = path.join(__dirname, 'src');

// Reads src/manifest.json and concatenates the listed module files, in order,
// into the IIFE body. Files are pure edit-units — at runtime they are joined
// back into one scope, byte-identical to the original single-file userscript.
export function buildBundleBody(srcDir = SRC_DIR) {
  const manifestPath = path.join(srcDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return manifest.map((name) => fs.readFileSync(path.join(srcDir, name), 'utf8')).join('\n');
}

// Newest mtime across manifest.json + the listed module files. This is the
// "source last changed" time — used to stamp the bundle so a reload can prove
// whether the freshly-served code actually reached the page (vs a stale cache).
export function latestSrcMtime(srcDir = SRC_DIR) {
  const manifestPath = path.join(srcDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const files = [manifestPath, ...manifest.map((name) => path.join(srcDir, name))];
  return files.reduce((max, file) => Math.max(max, fs.statSync(file).mtimeMs), 0);
}

// Formats an epoch-ms value in London time (BST/GMT, auto), e.g.
// "2026-06-19 12:25:43 BST".
export function formatStamp(epochMs) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, timeZoneName: 'short',
  }).formatToParts(epochMs).reduce((acc, p) => ((acc[p.type] = p.value), acc), {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} ${parts.timeZoneName}`;
}

// The sandbox APIs the bundle uses (kept in sync with the loader's @grant list and the
// GM_* references in src/*). They are SCOPED identifiers injected by the userscript
// manager — invisible to code run via eval in page/global scope — so the bundle takes
// them as an explicit `env` argument instead of referencing them as free globals.
export const GM_API_NAMES = [
  'GM_addStyle',
  'GM_deleteValue',
  'GM_getValue',
  'GM_listValues',
  'GM_openInTab',
  'GM_setValue',
  'GM_xmlhttpRequest',
];

// An object-literal expression that captures the in-scope GM_* APIs by name, each
// guarded by typeof so a missing grant yields undefined rather than a ReferenceError.
// Used at call sites that DO have GM_* in scope (the standalone tail, the loader).
export function gmEnvLiteral() {
  const entries = GM_API_NAMES.map((n) => `${n}: typeof ${n} !== 'undefined' ? ${n} : undefined`);
  return `{ ${entries.join(', ')} }`;
}

// Wraps the concatenated body in a `(function () { 'use strict'; ... })()` shell that
// defines a `__lumiscrapeFactory(env)` — env supplies the GM_* APIs (see above). The
// factory returns the idempotent entrypoint `__lumiscrapeMain` (a second call on the
// same page is a no-op). Depending on `autoRun`:
//   - autoRun: true  (standalone `scraper.user.js`) — builds env from its in-scope GM_*
//     and runs immediately.
//   - autoRun: false (server-served loader bundle) — registers the factory on `window`
//     and returns it, WITHOUT running. The thin loader evals this fresh text for live
//     reload, or under strict CSP calls the @require'd cached `window.__lumiscrapeFactory`;
//     either way it passes GM_* in. See userscript/scraper.loader.user.js.
//
// The freshness stamp lives inside the entrypoint so it logs once, on the copy that
// actually runs — proving whether the reload picked up your edits.
export function buildBundle(srcDir = SRC_DIR, { autoRun = true } = {}) {
  const stamp = formatStamp(latestSrcMtime(srcDir));
  const banner = `      console.log('[Luminascent] scraper bundle — src last modified ${stamp}');`;
  const body = buildBundleBody(srcDir);
  const binds = GM_API_NAMES.map((n) => `    var ${n} = env.${n};`).join('\n');
  const tail = autoRun
    ? `  __lumiscrapeFactory(${gmEnvLiteral()})();`
    : `  try { window.__lumiscrapeFactory = __lumiscrapeFactory; } catch (e) {}\n  return __lumiscrapeFactory;`;
  return (
    `(function () {\n  'use strict';\n\n` +
    `  function __lumiscrapeFactory(env) {\n` +
    `    env = env || {};\n` +
    `${binds}\n\n` +
    `    function __lumiscrapeMain() {\n` +
    `      if (window.__lumiscrapeStarted) return;\n` +
    `      window.__lumiscrapeStarted = true;\n` +
    `${banner}\n\n${body}\n` +
    `    }\n\n` +
    `    return __lumiscrapeMain;\n` +
    `  }\n\n${tail}\n})();\n`
  );
}
