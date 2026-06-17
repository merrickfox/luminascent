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

// Wraps the concatenated body in the same `(function () { 'use strict'; ... })()`
// shell the original file used, producing a ready-to-eval script.
export function buildBundle(srcDir = SRC_DIR) {
  return `(function () {\n  'use strict';\n\n${buildBundleBody(srcDir)}\n})();\n`;
}
