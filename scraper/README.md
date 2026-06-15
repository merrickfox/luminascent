# Luminascent Scraper (Part 1)

Blueprint-driven visual scraper using Tampermonkey + a local Node server. Teach the system once per host where product lists, fields, and images live, then extract every product automatically.

## Architecture

- **Userscript** (`userscript/scraper.user.js`) — overlay UI in the browser, DOM blueprint authoring, extraction orchestration
- **Local server** (`server/server.js`) — serves schema/config, writes scraped `data.json` and image files
- **Schema** (`schema/candle.schema.json`) — portable field definitions mirroring backend `scrapedProductSchema`
- **Site data** (`sites/<host_slug>/`) — generated at runtime per configured host

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

1. Click **Browse mode**
2. Click **Detect groups** — finds repeated DOM structures (nav, footer, product grids)
3. Hover groups in the panel to highlight them on the page
4. Click the correct product group, then **Lock selected group**

Stores container/item locators and link strategy (`href` vs `js-click`).

### Product mode

1. Open a representative product page
2. Click **Product mode**
3. Click elements on the page — a context menu lists schema fields
4. Tag fields like `name`, `price_amount`, `description`, etc.
5. For nested content (e.g. notes inside description):
   - Tag the parent field first
   - Use **Add sub-tag under …** then choose **Also contains** or **Sometimes contains**
6. Click **Save product blueprint**

Locators use multi-signal matching (stable attributes, structural path, nearby labels, text samples) — not brittle CSS classes.

### Images mode

1. On a product page, click **Images mode**
2. Thumbnails appear in the panel
3. Click images in desired order (1, 2, 3…); click again to untag
4. Click **Save image selections**

### Extract mode

1. Return to the browse/list page
2. Click **Extract mode**
3. Click **Start extraction**

The script opens product URLs in background tabs (max 3 concurrent), waits for render completion, extracts tagged fields, POSTs `data.json` and image bytes to the server, then closes each tab.

## Output layout

```text
scraper/sites/aerin_com/
├── config.json
└── products/
    └── cedar-violet-abc12345/
        ├── data.json
        └── images/
            ├── 01.jpg
            └── 02.jpg
```

`data.json` mirrors the backend import shape (raw values — sanitisation is deferred to a later iteration).

## Schema

Field definitions live in `schema/candle.schema.json`. Each field has:

- `key`, `label`
- `scope`: `product`, `size`, `note`, `accord`, `image`
- `cardinality`: `single` or `multiple`
- `type`: `text`, `number`, `currency`, `boolean`, `url`

Swap this file for other project domains while keeping the same userscript/server architecture.

## Troubleshooting

- **Panel doesn't load** — confirm Tampermonkey is enabled and the script matches the page URL
- **Server errors** — ensure `node server.js` is running on port 8787
- **Mixed content blocked** — the userscript uses `GM_xmlhttpRequest` with `@connect localhost` to bypass https → http restrictions
- **JS-only product links** — browse mode records `js-click` strategy; extraction works best with real `href` links
- **Auto-scrape tabs stay open** — browser popup blockers may prevent `window.close()`; check Tampermonkey tab permissions

## Out of scope (Part 1)

- Value sanitisation/normalisation
- Push to backend `/import` endpoint
