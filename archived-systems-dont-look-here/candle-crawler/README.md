# Candle Crawler (crawl4ai)

Native crawl4ai pipeline for discovering candle product pages across many brand sites, extracting structured product data with `LLMExtractionStrategy`, and writing an importer-ready `products.json` plus a full audit trail.

## Setup

```bash
cd candle-crawler
./setup.sh
source .venv/bin/activate
ollama pull qwen3-coder:30b   # optional, for local extraction
```

Run commands from `candle-crawler/` so the local venv resolves the installed `crawl4ai` package (not the docs clone elsewhere in the repo).

## Input

`sites.json`:

```json
[
  { "name": "54 Celsius", "url": "https://54celsius.com/collections/pyropet-candles" }
]
```

## Quick start

```bash
python main.py sites.json --site "54 Celsius" --max-products 3
```

## CLI

```
python main.py [sites.json] [options]
```

| Flag | Description |
|------|-------------|
| `--site` | Run one site by name |
| `--limit` | Limit number of sites |
| `--max-products` | Cap product URLs per site |
| `--output-dir` | Output root (default: `./output`) |
| `--run-id` | Continue in an existing run folder |
| `--resume` | Skip URLs already in `products.raw.jsonl` |
| `--model` | LiteLLM provider string (default: `ollama/qwen3-coder:30b`) |
| `--ollama-base-url` | Ollama API base (default: `http://localhost:11434`) |
| `--headful` | Visible browser during fetch |
| `--screenshot` | Save PNG screenshots |
| `--profile` | Reuse a managed browser profile path |
| `--solve` | Open a profile interactively to solve Cloudflare/CAPTCHA once |
| `--no-discover` | Skip URL discovery |
| `--no-fetch` | Skip fetch stage |
| `--no-extract` | Skip LLM extraction |

## Cloudflare / CAPTCHA

1. Automatic: stealth + magic + simulate_user, escalating to `UndetectedAdapter` when blocked.
2. Manual: `python main.py sites.json --site "Brand" --solve` opens a managed browser profile; solve challenges, press Enter, then rerun normally with the saved profile.

## Output layout

```
output/<UTC-run-id>/
  run.json
  products.combined.json
  <site-slug>/
    discovery.json
    crawl_stats.json
    pages/<hash>.html
    markdown/<hash>.md
    llm/<hash>.json
    screenshots/<hash>.png        # with --screenshot
    products.raw.jsonl
    products.json
    failures.jsonl
```

`products.json` matches the Luminascent import schema (`source_url`, `category_slug`, `brand_name`, `sizes[]`, `images[]`, `notes[]`, `accords[]`, etc.).

## Pipeline stages

1. **Discover** — `AsyncUrlSeeder` (sitemap + Common Crawl, BM25 candle query) with deep-crawl fallback.
2. **Fetch** — `arun_many` + `MemoryAdaptiveDispatcher`, anti-bot escalation, HTML/markdown audit artifacts.
3. **Extract** — `LLMExtractionStrategy` with Pydantic `CandleProduct` schema via local Ollama or any LiteLLM provider.

## Examples

```bash
# One brand, small sample
python main.py sites.json --site "54 Celsius" --max-products 5

# Visible browser for tough sites
python main.py sites.json --site "Acqua di Parma" --headful --max-products 3

# Solve Cloudflare once, then crawl
python main.py sites.json --site "Acqua di Parma" --solve
python main.py sites.json --site "Acqua di Parma" --max-products 10

# Crawl only (store audit artifacts, skip LLM)
python main.py sites.json --site "54 Celsius" --no-extract
```
