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

// Wraps the concatenated body in a `(function () { 'use strict'; ... })()` shell.
//
// The shell defines a single entrypoint `__lumiscrapeMain` (idempotent — a second
// call on the same page is a no-op) and then, depending on `autoRun`:
//   - autoRun: true  (standalone `scraper.user.js`) — calls it immediately.
//   - autoRun: false (server-served loader bundle) — registers it on `window` and
//     returns it, WITHOUT calling it. The thin loader then either evals this fresh
//     text (live reload) or, if page CSP blocks eval, calls the @require'd cached
//     copy via `window.__lumiscrapeMain`. See userscript/scraper.loader.user.js.
//
// The freshness stamp lives inside the entrypoint so it logs once, on the copy that
// actually runs — proving whether the reload picked up your edits.
export function buildBundle(srcDir = SRC_DIR, { autoRun = true } = {}) {
  const stamp = formatStamp(latestSrcMtime(srcDir));
  const banner = `    console.log('[Luminascent] scraper bundle — src last modified ${stamp}');`;
  const body = buildBundleBody(srcDir);
  const tail = autoRun
    ? `  __lumiscrapeMain();`
    : `  try { window.__lumiscrapeMain = __lumiscrapeMain; } catch (e) {}\n  return __lumiscrapeMain;`;
  return (
    `(function () {\n  'use strict';\n\n` +
    `  function __lumiscrapeMain() {\n` +
    `    if (window.__lumiscrapeStarted) return;\n` +
    `    window.__lumiscrapeStarted = true;\n` +
    `${banner}\n\n${body}\n` +
    `  }\n\n${tail}\n})();\n`
  );
}
