# Luminascent Scraper (Part 1)

Blueprint-driven visual scraper using Tampermonkey + a local Node server. Teach the system once per host where product lists, fields, and images live, then extract every product automatically.

## Architecture

- **Userscript** (`userscript/scraper.user.js`) — overlay UI in the browser, DOM blueprint authoring, raw field extraction
- **Local server** (`server/server.js`) — serves schema/config, writes scraped `data.json`, builds `llm_input.json`, and saves image files
- **Schema** (`schema/candle.schema.json`) — portable field definitions mirroring backend `scrapedProductSchema`
- **Site data** (`sites/<host_slug>/`) — generated at runtime per configured host

Separation of concerns:

- The userscript tags fields (including `also_contains` / `sometimes_contains` relationships) and extracts raw DOM text into `data.json`. Each field value is an **array of text chunks** — one entry per tagged element. A single tag produces a one-item array.
- The server reads the host blueprint, schema, and raw `data.json`, then assembles `llm_input.json` — the intermediary artifact for a future LLM pass that will parse embedded values (e.g. size from product name, individual notes from a comma-separated line) into import-ready JSON.

## Quick start

### 1. Start the local server

```bash
cd scraper/server
node server.js
```

Server listens on `http://127.0.0.1:8787`.

Endpoints:

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Health check |
| GET | `/schema` | Returns candle schema |
| GET | `/config?host=<host>` | Load host blueprint |
| POST | `/config` | Save host blueprint |
| POST | `/product` | Save scraped product data |
| POST | `/image` | Save scraped image bytes |
| GET | `/slug?url=<url>` | Generate filesystem-safe product slug |

### 2. Install the Tampermonkey userscript

1. Open Tampermonkey → **Create a new script**
2. Replace the template with the contents of `userscript/scraper.user.js`
3. Save and enable the script

The script requires grants for `GM_xmlhttpRequest`, `GM_setValue`, `GM_getValue`, and `GM_openInTab`, plus `@connect localhost`.

### 3. Configure a host

1. Navigate to a product browse/list page on the target site
2. Open the **Luminascent Scraper** panel (top-right overlay)
3. Click **Configure for scraping** — creates `sites/<host_slug>/config.json`

## Workflow

```text
Configure → Browse → Product → Images → Extract
```

### Browse mode

1. Click **Browse mode** — the panel auto-scans and keeps watching for late-loaded content (API grids, infinite scroll)
2. Hover groups in the panel to highlight them on the page
3. Click the correct product group, then **Lock selected group**

Detection uses **structure-type fingerprints** (tag + child layout + semantic attributes), not unique per-item IDs like `data-id`. That lets dynamically injected product cards group together even when each item has a different ID. Nav/footer groups are deprioritized via generic region heuristics (`nav`, `header`, `footer`, `main`).

Locking a group saves a **recipe**, not concrete URLs or element instances:

- `container` — stable anchor (e.g. `data-block-id`) + relative path to the grid
- `itemFingerprint` — structural fingerprint for product cards within the grid
- `linkRule` — relative selector within each card to the product link (`href` vs `js-click`)

Extraction re-runs this recipe on whatever page is loaded (including page 2 of pagination). URLs are computed live and never stored in the blueprint.

### Product mode

1. Open a representative product page
2. Click **Product mode**
3. **Click an element on the page** — it gets an orange outline and appears as "Selected" in the panel
4. **Click a field button in the panel** (Product Name, Price, Description, etc.) to tag it
5. Repeat for each field you need. Tagging the same field again **adds another element** (useful when data is split across multiple nodes). Use **Re-tag** on a field card to replace all elements with a new selection, or **Add another element** to append without re-picking the field name.
6. For embedded content (e.g. size inside product name, price amount inside currency string): tag the parent field on the page, then on its card click **+ Add field** under **Also contains** or **Sometimes contains** and pick the related schema field (e.g. Size Value). The server uses these tags when building `llm_input.json` for the future LLM pass — the userscript does not parse embedded values itself.
7. Click **Save product blueprint**

Field tagging happens in the panel (not a floating menu), so you always see what to do next. Tagging means "the data for this field lives somewhere in the selected element(s)" — the tool does not split notes into arrays, parse sizes, or otherwise structure values. Schema `cardinality` (`single` / `multiple`) is informational for the future LLM step only.

Product field locators are also recipes: stable semantic attributes (`itemprop`, `data-ui-id`, `data-dynamic`, `data-attribute-code`, etc.) plus relative structural position. Example product text, prices, and per-item IDs are **not** used for matching — only shown as `textSample` hints in the panel.

### Images mode

1. On a product page, click **Images mode**
2. Thumbnails appear in the panel
3. Click images in desired order (1, 2, 3…); click again to untag
4. Click **Save image selections**

### Extract mode

1. Return to the browse/list page
2. Click **Extract mode**
3. Click **Start extraction**

The script opens every detected product URL in a background tab, waits for render completion, extracts tagged fields as raw values, POSTs to the server (which writes `data.json` and `llm_input.json`), uploads image bytes, then closes each tab.

## Output layout

```text
scraper/sites/aerin_com/
├── config.json
└── products/
    └── cedar-violet-abc12345/
        ├── data.json
        ├── llm_input.json
        └── images/
            ├── 01.jpg
            └── 02.jpg
```

- `data.json` — raw extracted text chunks from the DOM (no parsing or normalisation). Each field key maps to an array of strings, one per tagged element.
- `llm_input.json` — server-built intermediary for the future LLM pass. Each tagged field includes its raw `value` array plus `also_contains` / `sometimes_contains` metadata (with schema types/labels). `derived_targets` lists every field the LLM must extract from a parent value (e.g. `size_value` and `size_unit` from `name`).

Existing product folders keep their old `data.json` / `llm_input.json` shape until you re-run extraction. After re-scraping, values appear as raw arrays under each `fieldKey`.

## Schema

Field definitions live in `schema/candle.schema.json`. Each field has:

- `key`, `label`
- `scope`: `product`, `size`, `note`, `accord`, `image` — groups fields in the tagging UI only; extraction does not nest data by scope
- `cardinality`: `single` or `multiple` — informational for the future LLM step; extraction always stores raw text arrays
- `type`: `text`, `number`, `currency`, `boolean`, `url`

Swap this file for other project domains while keeping the same userscript/server architecture.

## Troubleshooting

- **Panel doesn't load** — confirm Tampermonkey is enabled and the script matches the page URL
- **Server errors** — ensure `node server.js` is running on port 8787
- **Mixed content blocked** — the userscript uses `GM_xmlhttpRequest` with `@connect localhost` to bypass https → http restrictions
- **JS-only product links** — browse mode records `js-click` strategy; extraction works best with real `href` links
- **Auto-scrape tabs stay open** — browser popup blockers may prevent `window.close()`; check Tampermonkey tab permissions
- **Wrong product URL count in Extract mode** — reload the userscript (v1.0.8+). Legacy configs are normalized on load; for best results re-lock the browse group and re-tag product fields so recipes exclude instance-specific attributes
- **Fields empty on a different product page** — re-tag fields on a representative product page; locators must use stable semantic signals, not example product names/prices

## Blueprint migration

Configs saved before v1.0.8 may contain instance-bound locators (`data-id`, example `textSample`/`anchor` values, capped `membersSample` lists). The userscript normalizes these on load where possible, but you should:

1. Re-lock the browse group on a list page (regenerates `container`, `itemFingerprint`, `linkRule`)
2. Re-tag product fields and images on a representative product page

No URLs or DOM element references are stored in blueprints — only reusable matching rules.

## Out of scope (Part 1)

- LLM pass (parsing `llm_input.json` into import-ready JSON)
- Value sanitisation/normalisation
- Push to backend `/import` endpoint
