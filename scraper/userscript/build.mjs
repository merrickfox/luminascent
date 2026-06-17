import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBundle } from './bundle.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'scraper.user.js');

// Standalone fallback: the full userscript header + the assembled bundle.
// Use this on sites whose CSP blocks the eval-based loader, or when the local
// server isn't running. Regenerate with: npm run build:userscript
const HEADER = `// ==UserScript==
// @name         Luminascent Scraper
// @namespace    https://luminascent.local/scraper
// @version      1.7.0
// @description  Blueprint-driven visual scraper for product sites
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
`;

const output = HEADER + '\n' + buildBundle();
fs.writeFileSync(OUT, output, 'utf8');
console.log('Wrote standalone userscript:', path.relative(process.cwd(), OUT), `(${output.length} bytes)`);
