# Luminascent Scraper (Part 1)

Blueprint-driven visual scraper using Tampermonkey + a local Node server. Teach the system once per host where product lists, fields, and images live, then extract every product automatically.

This is the **browser-based** scraping path in the Luminascent repo. It produces raw DOM captures plus an LLM-ready intermediary (`llm_input.json`). It is separate from the Python pipeline at `scrapling/crawler/`, which already produces import-ready JSON for the admin panel.

## What it produces

After configuration and extraction, each product becomes a folder under `sites/<host_slug>/products/<url_slug>/`:

| Artifact | Producer | Purpose |
|----------|----------|---------|
| `data.json` | Userscript (via server) | Raw extracted values — no parsing or normalisation |
| `llm_input.json` | Server | Structured input for the LLM pass — raw values + derived_targets |
| `llm_output.json` | Pipeline | Cached per-field LLM extraction results |
| `products.json` | Pipeline | One import-ready array per site (backend `scrapedProductSchema`) |
| `images/NN.ext` | Server | Downloaded image bytes in scrape order (`01.jpg`, `02.jpg`, …) |

The host blueprint lives at `sites/<host_slug>/config.json` and is reused for every extraction run on that domain.

`scraper/sites/` is gitignored — scraped output stays local.

## Architecture

```text
┌─────────────────────┐     GM_xmlhttpRequest      ┌──────────────────────┐
│  Tampermonkey       │ ◄────────────────────────► │  Local Node server   │
│  scraper.user.js    │   http://127.0.0.1:8777    │  server/server.js    │
│                     │                            │                      │
│  • Overlay UI       │                            │  • Read/write config │
│  • Blueprint author │                            │  • Write data.json   │
│  • DOM extraction   │                            │  • Build llm_input   │
│  • Image fetch      │                            │  • Save image files  │
└─────────┬───────────┘                            └──────────┬───────────┘
          │                                                     │
          │  runs in merchant site DOM                          │  reads/writes
          ▼                                                     ▼
   Product pages in browser                          scraper/sites/<host_slug>/
                                                     scraper/schema/candle.schema.json
```

**Separation of concerns:**

- The **userscript** tags fields (including `also_contains` / `sometimes_contains` relationships), discovers product URLs from list pages, opens product tabs, and extracts raw DOM values.
- The **server** persists the host blueprint, writes `data.json`, assembles `llm_input.json` from the blueprint + schema + raw data, and saves image files.
- A **LLM pipeline** (Part 2) reads `llm_input.json`, emits `products.json`, and can push to the backend import API.

## Repository layout

```text
scraper/
├── README.md
├── package.json              # dev dep: linkedom (recipe verification)
├── schema/
│   └── candle.schema.json    # portable field definitions
├── server/
│   └── server.js             # local HTTP API + file writer
├── userscript/
│   ├── src/                  # the scraper code, split into ordered edit-units
│   │   ├── manifest.json     # concat order (single source of truth)
│   │   └── 00-constants.js … 07-init.js
│   ├── bundle.mjs            # assembles src/* into one IIFE bundle
│   ├── build.mjs             # regenerates the standalone scraper.user.js
│   ├── scraper.loader.user.js # thin loader — install this in Tampermonkey
│   └── scraper.user.js       # generated standalone fallback (CSP/offline)
├── scripts/
│   └── verify-recipes.mjs    # offline locator regression checks
└── sites/                    # generated at runtime (gitignored)
    └── <host_slug>/
        ├── config.json
        └── products/
            └── <url_slug>/
                ├── data.json
                ├── llm_input.json
                └── images/
```

## Quick start

### 1. Start the local server

```bash
cd scraper/server
node server.js
```

Server listens on `http://127.0.0.1:8777` by default. Override with `PORT=8787 node server.js` if needed — the userscript hardcodes `8777`, so change both if you use a custom port.

### 2. Install the Tampermonkey loader

> **Use Firefox for the loader.** The loader runs the bundle with a direct
> `eval`, which strict-CSP sites (e.g. Marks & Spencer) block on Chrome — there
> the userscript runs in page context, so the page's CSP applies and the eval is
> refused, even with "Allow user scripts" enabled. Firefox's Tampermonkey runs
> granted userscripts in a special context that bypasses the page CSP, so the
> live-reload loop works everywhere. If you must stay on Chrome, use the
> standalone build (see **Standalone fallback** below).

1. Open Tampermonkey → **Create a new script**
2. Replace the template with the contents of `userscript/scraper.loader.user.js`
3. Save and enable the script

The loader is a thin shim: on every page it fetches the real code from the
server (`GET /userscript/bundle.js`) and runs it. The actual scraper lives in
`userscript/src/*` — **edit a file there and reload the page; the change is live
with no Tampermonkey re-paste.** The server assembles the bundle fresh on each
request, so no build step is needed during development.

Required grants: `GM_xmlhttpRequest`, `GM_setValue`, `GM_getValue`, `GM_openInTab`, `GM_addStyle`.  
Required connect hosts: `localhost`, `127.0.0.1` (bypasses https → http mixed-content restrictions).

The script matches `*://*/*` and injects a draggable overlay panel on every page.

**How the code is organised:** `src/` holds the original single IIFE split into
ordered edit-units (`00-constants.js` … `07-init.js`, order set by
`src/manifest.json`). They are concatenated back into one scope at runtime —
behaviour is byte-identical to the old single file; the files are purely for
editing convenience. `bundle.mjs` is the shared assembler used by both the
server endpoint and the build script.

**Standalone fallback:** if you must run the scraper on **Chrome** (whose
strict-CSP pages block the loader's direct `eval` — Firefox does not; see the
note above), or when the server isn't running, install the self-contained
`userscript/scraper.user.js` instead. It bundles the code inline so no `eval` is
needed, at the cost of a rebuild + re-paste per change. Regenerate it from `src/`
with:

```bash
cd scraper
npm run build:userscript
```

### 3. Configure a host

1. Navigate to a product browse/list page on the target site
2. Open the **Luminascent Scraper** panel (top-right overlay)
3. Click **Configure for scraping** — creates `sites/<host_slug>/config.json` on the server

Host slugs are derived from the hostname: lowercase, strip `www.`, replace non-alphanumerics with `_` (e.g. `www.acquadiparma.com` → `acquadiparma_com`).

## Workflow

```text
Configure → Browse → Product → Images → Extract
```

Each mode is entered from the panel home screen after configuration. Progress is shown in the panel header: `Browse ✓ · Fields N · Images N`.

### Browse mode

1. Click **Browse mode** — the panel auto-scans the page and keeps watching for late-loaded content (API grids, infinite scroll)
2. Hover groups in the panel to highlight them on the page
3. Click the correct product group, then **Lock selected group**

**How groups are detected:** repeated sibling elements are clustered by **structure-type fingerprints** — a hash of tag name, semantic attributes (with digits normalised), and child layout. This groups dynamically injected product cards even when each item has a different `data-id`. Nav/footer groups are deprioritised via region heuristics (`nav`, `header`, `footer`, `main`).

**What gets saved:** a recipe, not concrete URLs or element instances:

| Key | Meaning |
|-----|---------|
| `container` | Stable anchor (e.g. `data-block-id`, grid wrapper class) + relative path to the product grid |
| `itemFingerprint` | Structural fingerprint for product cards within the grid |
| `linkRule` | Relative selector within each card to the product link, plus `strategy`: `href` or `js-click` |

Extraction re-runs this recipe on whatever list page is loaded (including page 2 of pagination). URLs are computed live and never stored in the blueprint.

**Pagination:** navigate to each list page (or infinite-scroll until all items load), then run Extract mode. The browse recipe applies to the current DOM; there is no built-in pagination crawler.

### Product mode

1. Open a representative product page
2. Click **Product mode**
3. **Click an element on the page** — it gets an orange outline and appears as "Selected" in the panel
4. **Click a field button in the panel** (Product Name, Price, Description, etc.) to tag it
5. Repeat for each field you need
6. For embedded content (e.g. size inside product name, currency inside price string): tag the parent field on the page, then on its card click **+ Add field** under **Also contains** or **Sometimes contains** and pick the related schema field. The server uses these tags when building `llm_input.json` — the userscript does not parse embedded values itself.
7. Click **Save product blueprint**

Field tagging happens in the panel (not a floating menu), so you always see what to do next.

**Locator recipes:** each tag stores one or more locators with stable semantic attributes (`itemprop`, `data-ui-id`, `data-dynamic`, `data-attribute-code`, etc.) plus relative structural position. Instance-specific attributes (`data-id`, per-product `data-product-name`, numeric IDs) are stripped on save. Example product text, prices, and per-item IDs are not used for matching — only shown as `textSample` hints in the panel.

**Multiple tags per field:** use **+ Add tag** to capture several DOM nodes into one field (stored as an array of raw strings). Use **Re-tag** to replace all locators for a field. Removing the last tag deletes the field.

**Direct vs derived fields:** tag a field directly when it has its own DOM node (e.g. a size swatch row). Use **Also contains** when a value is embedded inside another field's text (e.g. burn time inside the description paragraph). Use **Sometimes contains** when a value may or may not appear in that parent (same machinery, `confidence: "sometimes"` in `derived_targets`).

### Images mode

1. On a product page, click **Images mode**
2. Thumbnails appear in the panel (from `<img>`, `<picture>`, and CSS `background-image`)
3. Click images in desired order (1, 2, 3…); click again to untag
4. Click **Save image selections**

Each selection stores a locator recipe (same matching system as product fields) plus the example `src` from the authoring page. During extraction the userscript re-resolves the locator, fetches the live `src`, downloads bytes via `GM_xmlhttpRequest`, and POSTs base64 to the server.

### Extract mode

1. Return to the browse/list page (with all products visible or paginated as needed)
2. Click **Extract mode**
3. Choose **All at once** or **Batch** (default batch size: 5)
4. Click **Start extraction**

**Extraction flow:**

```text
List page (orchestrator tab)
  │
  ├─ collectProductUrls() from browse recipe
  │
  └─ for each URL:
       GM_openInTab(url#lumiscrape=1)   ← background tab
         │
         ├─ waitForReady() until locators resolve (~60% threshold)
         ├─ buildScrapedData() → raw fields + image metadata
         ├─ POST /product → data.json + llm_input.json
         ├─ fetch each image → POST /image → images/NN.ext
         ├─ markExtractResult(ok)
         └─ window.close()
```

The `#lumiscrape=1` hash tells the userscript to run in **auto-scrape mode** (no panel UI) on that tab. Extraction progress is tracked in Tampermonkey storage (`lumiscrape_extract_state`) so the orchestrator tab can show running/completed/failed counts.

| Mode | Behaviour |
|------|-----------|
| **All at once** | Opens every product URL immediately |
| **Batch** | Opens N tabs at a time; launches the next batch when the current batch finishes. Batch timeout: 90 seconds |

Use Batch on large catalogues to avoid opening hundreds of tabs simultaneously.

## Local server API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Health check — `{ ok: true, port }` |
| GET | `/schema` | Returns `schema/candle.schema.json` |
| GET | `/config?host=<host>` | Load host blueprint |
| POST | `/config` | Save host blueprint — body: `{ host, config }` |
| POST | `/product` | Save scraped product — body: `{ host, url, urlSlug?, data }` |
| POST | `/image` | Save image bytes — body: `{ host, urlSlug, order, ext?, dataBase64 }` |
| GET | `/slug?url=<url>` | Generate filesystem-safe product slug |

All responses are JSON. CORS is open (`*`) for browser access.

**Product slug algorithm:** last URL path segment, sanitised to lowercase hyphenated text (max 60 chars), plus an 8-char SHA-1 prefix of the full URL — e.g. `homecandlebuongiorno-html-bc5a815d`.

## Host blueprint (`config.json`)

```json
{
  "host": "www.acquadiparma.com",
  "hostSlug": "acquadiparma_com",
  "version": 1,
  "createdAt": "…",
  "updatedAt": "…",
  "browse": { "container": { … }, "itemFingerprint": "…", "linkRule": { … } },
  "product": { "fields": [ … ] },
  "images": [ … ]
}
```

Each entry in `product.fields`:

| Key | Description |
|-----|-------------|
| `fieldKey` | Schema key (e.g. `name`, `price_amount`) |
| `scope`, `type` | Copied from schema at tag time |
| `locators` | Array of recipe objects (see below) |
| `also_contains` | Schema keys embedded in this field's raw value |
| `sometimes_contains` | Same, but flagged as optional/variable |
| `taggedAt` | ISO timestamp |

Each **locator recipe**:

| Key | Description |
|-----|-------------|
| `tag` | Element tag name |
| `attrs` | Stable attribute key/value pairs used for candidate search |
| `anchorAttrs` | Attributes of a stable ancestor anchor |
| `relativePathFromAnchor` | CSS path from anchor to target (nth-of-type segments) |
| `extraction` | `{ type: "text" }` or `{ type: "attribute", attribute: "src" }` |
| `textSample` | Authoring-time hint only — not used as a hard match |
| `matchMode` | Always `"recipe"` in current versions |

**Matching at extraction time:** candidates are gathered by attribute queries and anchor paths, then scored by attribute overlap, structural path tail overlap, and main-content region bias. Matches below an evidence threshold are rejected to avoid grabbing whole page regions.

Each entry in `images`:

| Key | Description |
|-----|-------------|
| `order` | 1-based display/scrape order |
| `src` | Example URL from authoring page |
| `locator` | Recipe to re-find the image element |
| `kind` | `img`, `picture`, or `background` |

## Output artifacts

### `data.json` (raw extraction)

```json
{
  "source_url": "https://www.example.com/product/foo",
  "scrapedAt": "2026-06-16T08:31:16.224Z",
  "fields": {
    "name": "buongiorno",
    "price_amount": "£71.00",
    "note_name": "Olfactive family: Aromatic green Tasting Notes: Italian lemon, …",
    "description": "Diffuse enchanting scents… Weight: 200g / 7 oz Burning time: up to 50 hours …",
    "size_value": "200G 500G"
  },
  "images": [
    { "source_url": "https://…/01.jpg", "position": 0, "is_primary": true },
    { "source_url": "https://…/02.jpg", "position": 1, "is_primary": false }
  ]
}
```

Rules:

- Values live under `fields`, keyed by schema `fieldKey`.
- One locator hit → string. Multiple locator hits (or multiple tags) → array of strings (deduplicated).
- No splitting, parsing, type coercion, or normalisation — whatever text/attribute the DOM yields is stored verbatim.
- `cardinality` in the schema is a hint for the LLM step only; the extractor ignores it.

### `llm_input.json` (LLM intermediary)

Built automatically by the server whenever `config.json` and the schema exist at save time.

```json
{
  "source_url": "https://www.example.com/product/foo",
  "schema": "candle",
  "schema_version": 1,
  "generatedAt": "2026-06-16T08:31:16.225Z",
  "fields": [
    {
      "fieldKey": "price_amount",
      "scope": "size",
      "type": "currency",
      "value": "£71.00",
      "also_contains": [
        { "fieldKey": "price_currency", "scope": "size", "type": "text", "label": "Price Currency" }
      ],
      "sometimes_contains": []
    }
  ],
  "derived_targets": [
    {
      "fieldKey": "price_currency",
      "scope": "size",
      "type": "text",
      "derive_from": "price_amount",
      "confidence": "also"
    }
  ],
  "images": [ … ]
}
```

- `fields` — one entry per tagged blueprint field, with raw `value` plus expanded containment metadata (schema types/labels).
- `derived_targets` — flat list of every field the LLM must extract from a parent value. `confidence` is `"also"` or `"sometimes"`.
- A field can appear both as a directly tagged `fields` entry (with its own raw value) and as a `derived_targets` entry (when also embedded elsewhere).

### On-disk layout example

```text
scraper/sites/acquadiparma_com/
├── config.json
└── products/
    └── homecandlebuongiorno-html-bc5a815d/
        ├── data.json
        ├── llm_input.json
        └── images/
            ├── 01.jpg
            ├── 02.jpg
            └── 03.jpg
```

## Schema

Field definitions live in `schema/candle.schema.json`. Each field has:

| Property | Values | Notes |
|----------|--------|-------|
| `key` | e.g. `name`, `size_grams` | Used in blueprint and output |
| `label` | Human-readable | Shown in the userscript panel |
| `scope` | `product`, `size`, `note`, `accord`, `image` | Groups related fields for the LLM |
| `cardinality` | `single` or `multiple` | Hint for LLM only |
| `type` | `text`, `number`, `currency`, `boolean`, `url` | Expected parsed type (future step) |
| `mapsTo` | e.g. `notes[].name` | Target path in backend import JSON |
| `required` | boolean | Import requirements (future step) |

The schema mirrors backend `scrapedProductSchema` in `backend/src/features/import/schema.ts`. Swap this file for other project domains while keeping the same userscript/server architecture.

**Target import shape (Part 2):** nested product with `sizes[]`, `notes[]`, `accords[]`, `images[]` — not the flat `fields` map the extractor produces today.

## Recipe verification

Offline regression checks for locator hygiene and resolution:

```bash
cd scraper
npm install
node scripts/verify-recipes.mjs
```

Uses `linkedom` to parse saved HTML fixtures and assert that browse/product recipes resolve without instance-bound attributes. Requires local `sites/aerin_com/config.json` and fixture HTML (used during development).

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Panel doesn't load | Confirm Tampermonkey is enabled; script matches the page URL |
| Server errors | Ensure `node server.js` is running on port **8777** (or update `SERVER` in the userscript) |
| Mixed content blocked | Userscript uses `GM_xmlhttpRequest` with `@connect localhost` to bypass https → http |
| JS-only product links | Browse mode records `js-click` strategy; extraction works best with real `href` links |
| Auto-scrape tabs stay open | Popup blockers may prevent `window.close()`; check Tampermonkey tab permissions |
| Wrong product URL count | Reload the userscript (v1.0.8+). Re-lock the browse group so recipes exclude instance-specific attributes |
| Fields empty on another product | Re-tag on a representative page; locators must use stable semantic signals, not example names/prices |
| Duplicate/wrong field match | Check for ambiguous locators; add a more specific anchor or re-tag with a narrower element |
| Batch extraction stalls | Failed tabs count toward completion; check failed URLs in Extract mode status. Batch timeout is 90s |

## Blueprint migration

Configs saved before v1.0.8 may contain instance-bound locators (`data-id`, example `textSample`/`anchor` values, capped `membersSample` lists). The userscript normalizes these on load where possible, but you should:

1. Re-lock the browse group on a list page (regenerates `container`, `itemFingerprint`, `linkRule`)
2. Re-tag product fields and images on a representative product page

No URLs or DOM element references are stored in blueprints — only reusable matching rules.

## Part 2 — LLM pass pipeline

After extraction, run the LLM pass to turn `llm_input.json` files into one import-ready `products.json` per site.

### Setup

```bash
cd scraper
npm install
```

Ensure Ollama is running locally with your model (default: `qwen3-coder:30b`):

```bash
ollama pull qwen3-coder:30b
```

Configure provider settings in `pipeline.config.json`. Optional per-site overrides (brand name, slug, category) go in `sites/<host_slug>/pipeline.json`:

```json
{
  "brand_name": "Acqua di Parma",
  "brand_slug": "acqua-di-parma",
  "category_slug": "candle"
}
```

### Run LLM pass + assemble

```bash
# All sites, only new/changed products (default)
npm run pipeline:run

# One site
npm run pipeline -- run --brand acquadiparma_com

# One product (upserts into existing products.json by slug)
npm run pipeline -- run --brand acquadiparma_com --product buongiornocandleparigi-html-857c9307

# Reprocess everything
npm run pipeline -- run --brand acquadiparma_com --reprocess

# Replace products.json with only what this run assembles (destructive for partial runs)
npm run pipeline -- run --brand acquadiparma_com --product buongiornocandleparigi-html-857c9307 --fresh

# Dry run (no LLM calls)
npm run pipeline -- run --brand acquadiparma_com --dry-run
```

**What happens:**

1. For each product, reads `llm_input.json` and runs per-field LLM extraction (plus extra passes for `derived_targets` / `also_contains`).
2. Caches results in `llm_output.json` (skipped on subsequent runs unless input changed or `--reprocess`).
3. Assembles nested import records from schema `mapsTo` paths and writes `sites/<host_slug>/products.json`. By default, partial runs **upsert** into the existing file (matched by `slug`, then `source_url`). Use `--fresh` to replace the file with only the products assembled in this command.

### Push to backend

The push command reads `products.json`, base64-encodes local `images/NN.ext` files at request time, and POSTs to the backend import API:

```bash
# Start backend first: cd backend && npm run dev

npm run pipeline:push -- --brand acquadiparma_com

# All sites
npm run pipeline -- push --all-brands

# Options
npm run pipeline -- push --brand acquadiparma_com --backend-url http://localhost:8023 --api-key dev-admin-key --refetch-images
```

Images with a `file` path in `products.json` are uploaded as inline bytes. The admin panel drag-drop flow still works with remote `source_url` only.

### Pipeline layout

```text
scraper/
├── pipeline.config.json       # provider + defaults
├── pipeline/
│   ├── cli.ts                 # run / push commands
│   ├── extract.ts             # per-field LLM extraction
│   ├── assemble.ts            # flat fields → nested products.json
│   └── providers/             # ollama (default), claude (stub)
└── schema/
    └── candle.schema.json     # fields + mapsTo + llm instructions
```

Swap `candle.schema.json` for another domain schema to reuse the pipeline on a different project.

### Generic schema fields

Each field in the schema can define:

| Property | Purpose |
|----------|---------|
| `mapsTo` | Target path in import JSON (e.g. `sizes[].price_amount`, `notes[].name`) |
| `llm.instruction` | Prompt guidance for extracting/cleaning this field |
| `llm.deterministic` | Skip LLM — derive in harness (slugs, source_url) |
| `llm.optional` | Extraction may return null |

## Out of scope

- **Pagination automation** — no multi-page list crawler; run Extract per page or scroll manually
