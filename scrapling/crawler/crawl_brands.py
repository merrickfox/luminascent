#!/usr/bin/env python3
"""Brand-driven production crawler: reads brands.json, crawls per brand, resumes on failure."""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

from bootstrap import ensure_playwright_browsers_path

ensure_playwright_browsers_path()

from candle_spider import create_candle_spider
from extract import DEFAULT_MODEL, run_extract
from link_discovery import product_key
from schema import slugify
from state import (
    BrandState,
    FailureLogger,
    PassInfo,
    brand_output_dir,
    compile_products_json,
    format_exception,
    fs_timestamp,
    list_passes,
    resolve_pass,
    write_pass_manifest,
)
from timing import write_timings_json


def load_brands(path: Path) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError("brands.json must be a JSON array")
    return data


def group_by_brand(entries: list[dict]) -> dict[str, list[dict]]:
    grouped: dict[str, list[dict]] = defaultdict(list)
    for entry in entries:
        brand = entry.get("brand", "").strip()
        url = entry.get("url", "").strip()
        if not brand or not url:
            continue
        grouped[brand].append(entry)
    return dict(grouped)


def count_jsonl_lines(path: Path) -> int:
    if not path.exists():
        return 0
    return sum(1 for line in path.open(encoding="utf-8") if line.strip())


def count_html_pages(pass_dir: Path) -> int:
    pages_dir = pass_dir / "pages"
    if not pages_dir.exists():
        return 0
    return len(list(pages_dir.glob("*.html")))


def crawl_source(
    brand_name: str,
    source_url: str,
    brand_dir: Path,
    pass_dir: Path,
    *,
    state: BrandState,
    failures: FailureLogger,
    max_pages: int,
    max_products: int | None,
    development_mode: bool,
    resume: bool,
) -> dict[str, Any]:
    crawldir = brand_dir / "crawldir" / slugify(source_url)
    skip_keys = state.scraped_keys_set() if resume else set()

    def on_failure(**kwargs):
        kwargs.setdefault("brand", brand_name)
        failures.log(**kwargs)

    spider_cls = create_candle_spider(
        source_url,
        brand_dir,
        brand_name=brand_name,
        pass_dir=pass_dir,
        failure_callback=on_failure,
        skip_product_keys=skip_keys,
        max_pages=max_pages,
        max_products=max_products,
        development_mode=development_mode,
    )

    spider_kwargs = {}
    if resume and crawldir.exists():
        spider_kwargs["crawldir"] = str(crawldir)

    spider = spider_cls(**spider_kwargs)
    result = spider.start()
    crawl_timings = getattr(spider, "crawl_timing_summary", {})
    crawl_timings["requests_count"] = result.stats.requests_count
    crawl_timings["items_scraped"] = result.stats.items_scraped
    crawl_timings["engine_elapsed_seconds"] = round(result.stats.elapsed_seconds, 3)
    state.set_timings(f"crawl:{slugify(source_url)}", crawl_timings)
    print(
        f"  Source done: {source_url} — "
        f"{result.stats.items_scraped} items, {result.stats.requests_count} requests, "
        f"{crawl_timings.get('crawl_elapsed_seconds', result.stats.elapsed_seconds)}s"
    )
    state.mark_source(source_url, "complete")
    return crawl_timings


def extract_brand(
    brand_name: str,
    brand_dir: Path,
    pass_info: PassInfo,
    *,
    state: BrandState,
    failures: FailureLogger,
    model: str,
    use_llm: bool,
    force_llm: bool,
    resume: bool,
    reparse_from_html: bool,
    extract_tag: str | None = None,
) -> dict[str, Any]:
    if extract_tag:
        products_jsonl = brand_dir / f"products.{extract_tag}.jsonl"
    else:
        products_jsonl = brand_dir / "products.jsonl"
    raw_path = pass_info.raw_path

    if not raw_path.exists():
        print(f"  No raw data for {brand_name} in pass {pass_info.pass_id}, skipping extract")
        return {}

    skip_keys = state.scraped_keys_set() if resume else set()

    def on_failure(**kwargs):
        kwargs.setdefault("brand", brand_name)
        failures.log(**kwargs)

    print(f"  Extracting from pass {pass_info.pass_id}: {raw_path}")
    results, extract_summary = run_extract(
        raw_path,
        products_jsonl,
        model=model,
        use_llm=use_llm,
        force_llm=force_llm,
        brand_name=brand_name,
        brand_slug=slugify(brand_name),
        skip_keys=skip_keys if resume else None,
        on_failure=on_failure,
        pass_dir=pass_info.pass_dir if not pass_info.legacy else None,
        reparse_from_html=reparse_from_html and pass_info.has_html,
    )
    extract_summary["pass_id"] = pass_info.pass_id
    state.set_timings("extract", extract_summary)

    for product in results:
        key = product_key(product.get("source_url", ""))
        state.add_scraped_key(key)
    return extract_summary


def run_brand(
    brand_name: str,
    sources: list[dict],
    output_base: Path,
    *,
    max_pages: int,
    max_products: int | None,
    development_mode: bool,
    resume: bool,
    no_crawl: bool,
    no_extract: bool,
    model: str,
    use_llm: bool,
    force_llm: bool,
    pass_id: str | None,
    reparse_from_html: bool,
    extract_tag: str | None = None,
) -> None:
    brand_dir = brand_output_dir(output_base, brand_name)
    brand_dir.mkdir(parents=True, exist_ok=True)

    state_path = brand_dir / "state.json"
    failures_path = brand_dir / "failures.jsonl"
    state = BrandState(state_path)
    failures = FailureLogger(failures_path)
    state.init_brand(brand_name)

    print(f"\n=== {brand_name} ({len(sources)} source URLs) ===")
    brand_timings: dict[str, Any] = {}
    crawl_pass_dir: Path | None = None
    crawl_pass_id: str | None = None
    crawled_sources: list[str] = []

    if not no_crawl:
        crawl_pass_id = fs_timestamp()
        crawl_pass_dir = brand_dir / "passes" / crawl_pass_id
        crawl_pass_dir.mkdir(parents=True, exist_ok=True)
        print(f"  Scrape pass: {crawl_pass_id}")

        for entry in sources:
            url = entry["url"]
            if resume and state.source_status(url) == "complete":
                print(f"  Skipping completed source: {url}")
                continue
            print(f"  Crawling: {url}")
            try:
                brand_timings[f"crawl:{slugify(url)}"] = crawl_source(
                    brand_name, url, brand_dir, crawl_pass_dir,
                    state=state, failures=failures,
                    max_pages=max_pages,
                    max_products=max_products,
                    development_mode=development_mode,
                    resume=resume,
                )
                crawled_sources.append(url)
            except Exception as exc:
                failures.log(url=url, stage="browse", brand=brand_name, **format_exception(exc))
                state.mark_source(url, "failed")
                print(f"  Source failed: {format_exception(exc)['reason']}")

        if crawled_sources and crawl_pass_dir is not None and crawl_pass_id is not None:
            products_count = count_jsonl_lines(crawl_pass_dir / "products.raw.jsonl")
            html_count = count_html_pages(crawl_pass_dir)
            write_pass_manifest(
                crawl_pass_dir,
                pass_id=crawl_pass_id,
                sources=crawled_sources,
                products_count=products_count,
                html_count=html_count,
                crawl_timings=brand_timings,
            )
            state.add_pass(crawl_pass_id, sources=crawled_sources, products_count=products_count)
            print(f"  Stored pass {crawl_pass_id}: {products_count} products, {html_count} HTML pages")

    if not no_extract:
        pass_info = resolve_pass(brand_dir, pass_id)
        if pass_info is None:
            print(f"  No stored scrape pass for {brand_name}, skipping extract")
        else:
            print(f"  Extracting: {brand_name}")
            try:
                brand_timings["extract"] = extract_brand(
                    brand_name, brand_dir, pass_info,
                    state=state, failures=failures,
                    model=model,
                    use_llm=use_llm,
                    force_llm=force_llm,
                    resume=resume,
                    reparse_from_html=reparse_from_html,
                    extract_tag=extract_tag,
                )
            except Exception as exc:
                failures.log(url=brand_name, stage="extract", brand=brand_name, **format_exception(exc))
                print(f"  Extract failed: {format_exception(exc)['reason']}")

    if extract_tag:
        products_jsonl = brand_dir / f"products.{extract_tag}.jsonl"
        products_json = brand_dir / f"products.{extract_tag}.json"
        timings_path = brand_dir / f"timings.{extract_tag}.json"
    else:
        products_jsonl = brand_dir / "products.jsonl"
        products_json = brand_dir / "products.json"
        timings_path = brand_dir / "timings.json"

    if products_jsonl.exists():
        count = len(compile_products_json(products_jsonl, products_json))
    else:
        count = 0
    if brand_timings:
        write_timings_json(timings_path, brand_timings)
        if not extract_tag:
            state.set_timings("brand", brand_timings)
    state.mark_completed()
    if count:
        print(f"  Compiled {count} products -> {products_json}")


def print_pass_list(brand_name: str, output_base: Path) -> None:
    brand_dir = brand_output_dir(output_base, brand_name)
    passes = list_passes(brand_dir)
    if not passes:
        print(f"No passes found for {brand_name}")
        return
    print(f"\nPasses for {brand_name}:")
    print(f"{'Pass ID':<28} {'Products':>8}  {'HTML':>6}  Sources")
    print("-" * 72)
    for entry in passes:
        sources = ", ".join(entry.get("sources") or [])[:32]
        legacy = " (legacy)" if entry.get("legacy") else ""
        print(
            f"{entry['pass_id']:<28} {entry.get('products_count', 0):>8}  "
            f"{entry.get('html_count', 0):>6}  {sources}{legacy}"
        )


def main():
    parser = argparse.ArgumentParser(description="Crawl candle brands from brands.json")
    parser.add_argument("brands_file", type=Path, help="JSON file with brand+url entries")
    parser.add_argument("--brand", help="Only run this brand name")
    parser.add_argument("--resume", action="store_true", help="Skip completed sources and already-extracted products")
    parser.add_argument("--no-crawl", action="store_true", help="Reprocess stored pass without scraping")
    parser.add_argument("--no-extract", action="store_true")
    parser.add_argument("--dev", action="store_true")
    parser.add_argument("--max-pages", type=int, default=10)
    parser.add_argument("--max-products-per-brand", type=int, default=None)
    parser.add_argument("--ollama-model", default=DEFAULT_MODEL)
    parser.add_argument("--output-dir", type=Path, default=Path(__file__).parent / "output")
    parser.add_argument("--pass", dest="pass_id", help="Scrape pass to extract from (default: latest)")
    parser.add_argument("--force-llm", action="store_true", help="Run Ollama on every product")
    parser.add_argument("--no-llm", action="store_true", help="Deterministic extraction only")
    parser.add_argument("--no-reparse-html", action="store_true", help="Use stored json_ld/text instead of re-parsing HTML")
    parser.add_argument("--list-passes", action="store_true", help="List stored scrape passes for --brand and exit")
    parser.add_argument(
        "--extract-tag",
        help="Write extract output to products.<tag>.json(l) and timings.<tag>.json (keeps default products.json untouched)",
    )
    args = parser.parse_args()

    if args.force_llm and args.no_llm:
        parser.error("--force-llm and --no-llm are mutually exclusive")

    if not args.brands_file.exists():
        print(f"Not found: {args.brands_file}", file=sys.stderr)
        sys.exit(1)

    entries = load_brands(args.brands_file)
    grouped = group_by_brand(entries)

    if args.brand:
        if args.brand not in grouped:
            print(f"Brand not found in {args.brands_file}: {args.brand}", file=sys.stderr)
            sys.exit(1)
        if args.list_passes:
            print_pass_list(args.brand, args.output_dir)
            return
        grouped = {args.brand: grouped[args.brand]}
    elif args.list_passes:
        parser.error("--list-passes requires --brand")

    use_llm = not args.no_llm
    reparse_from_html = not args.no_reparse_html

    for brand_name, sources in grouped.items():
        run_brand(
            brand_name, sources, args.output_dir,
            max_pages=args.max_pages,
            max_products=args.max_products_per_brand,
            development_mode=args.dev,
            resume=args.resume,
            no_crawl=args.no_crawl,
            no_extract=args.no_extract,
            model=args.ollama_model,
            use_llm=use_llm,
            force_llm=args.force_llm,
            pass_id=args.pass_id,
            reparse_from_html=reparse_from_html,
            extract_tag=args.extract_tag,
        )

    print("\nDone.")


if __name__ == "__main__":
    main()
