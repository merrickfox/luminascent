#!/usr/bin/env python3
"""CLI for the candle crawler pipeline."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from urllib.parse import urlparse

from bootstrap import ensure_playwright_browsers_path

ensure_playwright_browsers_path()

from candle_spider import create_candle_spider
from extract import DEFAULT_MODEL, extract_from_html_file, run_extract
from schema import slugify
from sites import domain_from_url
from state import fs_timestamp, write_pass_manifest


def output_dir_for_url(url: str, base: Path) -> Path:
    domain = domain_from_url(url)
    return base / domain


def run_crawl(
    seed_url: str,
    output_dir: Path,
    pass_dir: Path,
    *,
    max_pages: int,
    max_products: int | None,
    development_mode: bool,
):
    pass_dir.mkdir(parents=True, exist_ok=True)
    raw_path = pass_dir / "products.raw.jsonl"

    if raw_path.exists():
        raw_path.unlink()

    spider_cls = create_candle_spider(
        seed_url,
        output_dir,
        pass_dir=pass_dir,
        max_pages=max_pages,
        max_products=max_products,
        development_mode=development_mode,
    )
    result = spider_cls().start()
    products_count = sum(1 for line in raw_path.open(encoding="utf-8") if line.strip()) if raw_path.exists() else 0
    pages_dir = pass_dir / "pages"
    html_count = len(list(pages_dir.glob("*.html"))) if pages_dir.exists() else 0
    write_pass_manifest(
        pass_dir,
        pass_id=pass_dir.name,
        sources=[seed_url],
        products_count=products_count,
        html_count=html_count,
    )
    print(f"Crawl complete: {result.stats.items_scraped} items, {result.stats.requests_count} requests")
    print(f"Pass: {pass_dir}")
    print(f"Raw output: {raw_path}")
    return raw_path, pass_dir


def main():
    parser = argparse.ArgumentParser(description="Crawl candle categories and extract structured data")
    parser.add_argument("seed_url", nargs="?", help="Seed category URL to crawl")
    parser.add_argument("--no-crawl", action="store_true", help="Skip crawl phase")
    parser.add_argument("--no-extract", action="store_true", help="Skip extraction phase")
    parser.add_argument("--dev", action="store_true", help="Enable development_mode response caching")
    parser.add_argument("--max-pages", type=int, default=10, help="Max category pages to paginate")
    parser.add_argument("--max-products", type=int, default=None, help="Max product pages to fetch")
    parser.add_argument("--ollama-model", default=DEFAULT_MODEL, help="Ollama model for extraction")
    parser.add_argument("--force-llm", action="store_true", help="Run Ollama on every product")
    parser.add_argument("--no-llm", action="store_true", help="Deterministic extraction only")
    parser.add_argument("--no-reparse-html", action="store_true", help="Use stored json_ld/text instead of re-parsing HTML")
    parser.add_argument("--test-html", type=Path, help="Test extraction on a local HTML file")
    parser.add_argument("--output-dir", type=Path, default=Path(__file__).parent / "output")
    args = parser.parse_args()

    if args.force_llm and args.no_llm:
        parser.error("--force-llm and --no-llm are mutually exclusive")

    use_llm = not args.no_llm

    if args.test_html:
        if not args.test_html.exists():
            print(f"File not found: {args.test_html}", file=sys.stderr)
            sys.exit(1)
        source_url = args.seed_url or "file://local"
        product = extract_from_html_file(
            args.test_html,
            source_url=source_url,
            model=args.ollama_model,
            use_llm=use_llm,
            force_llm=args.force_llm,
        )
        print(json.dumps(product, indent=2, ensure_ascii=False))
        return

    if not args.seed_url:
        parser.error("seed_url is required unless --test-html is used")

    output_dir = output_dir_for_url(args.seed_url, args.output_dir)
    pass_dir = output_dir / "passes" / fs_timestamp()
    candles_path = output_dir / "candles.jsonl"
    raw_path = pass_dir / "products.raw.jsonl"

    if not args.no_crawl:
        raw_path, pass_dir = run_crawl(
            args.seed_url,
            output_dir,
            pass_dir,
            max_pages=args.max_pages,
            max_products=args.max_products,
            development_mode=args.dev,
        )
    elif not raw_path.exists():
        passes = sorted((output_dir / "passes").glob("*/products.raw.jsonl"), reverse=True) if (output_dir / "passes").exists() else []
        if passes:
            raw_path = passes[0]
            pass_dir = raw_path.parent
        else:
            legacy = output_dir / "products.raw.jsonl"
            if legacy.exists():
                raw_path = legacy
                pass_dir = output_dir
            else:
                print(f"No raw data at {pass_dir}. Run crawl first.", file=sys.stderr)
                sys.exit(1)

    if not args.no_extract:
        if not raw_path.exists():
            print(f"No raw data at {raw_path}. Run crawl first or provide --no-crawl with existing data.", file=sys.stderr)
            sys.exit(1)
        brand_slug = slugify(domain_from_url(args.seed_url).split(".")[0])
        _, _extract_summary = run_extract(
            raw_path,
            candles_path,
            model=args.ollama_model,
            use_llm=use_llm,
            force_llm=args.force_llm,
            brand_slug=brand_slug,
            pass_dir=pass_dir,
            reparse_from_html=not args.no_reparse_html,
        )


if __name__ == "__main__":
    main()
