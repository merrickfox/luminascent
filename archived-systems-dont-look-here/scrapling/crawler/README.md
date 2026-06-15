# Candle Crawler Pipeline

Production crawler for candle category pages. Reads a brand list, crawls each category URL with full stealth, extracts structured product data, and writes per-brand JSON output with resume and failure tracking.

## One-time setup

```bash
cd scrapling/crawler
./setup.sh
source .venv/bin/activate
ollama pull qwen3-coder:30b
```

## Quick start

```bash
cd scrapling/crawler
source .venv/bin/activate

cp brands.json.example brands.json   # edit with your brands
python crawl_brands.py brands.json --brand "Acqua di Parma"
python view.py "Acqua di Parma"
```

Each `brands.json` entry is a **category/browse page** (many candles), not a single product. A brand can have multiple URLs.

---

## Command reference

All commands assume `cd scrapling/crawler && source .venv/bin/activate`.

### `crawl_brands.py` — production crawler

```
python crawl_brands.py <brands_file> [options]
```

| Flag | Description |
|------|-------------|
| `brands_file` | JSON array of `{brand, url}` entries (required) |
| `--brand` | Run a single brand from the list |
| `--resume` | Skip completed sources and already-extracted products |
| `--no-crawl` | Reprocess from stored pass without scraping |
| `--no-extract` | Crawl only; skip extraction |
| `--pass <id>` | Scrape pass to extract from (default: latest). Use `legacy` for old `raw/` data |
| `--list-passes` | List stored passes for `--brand` and exit |
| `--no-llm` | Deterministic extraction only (no Ollama) |
| `--force-llm` | Run Ollama on every product (mutually exclusive with `--no-llm`) |
| `--no-reparse-html` | Use stored `json_ld`/`text_content` instead of re-parsing stored HTML |
| `--no-colors` | Skip Ollama color generation for notes/accords |
| `--no-audit-checking` | Skip post-extract validation pass (`llm/` artifacts are still written) |
| `--no-audit-llm` | Run audit checks but skip LLM judgment on flagged products |
| `--only <text>` | Re-extract products whose name or URL contains `<text>`; merges into existing `products.json` (requires `--brand`; uses stored pass; LLM forced on by default) |
| `--retry-missing <key>` | Re-extract products where `<key>` is empty (e.g. `notes`, `accords`); merges into existing `products.json` (requires `--brand`; uses stored pass; LLM forced on by default) |
| `--max-products-per-brand` | Limit products queued per brand |
| `--max-pages` | Max category pages to paginate per source (default: 10) |
| `--dev` | Cache responses to disk for selector iteration |
| `--ollama-model` | Ollama model (default: `qwen3-coder:30b`) |
| `--output-dir` | Output root (default: `./output`) |

**Crawl + extract (default)**

```bash
python crawl_brands.py brands.json
python crawl_brands.py brands.json --brand "Acqua di Parma"
python crawl_brands.py brands.json --brand "Acqua di Parma" --max-products-per-brand 5
```

**Resume after interruption**

```bash
python crawl_brands.py brands.json --resume
python crawl_brands.py brands.json --brand "Acqua di Parma" --resume
```

**Crawl only (store HTML pass, skip extraction)**

```bash
python crawl_brands.py brands.json --brand "Acqua di Parma" --no-extract
```

**Reprocess without scraping** (reads latest pass, re-parses stored HTML, overwrites `products.jsonl`)

```bash
python crawl_brands.py brands.json --brand "Acqua di Parma" --no-crawl
```

**Reprocess variants**

```bash
# Deterministic only — fast, no Ollama
python crawl_brands.py brands.json --brand "Acqua di Parma" --no-crawl --no-llm

# Force LLM on every product
python crawl_brands.py brands.json --brand "Acqua di Parma" --no-crawl --force-llm

# Target a specific pass (timestamp from --list-passes)
python crawl_brands.py brands.json --brand "Acqua di Parma" --no-crawl --pass 2026-06-09T09-40-41Z

# Re-extract using stored json_ld/text (skip HTML re-parse)
python crawl_brands.py brands.json --brand "Acqua di Parma" --no-crawl --no-reparse-html

# Reprocess legacy data (pre-passes crawls in raw/)
python crawl_brands.py brands.json --brand "Acqua di Parma" --no-crawl --pass legacy
```

**Inspect stored passes**

```bash
python crawl_brands.py brands.json --brand "Acqua di Parma" --list-passes
```

**Fix one product or retry a missing field** (re-extract from stored HTML, merge into existing `products.json`; other products untouched)

```bash
# Re-extract a single product by name or URL substring
python crawl_brands.py brands.json --brand "Acqua di Parma" --only "Signatures of the Sun"

# Re-extract every product missing notes
python crawl_brands.py brands.json --brand "Acqua di Parma" --retry-missing notes

# Target a specific pass
python crawl_brands.py brands.json --brand "Acqua di Parma" --retry-missing notes --pass 2026-06-09T09-40-41Z
```

---

### `view.py` — inspect results

```
python view.py [brand] [options]
```

| Flag | Description |
|------|-------------|
| `brand` | Brand name as it appears in `brands.json` |
| `--file` | Direct path to `products.json` or `.jsonl` (instead of brand name) |
| `--index N` | Show full JSON for record N (1-based) |
| `--failures` | Show `failures.jsonl` summary table |
| `--timings` | Show crawl/extract timing rollups from `timings.json` or `state.json` |
| `--passes` | List stored scrape passes (timestamp, product count, HTML count) |
| `--output-dir` | Output root (default: `./output`) |

**Product summary and detail**

```bash
python view.py "Acqua di Parma"
python view.py "Acqua di Parma" --index 1
python view.py --file output/acqua-di-parma/products.json --index 3
```

**Failures and tracebacks**

```bash
python view.py "Acqua di Parma" --failures
python view.py "Acqua di Parma" --failures --index 1   # full failure JSON + traceback
```

**Passes and timings**

```bash
python view.py "Acqua di Parma" --passes
python view.py "Acqua di Parma" --timings
```

---

### `run.py` — single-URL dev mode

For quick tests without `brands.json`. Output goes to `output/<domain>/passes/<timestamp>/`.

```
python run.py [seed_url] [options]
```

| Flag | Description |
|------|-------------|
| `seed_url` | Category URL to crawl (required unless `--test-html`) |
| `--no-crawl` | Skip crawl; extract from latest pass or legacy raw data |
| `--no-extract` | Crawl only; skip extraction |
| `--no-llm` | Deterministic extraction only |
| `--force-llm` | Run Ollama on every product |
| `--no-reparse-html` | Use stored json_ld/text instead of re-parsing HTML |
| `--no-colors` | Skip Ollama color generation for notes/accords |
| `--max-pages` | Max category pages (default: 10) |
| `--max-products` | Max product pages to fetch |
| `--dev` | Enable response caching |
| `--ollama-model` | Ollama model (default: `qwen3-coder:30b`) |
| `--test-html` | Extract from a local HTML file (no crawl) |
| `--output-dir` | Output root (default: `./output`) |

**Examples**

```bash
# Crawl + extract a single site
python run.py "https://www.acquadiparma.com/en/gb/home-collection/home-collection-candles/" --max-products 5

# Crawl only
python run.py "https://example.com/candles" --no-extract

# Re-extract latest pass
python run.py "https://example.com/candles" --no-crawl --no-llm

# Test extraction on a saved HTML file
python run.py --test-html path/to/page.html
python run.py --test-html path/to/page.html --no-llm
python run.py "https://example.com/product" --test-html path/to/page.html --force-llm
```

---

## Common workflows

| Goal | Command |
|------|---------|
| First crawl of a brand | `python crawl_brands.py brands.json --brand "Acqua di Parma"` |
| Pick up after a crash | `python crawl_brands.py brands.json --brand "Acqua di Parma" --resume` |
| Fix extraction logic, no re-scrape | `python crawl_brands.py brands.json --brand "Acqua di Parma" --no-crawl --no-llm` |
| Re-run LLM on stored pages | `python crawl_brands.py brands.json --brand "Acqua di Parma" --no-crawl --force-llm` |
| Fix one product (e.g. missing notes) | `python crawl_brands.py brands.json --brand "Acqua di Parma" --only "Signatures of the Sun"` |
| Retry all products missing a field | `python crawl_brands.py brands.json --brand "Acqua di Parma" --retry-missing notes` |
| Compare passes | `python view.py "Acqua di Parma" --passes` |
| Debug a bad product | `python view.py "Acqua di Parma" --index 5` |
| Inspect LLM input/output for a product | `python view.py "Acqua di Parma" --llm --index 5` |
| Review post-extract audit report | `python view.py "Acqua di Parma" --audit` |
| Debug a failure | `python view.py "Acqua di Parma" --failures --index 1` |
| Check how long things took | `python view.py "Acqua di Parma" --timings` |

## Output layout

Per brand under `output/<brand-slug>/`:

```
output/acqua-di-parma/
  products.json          # final compiled array (the deliverable)
  products.jsonl         # latest extracted records
  passes/
    2026-06-09T09-40-41Z/    # one folder per crawl run (UTC timestamp)
      pages/<key>.html       # full product page HTML
      llm/<key>.json         # exact LLM prompts, schemas, and responses per product
      audit_report.json      # post-extract validation findings and summary
      products.raw.jsonl     # json_ld + text + html_file + timing per product
      manifest.json          # pass metadata (sources, counts, timings)
  raw/products.raw.jsonl     # legacy fallback (pre-passes crawls)
  failures.jsonl             # {url, stage, reason, ts} for anything that failed
  state.json                 # resume state, latest_pass, pass history
  timings.json               # crawl/extract timing rollups
  crawldir/                  # Scrapling checkpoints for mid-crawl pause/resume
```

Each crawl creates a new timestamped pass. Reprocessing reads from the latest pass by default (`--pass` to target a specific one). Legacy `raw/` data still works but has no stored HTML for re-parsing.

### LLM audit files (`passes/<ts>/llm/`)

Written during extract when a pass directory is available. One JSON file per product, named to match the corresponding `pages/<key>.html`. Each file is an array of LLM call records:

- **extract pass** — `system_prompt`, trimmed `user_content` (the exact text sent to Ollama), `schema`, `input_chars` / `trimmed_chars`, `raw_response`, `parsed`
- **color pass** — one entry per note/accord; `cached: true` when served from session cache, otherwise full prompt/response; `fallback: true` when a hash-based color was used

These files are not included in `products.json` / `products.jsonl`. Inspect with `python view.py "<brand>" --llm --index N`.

### Audit report (`passes/<ts>/audit_report.json`)

Written after extract by default (disable with `--no-audit-checking`). Cross-references `products.json` against `llm/*.json` and `failures.jsonl`. Deterministic checks flag issues such as discarded LLM responses, junk notes, missing critical fields, and fallback colors. Flagged products may receive an optional LLM judgment pass (disable with `--no-audit-llm`). Inspect with `python view.py "<brand>" --audit`.

## Product record shape

Each entry in `products.json` mirrors the target D1 schema. Size-specific fields (grams, price, burn time) are in `sizes[]` only — not at the product level.

```json
{
  "source_url": "https://...",
  "brand_name": "Acqua di Parma",
  "brand_slug": "acqua-di-parma",
  "name": "CANDLE ITALIAN MOMENTS buongiorno",
  "description": "...",
  "wax_type": "vegetable wax",
  "vessel_material": "glass",
  "sizes": [
    {
      "size_value": 200,
      "size_unit": "g",
      "size_grams": 200,
      "price_amount": 7100,
      "price_currency": "GBP",
      "burn_time_hours": 50,
      "sku": "ADPADP062069-200G",
      "availability": "InStock",
      "is_primary": true
    },
    {
      "size_value": 500,
      "size_unit": "g",
      "size_grams": 500,
      "price_amount": 12000,
      "price_currency": "GBP",
      "burn_time_hours": 90,
      "sku": "ADPADP062069-500G",
      "availability": "InStock",
      "is_primary": false
    }
  ],
  "images": [
    {"source_url": "https://...master.1.H1.jpg", "position": 0, "is_primary": true}
  ],
  "notes": [{"note_slug": "italian-lemon", "name": "Italian lemon", "pyramid_stage": "unknown", "color": "#e8c547"}],
  "accords": [{"accord_slug": "aromatic-green", "name": "Aromatic green", "color": "#7a9e6e", "color_gradient": "linear-gradient(135deg, #7a9e6e, #4a6b4a)"}],
  "_provenance": {"json_ld": true, "llm": false}
}
```

## Color generation

After extraction, the crawler calls Ollama once per unique note and accord name to assign display colors. Each entity gets a solid `color` (hex) and optionally a `color_gradient` (CSS string). Skip with `--no-colors`.

Import writes colors on create only — existing notes/accords in D1 are never overwritten (null colors may be filled in).

### Backfill existing DB rows

```bash
cd scrapling/crawler
source .venv/bin/activate
python backfill_colors.py --host http://localhost:8023 --api-key dev-admin-key
python backfill_colors.py --dry-run          # preview without writing
python backfill_colors.py --force            # regenerate even when color is set
python backfill_colors.py --notes-only       # notes only
```

## Failure handling

Failures are logged to `failures.jsonl` without stopping the brand run:

| Stage | When |
|-------|------|
| `browse` | Category page returned zero product links |
| `product` | URL didn't look like a product page |
| `extract` | Extraction failed or produced no name |
| `request` | Network/browser error during fetch |

Review with `python view.py "Brand Name" --failures` (add `--index N` for full traceback). Fix overrides in `sites.local.json` if needed, then re-run with `--resume`.

Timing lines appear in the crawl log as `[timing]` entries. Summaries are stored in `timings.json` and per-product `_timing` fields in `products.json`.

## How it handles different sites

Generic signals, not per-site code:

- **Link discovery**: JSON-LD ItemList URLs, `/product/` path shapes, product-card containers
- **Sizes**: JSON-LD `isSimilarTo`/`hasVariant`, `offers` arrays, page text ("Choose your size 200G 500G"), HTML swatch markup
- **Multi-size variant pages**: when configured (`follow_variant_pages` in `sites.local.json`), follows each variation URL to fetch per-size price and burn time
- **Images**: JSON-LD `image` / `ImageObject` URLs
- **Extraction**: schema.org Product JSON-LD first, Ollama for gaps (notes, accords, wax, vessel)
- **Overrides**: optional `sites.local.json` for stubborn sites (copy from `sites.local.json.example`; includes Acqua di Parma variant config)
