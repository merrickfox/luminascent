import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import {
  collectProductUrls,
  elementItemSignature,
  enumerateBrowseItems,
  extractImageSrc,
  filterRecipeAttrs,
  findLocator,
  getFieldLocators,
  isInstanceSpecificAttr,
  isLumiscrapeToken,
  normalizeBrowseConfig,
  normalizeLocatorRecipe,
  normalizeText,
} from '../server/recipe-resolver.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function loadDom(relativePath, hostname = 'www.aerin.com') {
  const html = fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
  const { document, window } = parseHTML(html);
  globalThis.document = document;
  globalThis.window = window;
  globalThis.location = { hostname, href: `https://${hostname}/` };
  return document;
}

function setDom(html, hostname = 'www.aerin.com') {
  const { document, window } = parseHTML(html);
  globalThis.document = document;
  globalThis.window = window;
  globalThis.location = { hostname, href: `https://${hostname}/` };
  return document;
}

function fail(message, extra) {
  console.error(`FAIL: ${message}`, extra ?? '');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(path.join(rootDir, 'sites/aerin_com/config.json'), 'utf8'));

// --- Recipe hygiene: no instance attrs, no leftover highlight classes ---
const normalizedFields = config.product.fields.map((field) => ({
  ...field,
  locators: getFieldLocators(field).map((locator) => normalizeLocatorRecipe(locator)),
}));

for (const field of normalizedFields) {
  for (const locator of field.locators) {
    const badAttrs = Object.entries(locator.attrs || {}).filter(([key, value]) => isInstanceSpecificAttr(key, value));
    if (badAttrs.length) fail(`${field.fieldKey} still has instance attrs`, badAttrs);
    if (locator.anchor) fail(`${field.fieldKey} still has example anchor text`);
    const classStr = `${locator.attrs?.class || ''} ${locator.anchorAttrs?.class || ''}`;
    if (classStr.split(/\s+/).some(isLumiscrapeToken)) fail(`${field.fieldKey} still has a lumiscrape highlight class`);
  }
}
console.log('PASS: normalized recipes carry no instance attrs or highlight classes');

// --- filterRecipeAttrs strips highlight tokens but keeps real classes ---
const stripped = filterRecipeAttrs({ class: 'value lumiscrape-highlight-strong' });
if (stripped.class !== 'value') fail('filterRecipeAttrs did not strip highlight token', stripped);
console.log('PASS: filterRecipeAttrs strips lumiscrape-* but keeps real class tokens');

// --- Product field recipes resolve on a representative product fixture ---
setDom(`
  <div></div><div></div><div></div>
  <div>
    <main>
      <div></div>
      <div>
        <div>
          <div>
            <div>
              <h1><span itemprop="name" data-ui-id="page-title-wrapper" data-dynamic="name" class="base">Madaket Geranium 9.5oz Candle</span></h1>
              <div>
                <span class="price">$125</span>
              </div>
              <div></div><div></div><div></div><div></div><div></div><div></div>
              <div>
                <div>
                  <div>
                    <div>
                      <div class="value">AERIN</div>
                    </div>
                  </div>
                  <div>
                    <div>
                      <div class="value">The Madaket Geranium scented candle was inspired by Madaket Beach.</div>
                    </div>
                  </div>
                  <div></div>
                  <div>
                    <div>
                      <div class="value">
                        <ul>
                          <li>Notes: Geranium, Pear, Rose, Jasmine, Amber</li>
                          <li>Size: 9.5 oz</li>
                          <li>Burn time: 55 hours</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>
`);

function fieldByKey(key) {
  return normalizedFields.find((field) => field.fieldKey === key);
}

const nameEl = findLocator(fieldByKey('name')?.locators[0]);
if (!nameEl || !nameEl.textContent.includes('Madaket Geranium')) fail('name recipe did not resolve');

const priceEl = findLocator(fieldByKey('price_amount')?.locators[0]);
if (!priceEl || !priceEl.textContent.includes('$125')) fail('price_amount recipe did not resolve');

const descEl = findLocator(fieldByKey('description')?.locators[0]);
if (!descEl) fail('description recipe did not resolve');
if (!descEl.className.split(/\s+/).includes('value')) {
  fail('description recipe resolved to wrong element (expected div.value)', descEl.className);
}
const descText = normalizeText(descEl.textContent);
if (descText === 'AERIN') {
  fail('description recipe resolved to brand field instead of description copy');
}
if (!descText.startsWith('The Madaket Geranium scented candle')) {
  fail('description recipe captured unexpected text', descText.slice(0, 60));
}

const noteEl = findLocator(fieldByKey('note_name')?.locators[0]);
if (!noteEl || !normalizeText(noteEl.textContent).startsWith('Notes: Geranium')) {
  fail('note_name recipe did not resolve');
}

const burnEl = findLocator(fieldByKey('burn_time_hours')?.locators[0]);
if (!burnEl || !normalizeText(burnEl.textContent).includes('Burn time: 55 hours')) {
  fail('burn_time_hours recipe did not resolve');
}

console.log('PASS: name, price, description, notes, and burn time recipes resolve to the correct nodes');

// --- Evidence gate rejects a region/tag-only match (the original over-grab bug) ---
const noEvidence = findLocator({
  tag: 'div',
  attrs: {},
  anchorAttrs: {},
  structuralPath: 'main:nth-of-type(9) > section:nth-of-type(9) > div:nth-of-type(9)',
});
if (noEvidence) fail('evidence gate allowed a div with no real matching signal', noEvidence.className);
console.log('PASS: evidence gate rejects tag-only matches (no more whole-column grabs)');

// --- Browse recipe still enumerates products on the listing fixture ---
loadDom('example-sites/aerin/dev-tools.html');
const browse = normalizeBrowseConfig(config.browse);
const items = enumerateBrowseItems(browse);
const urls = collectProductUrls(browse);
console.log('Browse items:', items.length, 'Product URLs:', urls.length);
if (!items.length || items.length !== urls.length || new Set(urls).size !== urls.length) {
  fail('browse recipe did not enumerate unique product URLs', { items: items.length, urls: urls.length });
}
console.log(`PASS: browse recipe enumerates ${urls.length} unique product URLs`);

// --- Fragmented grid (Zara-style): product tiles are NOT direct siblings under one
// container. They are scattered across many sibling "block" containers, sit at varying
// depth, and a couple carry an extra badge node. A signature-based browse config must
// still enumerate every tile across all blocks (the bug was getting only one block's
// worth), while NOT pulling in an adjacent carousel block that uses a different tile class.
function tile(href, extraBadge = false) {
  return `
    <li class="product-grid-product _product secondary-product zoom1-columns" data-productkey="123-456-e1">
      <div class="product-grid-product__figure">
        <a class="product-link" href="${href}"><img src="x.jpg"></a>
        <div class="product-grid-product-info">Scented Candle 200 G 15.99 GBP</div>
        ${extraBadge ? '<div class="product-badge">New</div>' : ''}
      </div>
    </li>`;
}
function carouselTile(href) {
  return `
    <div class="zds-carousel-item">
      <div class="product-grid-product _product carousel__product zoom1-columns" data-productkey="789-111-e1">
        <a class="product-link" href="${href}"><img src="y.jpg"></a>
        <div class="product-grid-product-info">Carousel Candle 100 G 9.99 GBP</div>
      </div>
    </div>`;
}
// 13 secondary blocks (8 + 8 + ... + 6 tiles), each block a separate <ul> container.
const blockSizes = [8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 7, 6];
let tileIndex = 0;
const blocks = blockSizes
  .map((n) => {
    const lis = Array.from({ length: n }, () => {
      tileIndex += 1;
      // every ~10th tile carries the extra badge node
      return tile(`https://shop.example.com/p/candle-${tileIndex}`, tileIndex % 10 === 0);
    }).join('');
    return `<li class="product-grid-block"><ul class="secondary-products-container">${lis}</ul></li>`;
  })
  .join('');
const totalSecondary = blockSizes.reduce((a, b) => a + b, 0);
const carousel = `<li class="dynamic-carousel">${Array.from({ length: 5 }, (_, i) => carouselTile(`https://shop.example.com/p/carousel-${i}`)).join('')}</li>`;

setDom(
  `<main><div class="products-category-grid"><ul class="product-grid__product-list">${blocks}${carousel}</ul></div></main>`,
  'shop.example.com',
);

const sampleTile = document.querySelector('li.secondary-product');
const fragSignature = elementItemSignature(sampleTile);
const fragBrowse = normalizeBrowseConfig({
  itemSignature: fragSignature,
  container: { version: 1, tag: 'ul', anchorAttrs: { class: 'product-grid__product-list' }, relativePathFromAnchor: '' },
  linkRule: { version: 1, selector: 'a[href]', strategy: 'href' },
});

const fragItems = enumerateBrowseItems(fragBrowse);
const fragUrls = collectProductUrls(fragBrowse);
const largestBlock = Math.max(...blockSizes);

if (fragItems.length !== totalSecondary) {
  fail('fragmented grid did not enumerate every tile across blocks', { got: fragItems.length, expected: totalSecondary });
}
if (fragItems.length <= largestBlock) {
  fail('fragmented grid only saw a single block (the original bug)', { got: fragItems.length, largestBlock });
}
if (fragItems.some((el) => el.className.includes('carousel__product'))) {
  fail('fragmented grid pulled in the adjacent carousel block (different tile class)');
}
if (new Set(fragUrls).size !== totalSecondary) {
  fail('fragmented grid produced wrong unique URL count', { urls: new Set(fragUrls).size, expected: totalSecondary });
}
console.log(`PASS: fragmented grid merges ${fragItems.length} tiles across ${blockSizes.length} blocks (largest block: ${largestBlock}), excludes carousel`);

// --- Image extraction reads the live src per element carrier. A saved image selection
// frequently anchors on a <picture> or <source> (which have no `src`); a naive attribute
// read returns null, which previously fell back to the stale config-time URL and stamped
// one product's image onto every product. extractImageSrc must resolve a real URL from
// each carrier so each product yields its own image.
setDom(
  `<main>
    <img class="hero" src="https://cdn.example.com/p1/main.jpg">
    <picture class="media-image"><source srcset="https://cdn.example.com/p1/alt.webp 1x"><img src="https://cdn.example.com/p1/alt.jpg"></picture>
    <picture class="srcset-only"><source srcset="https://cdn.example.com/p1/only.webp 1x, https://cdn.example.com/p1/only-2x.webp 2x"></picture>
    <source class="bare" srcset="https://cdn.example.com/p1/bare.webp 1x">
    <img class="lazy" data-load="false" data-src="https://cdn.example.com/p1/lazy.png" data-image="https://cdn.example.com/p1/lazy.png">
    <img class="lazy-srcset" data-srcset="https://cdn.example.com/p1/lazy-1.png 1x, https://cdn.example.com/p1/lazy-2.png 2x">
    <img class="shopify-tpl" data-src="//cdn.example.com/p1/IMG_1_{width}x.jpg?v=1">
    <img class="root-rel" data-src="/cdn/p1/rel.jpg">
  </main>`,
  'shop.example.com',
);
const imgSrc = extractImageSrc(document.querySelector('img.hero'));
if (imgSrc !== 'https://cdn.example.com/p1/main.jpg') fail('extractImageSrc did not read <img> src', imgSrc);
const pictureSrc = extractImageSrc(document.querySelector('picture.media-image'));
if (pictureSrc !== 'https://cdn.example.com/p1/alt.jpg') fail('extractImageSrc did not read descendant <img> of <picture>', pictureSrc);
const srcsetSrc = extractImageSrc(document.querySelector('picture.srcset-only'));
if (srcsetSrc !== 'https://cdn.example.com/p1/only.webp') fail('extractImageSrc did not fall back to <source> srcset', srcsetSrc);
const bareSource = extractImageSrc(document.querySelector('source.bare'));
if (bareSource !== 'https://cdn.example.com/p1/bare.webp') fail('extractImageSrc did not read <source> srcset', bareSource);
// Lazy-loaded <img> (Squarespace/lazysizes): real URL only in data-src/data-image until scrolled into view.
const lazySrc = extractImageSrc(document.querySelector('img.lazy'));
if (lazySrc !== 'https://cdn.example.com/p1/lazy.png') fail('extractImageSrc did not fall back to lazy data-src', lazySrc);
const lazySrcset = extractImageSrc(document.querySelector('img.lazy-srcset'));
if (lazySrcset !== 'https://cdn.example.com/p1/lazy-1.png') fail('extractImageSrc did not fall back to lazy data-srcset', lazySrcset);
// Shopify-style lazy template: protocol-relative + unresolved {width} placeholder.
// Must become a concrete, absolute URL (the backend rejects both as "Invalid url").
const tplSrc = extractImageSrc(document.querySelector('img.shopify-tpl'));
if (tplSrc !== 'https://cdn.example.com/p1/IMG_1_1024x.jpg?v=1') fail('extractImageSrc did not resolve {width} + protocol-relative template', tplSrc);
// Root-relative lazy URL resolves against the page origin.
const rootRel = extractImageSrc(document.querySelector('img.root-rel'));
if (rootRel !== 'https://shop.example.com/cdn/p1/rel.jpg') fail('extractImageSrc did not resolve root-relative URL', rootRel);
if (extractImageSrc(null) !== null) fail('extractImageSrc(null) should be null');
console.log('PASS: extractImageSrc resolves a live URL from <img>, <picture>, <source>, and lazy-loaded carriers');

// --- Acqua di Parma accordion: sibling panels share data-parent="#productInfoSection",
// distinguished only by class (tab-more-information vs tab-tasting-notes). Self-contained
// (the live config lives under the gitignored sites/, so the recipes are inlined here).
const adpDescLocator = normalizeLocatorRecipe({
  version: 1,
  tag: 'div',
  attrs: { class: 'collapse-content tab-more-information text-m longDescription', 'data-parent': '#productInfoSection' },
  anchorAttrs: { class: 'collapse-content tab-more-information text-m longDescription', 'data-parent': '#productInfoSection' },
  relativePathFromAnchor: '',
  textSample: 'Diffuse enchanting scents for a sensuous yet fresh awakening to your day.',
});
const adpNoteLocator = normalizeLocatorRecipe({
  version: 1,
  tag: 'div',
  attrs: { class: 'collapse-content tab-tasting-notes text-m collapse', 'data-parent': '#productInfoSection' },
  anchorAttrs: { class: 'collapse-content tab-tasting-notes text-m collapse', 'data-parent': '#productInfoSection' },
  relativePathFromAnchor: '',
  textSample: 'Olfactive family: Aromatic green Tasting Notes: Italian lemon, mint leaves, rosemary.',
});

// Product WITH both panels: description and tasting notes must resolve independently,
// even though the tasting-notes panel is collapsed (display:none in the live DOM).
setDom(
  `<main><div id="productInfoSection">
    <div class="accordion-item">
      <div class="collapse-content tab-more-information text-m longDescription" data-parent="#productInfoSection">Diffuse enchanting scents for a sensuous yet fresh awakening to your day. As the first rays of the morning light filter through, this candle fills your home with a luminous fragrance.</div>
    </div>
    <div class="accordion-item">
      <div class="collapse-content tab-tasting-notes text-m collapse" data-parent="#productInfoSection" style="display:none">Olfactive family: Aromatic green Tasting Notes: Italian lemon, mint leaves, rosemary, lavandin, jasmine, cedarwood, musk.</div>
    </div>
  </div></main>`,
  'www.acquadiparma.com',
);

const adpDescEl = findLocator(adpDescLocator);
const adpNoteEl = findLocator(adpNoteLocator);
const adpDescText = normalizeText(adpDescEl?.textContent || '');
const adpNoteText = normalizeText(adpNoteEl?.textContent || '');

if (!adpDescEl || !adpDescText.startsWith('Diffuse enchanting scents')) {
  fail('acquadiparma description recipe did not resolve', adpDescText.slice(0, 60));
}
if (!adpNoteEl || !adpNoteText.includes('Olfactive family: Aromatic green')) {
  fail('acquadiparma note_name recipe did not resolve', adpNoteText.slice(0, 60));
}
if (adpDescText === adpNoteText) {
  fail('acquadiparma description and note_name resolved to the same content');
}
if (adpNoteText.startsWith('Diffuse enchanting scents')) {
  fail('acquadiparma note_name resolved to description accordion panel');
}
console.log('PASS: acquadiparma accordion description and tasting notes resolve independently');

// Product WITHOUT a tasting-notes panel (decorative cubes, sets, bases): note_name must
// NOT fall back to the description panel just because it shares data-parent. This is the
// regression that duplicated the description into note_name across ~8 products.
setDom(
  `<main><div id="productInfoSection">
    <div class="accordion-item">
      <div class="collapse-content tab-more-information text-m longDescription" data-parent="#productInfoSection">A unique candle entirely hand crafted. The sophisticated black wax cube candle is delicately embossed with the Acqua di Parma logo.</div>
    </div>
  </div></main>`,
  'www.acquadiparma.com',
);

const adpDescOnlyEl = findLocator(adpDescLocator);
const adpNoteAbsentEl = findLocator(adpNoteLocator);
if (!adpDescOnlyEl || !normalizeText(adpDescOnlyEl.textContent).startsWith('A unique candle')) {
  fail('acquadiparma description recipe did not resolve on notes-less product', normalizeText(adpDescOnlyEl?.textContent || '').slice(0, 60));
}
if (adpNoteAbsentEl) {
  fail('acquadiparma note_name fell back to a sibling panel when tasting notes were absent', normalizeText(adpNoteAbsentEl.textContent).slice(0, 60));
}
console.log('PASS: acquadiparma note_name stays empty when the tasting-notes panel is absent');

console.log('\nAll recipe checks passed.');
