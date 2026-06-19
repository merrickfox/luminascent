#!/usr/bin/env node
// Re-download captured image files that are not actually images. Some sites were captured
// before the fetch/save guards landed, so a CDN 404 HTML page got stored as e.g. `04.jpg`.
// This walks a site's products, finds any local file whose bytes aren't a real image, and
// re-fetches it from the (normalized) source_url recorded in data.json — saving with the
// correct extension and removing the stale broken file. Generic across hosts; safe to
// re-run (valid images are left untouched).
//
// Usage:
//   node scripts/repair-images.mjs --brand <host_slug>
//   node scripts/repair-images.mjs --all
//   node scripts/repair-images.mjs --brand <host_slug> --dry-run

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sniffImage } from '../server/image-bytes.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SITES_DIR = path.join(ROOT, 'sites');

// Mirror of pipeline/image-url.ts: resolve {width}/{height} templates and protocol-relative
// URLs into a usable absolute URL, or undefined when it can't become one.
function normalizeImageSourceUrl(raw) {
  if (!raw) return undefined;
  let url = String(raw).trim();
  if (!url) return undefined;
  url = url.replace(/\{width\}/gi, '1024').replace(/\{height\}/gi, '1024');
  if (url.startsWith('//')) url = `https:${url}`;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
  } catch {
    /* not usable */
  }
  return undefined;
}

function parseArgs(argv) {
  const flags = {};
  const args = [...argv];
  while (args.length) {
    const a = args.shift();
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[0];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        args.shift();
      } else flags[key] = true;
    }
  }
  return flags;
}

const IMAGE_FILE_RE = /\.(jpe?g|png|webp|gif|avif|heic)$/i;

function listProductDirs(hostSlug) {
  const productsRoot = path.join(SITES_DIR, hostSlug, 'products');
  if (!fs.existsSync(productsRoot)) return [];
  return fs
    .readdirSync(productsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(productsRoot, d.name));
}

async function repairProduct(productDir, dryRun, stats) {
  const dataPath = path.join(productDir, 'data.json');
  const imagesDir = path.join(productDir, 'images');
  if (!fs.existsSync(dataPath) || !fs.existsSync(imagesDir)) return;

  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  // assemble.ts zips alphabetically-sorted local files with data.json images by index,
  // so repair must use the same pairing to recover the right URL for each file.
  const images = [...(data.images || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const files = fs.readdirSync(imagesDir).filter((f) => IMAGE_FILE_RE.test(f)).sort();

  for (let i = 0; i < files.length; i++) {
    const filePath = path.join(imagesDir, files[i]);
    const buffer = fs.readFileSync(filePath);
    if (sniffImage(buffer)) continue; // already a valid image

    stats.broken++;
    const url = normalizeImageSourceUrl(images[i]?.source_url);
    const label = `${path.basename(productDir)}/${files[i]}`;
    if (!url) {
      console.warn(`  ✗ ${label}: no usable source_url to re-fetch`);
      stats.unrecoverable++;
      continue;
    }

    if (dryRun) {
      console.log(`  ~ ${label}: would re-fetch ${url}`);
      stats.repaired++;
      continue;
    }

    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const fresh = Buffer.from(await resp.arrayBuffer());
      const sniffed = sniffImage(fresh);
      if (!sniffed) throw new Error('re-fetched body is still not an image');

      const order = files[i].split('.')[0];
      const newName = `${order}.${sniffed.ext}`;
      fs.writeFileSync(path.join(imagesDir, newName), fresh);
      if (newName !== files[i]) fs.rmSync(filePath); // drop the wrong-extension broken file
      console.log(`  ✓ ${label} → ${newName} (${fresh.length}b)`);
      stats.repaired++;
    } catch (err) {
      console.warn(`  ✗ ${label}: ${err.message}`);
      stats.unrecoverable++;
    }
  }
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const dryRun = flags['dry-run'] === true;

  let hosts;
  if (flags.all === true) {
    hosts = fs
      .readdirSync(SITES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } else if (typeof flags.brand === 'string') {
    hosts = [flags.brand];
  } else {
    console.error('Usage: node scripts/repair-images.mjs --brand <host_slug> | --all [--dry-run]');
    process.exit(1);
  }

  const stats = { broken: 0, repaired: 0, unrecoverable: 0 };
  for (const host of hosts) {
    const dirs = listProductDirs(host);
    if (dirs.length === 0) {
      console.warn(`[${host}] no products found`);
      continue;
    }
    console.log(`[${host}] scanning ${dirs.length} product(s)${dryRun ? ' (dry-run)' : ''}...`);
    for (const dir of dirs) await repairProduct(dir, dryRun, stats);
  }

  console.log(
    `\nDone: ${stats.broken} broken file(s), ${stats.repaired} ${dryRun ? 'repairable' : 'repaired'}, ${stats.unrecoverable} unrecoverable`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
