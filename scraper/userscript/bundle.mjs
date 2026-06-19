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

// Wraps the concatenated body in the same `(function () { 'use strict'; ... })()`
// shell the original file used. A leading console.log records when src/* was
// last edited, so you can confirm a reload picked up your changes.
export function buildBundle(srcDir = SRC_DIR) {
  const stamp = formatStamp(latestSrcMtime(srcDir));
  const banner = `  console.log('[Luminascent] scraper bundle — src last modified ${stamp}');`;
  return `(function () {\n  'use strict';\n\n${banner}\n\n${buildBundleBody(srcDir)}\n})();\n`;
}
