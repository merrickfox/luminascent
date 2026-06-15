#!/usr/bin/env python3
"""Brand-driven production crawler: reads brands.json, crawls per brand, resumes on failure."""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any, Callable

from bootstrap import ensure_playwright_browsers_path

ensure_playwright_browsers_path()

from audit_checks import run_audit_checks
from candle_spider import create_candle_spider
from extract import DEFAULT_MODEL, run_extract, run_extract_targeted
from link_discovery import product_key
from probe import probe_site
from schema import slugify
from shopify import crawl_shopify_source
from state import (
    BrandState,
    FailureLogger,
    PassInfo,
    brand_output_dir,
    compile_products_json,
    format_exception,
    fs_timestamp,
    list_passes,
    load_products_jsonl,
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
    skip_keys = state.scraped_keys_set() if resume else set()

    def on_failure(**kwargs):
        kwargs.setdefault("brand", brand_name)
        failures.log(**kwargs)

    probe = probe_site(source_url)
    state.set_source_probe(source_url, probe.summary())
    print(
        f"  Probe: technique={probe.technique} "
        f"shopify={probe.is_shopify} cloudflare={probe.is_cloudflare} "
        f"cf_protected={probe.is_cloudflare_protected} "
        f"bot_protection={probe.bot_protection}"
    )
    if probe.bot_protection:
        on_failure(
            url=source_url,
            stage="probe",
            reason=f"bot protection suspected ({probe.bot_protection})",
        )
        print(f"  Warning: bot protection suspected ({probe.bot_protection})")

    if probe.technique == "shopify_api":
        raw_path = (pass_dir or brand_dir) / "products.raw.jsonl"
        crawl_timings = crawl_shopify_source(
            source_url,
            probe,
            raw_path=raw_path,
            brand_name=brand_name,
            skip_product_keys=skip_keys,
            max_products=max_products,
            on_failure=on_failure,
        )
    else:
        crawl_timings = _crawl_with_browser(
            source_url,
            brand_dir,
            pass_dir,
            brand_name=brand_name,
            on_failure=on_failure,
            skip_keys=skip_keys,
            max_pages=max_pages,
            max_products=max_products,
            development_mode=development_mode,
            resume=resume,
            solve_cloudflare=probe.is_cloudflare_protected,
        )

    state.set_timings(f"crawl:{slugify(source_url)}", crawl_timings)
    print(
        f"  Source done: {source_url} — "
        f"{crawl_timings.get('items_scraped', 0)} items, "
        f"{crawl_timings.get('requests_count', 0)} requests, "
        f"{crawl_timings.get('crawl_elapsed_seconds', 0)}s "
        f"[{crawl_timings.get('technique', 'browser')}]"
    )
    state.mark_source(source_url, "complete")
    return crawl_timings


def _crawl_with_browser(
    source_url: str,
    brand_dir: Path,
    pass_dir: Path,
    *,
    brand_name: str,
    on_failure: Callable[..., None],
    skip_keys: set[str],
    max_pages: int,
    max_products: int | None,
    development_mode: bool,
    resume: bool,
    solve_cloudflare: bool,
) -> dict[str, Any]:
    crawldir = brand_dir / "crawldir" / slugify(source_url)
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
        solve_cloudflare=solve_cloudflare,
        network_idle=False,
    )

    spider_kwargs = {}
    if resume and crawldir.exists():
        spider_kwargs["crawldir"] = str(crawldir)

    spider = spider_cls(**spider_kwargs)
    result = spider.start()
    crawl_timings = getattr(spider, "crawl_timing_summary", {})
    crawl_timings["technique"] = "browser"
    crawl_timings["requests_count"] = result.stats.requests_count
    crawl_timings["items_scraped"] = result.stats.items_scraped
    crawl_timings["engine_elapsed_seconds"] = round(result.stats.elapsed_seconds, 3)
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
    use_colors: bool,
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
        use_colors=use_colors,
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


def _field_is_missing(product: dict[str, Any], field: str) -> bool:
    value = product.get(field)
    if value is None:
        return True
    if isinstance(value, (list, dict, str)) and not value:
        return True
    return False


def _field_count(value: Any) -> int | str:
    if isinstance(value, list):
        return len(value)
    if value is None or value == "":
        return 0
    if isinstance(value, str):
        return len(value)
    return 1


def _collect_target_keys_for_only(
    products: list[dict[str, Any]],
    raw_path: Path,
    only_text: str,
) -> set[str]:
    needle = only_text.casefold()
    keys: set[str] = set()

    for product in products:
        name = (product.get("name") or "").casefold()
        url = (product.get("source_url") or "").casefold()
        if needle in name or needle in url:
            keys.add(product_key(product.get("source_url", "")))

    if keys:
        return keys

    if not raw_path.exists():
        return keys

    with raw_path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            record = json.loads(line)
            if record.get("_variant_of"):
                continue
            url = (record.get("source_url") or "").casefold()
            if needle in url:
                keys.add(product_key(record.get("source_url", "")))

    return keys


def _collect_target_keys_for_missing(
    products: list[dict[str, Any]],
    field: str,
) -> set[str]:
    return {
        product_key(product.get("source_url", ""))
        for product in products
        if _field_is_missing(product, field)
    }


def reextract_selected(
    brand_name: str,
    brand_dir: Path,
    *,
    pass_id: str | None,
    only_text: str | None,
    retry_missing: str | None,
    model: str,
    use_llm: bool,
    force_llm: bool,
    use_colors: bool,
    reparse_from_html: bool,
    failures: FailureLogger,
) -> None:
    pass_info = resolve_pass(brand_dir, pass_id)
    if pass_info is None:
        print(f"  No stored scrape pass for {brand_name}")
        return

    products_jsonl = brand_dir / "products.jsonl"
    products_json = brand_dir / "products.json"
    raw_path = pass_info.raw_path

    if not raw_path.exists():
        print(f"  No raw data for {brand_name} in pass {pass_info.pass_id}")
        return

    existing_products = load_products_jsonl(products_jsonl)
    if only_text:
        target_keys = _collect_target_keys_for_only(existing_products, raw_path, only_text)
        mode_label = f"only={only_text!r}"
    else:
        assert retry_missing is not None
        target_keys = _collect_target_keys_for_missing(existing_products, retry_missing)
        mode_label = f"retry-missing={retry_missing!r}"

    if not target_keys:
        print(f"  No products matched ({mode_label})")
        return

    print(f"  Targeted re-extract ({mode_label}): {len(target_keys)} product(s) from pass {pass_info.pass_id}")

    def on_failure(**kwargs):
        kwargs.setdefault("brand", brand_name)
        failures.log(**kwargs)

    before_by_key = {
        product_key(product.get("source_url", "")): product
        for product in existing_products
    }

    try:
        updated_products, extract_summary = run_extract_targeted(
            raw_path,
            target_keys=target_keys,
            model=model,
            use_llm=use_llm,
            force_llm=force_llm,
            use_colors=use_colors,
            brand_name=brand_name,
            brand_slug=slugify(brand_name),
            on_failure=on_failure,
            pass_dir=pass_info.pass_dir if not pass_info.legacy else None,
            reparse_from_html=reparse_from_html and pass_info.has_html,
        )
    except Exception as exc:
        failures.log(url=brand_name, stage="extract", brand=brand_name, **format_exception(exc))
        print(f"  Targeted re-extract failed: {format_exception(exc)['reason']}")
        return

    updated_by_key = {
        product_key(product.get("source_url", "")): product
        for product in updated_products
    }

    merged: list[dict[str, Any]] = []
    seen_keys: set[str] = set()
    for product in existing_products:
        key = product_key(product.get("source_url", ""))
        seen_keys.add(key)
        merged.append(updated_by_key.get(key, product))

    for key, product in updated_by_key.items():
        if key not in seen_keys:
            merged.append(product)

    with products_jsonl.open("w", encoding="utf-8") as out:
        for product in merged:
            out.write(json.dumps(product, ensure_ascii=False) + "\n")

    compile_products_json(products_jsonl, products_json)

    compare_field = retry_missing if retry_missing else "notes"
    print(f"  Updated {len(updated_products)} product(s) -> {products_json}")
    for product in updated_products:
        key = product_key(product.get("source_url", ""))
        before = before_by_key.get(key, {})
        name = product.get("name") or product.get("source_url", "")
        before_val = _field_count(before.get(compare_field))
        after_val = _field_count(product.get(compare_field))
        print(f"    {name}: {compare_field} {before_val} -> {after_val}")

    if extract_summary:
        write_timings_json(brand_dir / "timings.json", {"extract_targeted": extract_summary})


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
    use_colors: bool,
    pass_id: str | None,
    reparse_from_html: bool,
    extract_tag: str | None = None,
    only_text: str | None = None,
    retry_missing: str | None = None,
    do_audit: bool = True,
    audit_llm: bool = True,
) -> None:
    brand_dir = brand_output_dir(output_base, brand_name)
    brand_dir.mkdir(parents=True, exist_ok=True)

    state_path = brand_dir / "state.json"
    failures_path = brand_dir / "failures.jsonl"
    failures = FailureLogger(failures_path)

    if only_text or retry_missing:
        print(f"\n=== {brand_name} (targeted re-extract) ===")
        reextract_selected(
            brand_name,
            brand_dir,
            pass_id=pass_id,
            only_text=only_text,
            retry_missing=retry_missing,
            model=model,
            use_llm=use_llm,
            force_llm=force_llm,
            use_colors=use_colors,
            reparse_from_html=reparse_from_html,
            failures=failures,
        )
        return

    state = BrandState(state_path)
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
                    use_colors=use_colors,
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

    if do_audit and count and not no_extract:
        pass_info = resolve_pass(brand_dir, pass_id)
        if pass_info is None:
            print("  Audit: skipped (no scrape pass found)")
        else:
            products = json.loads(products_json.read_text(encoding="utf-8"))
            print(f"  Running audit checks on pass {pass_info.pass_id}")
            try:
                run_audit_checks(
                    brand_dir,
                    pass_info,
                    products,
                    brand_name=brand_name,
                    use_llm=audit_llm,
                    model=model,
                )
            except Exception as exc:
                failures.log(url=brand_name, stage="extract", brand=brand_name, **format_exception(exc))
                print(f"  Audit failed: {format_exception(exc)['reason']}")


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
    parser.add_argument("--no-colors", action="store_true", help="Skip Ollama color generation for notes/accords")
    parser.add_argument(
        "--no-audit-checking",
        action="store_true",
        help="Skip post-extract audit validation pass (llm/ artifacts are still written)",
    )
    parser.add_argument(
        "--no-audit-llm",
        action="store_true",
        help="Run audit checks but skip LLM judgment on flagged products",
    )
    parser.add_argument("--list-passes", action="store_true", help="List stored scrape passes for --brand and exit")
    parser.add_argument(
        "--extract-tag",
        help="Write extract output to products.<tag>.json(l) and timings.<tag>.json (keeps default products.json untouched)",
    )
    parser.add_argument(
        "--only",
        metavar="TEXT",
        help="Re-extract products whose name or source_url contains TEXT (requires --brand; uses stored pass, merges into products.json)",
    )
    parser.add_argument(
        "--retry-missing",
        metavar="KEY",
        help="Re-extract products where KEY is empty/missing, e.g. notes (requires --brand; uses stored pass, merges into products.json)",
    )
    args = parser.parse_args()

    if args.force_llm and args.no_llm:
        parser.error("--force-llm and --no-llm are mutually exclusive")

    if args.only and args.retry_missing:
        parser.error("--only and --retry-missing are mutually exclusive")

    if (args.only or args.retry_missing) and not args.brand:
        parser.error("--only and --retry-missing require --brand")

    if (args.only or args.retry_missing) and args.no_extract:
        parser.error("--no-extract cannot be used with --only or --retry-missing")

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
    use_colors = not args.no_colors
    do_audit = not args.no_audit_checking
    audit_llm = use_llm and not args.no_audit_llm
    reparse_from_html = not args.no_reparse_html
    targeted = bool(args.only or args.retry_missing)
    force_llm = args.force_llm or (targeted and use_llm)

    for brand_name, sources in grouped.items():
        run_brand(
            brand_name, sources, args.output_dir,
            max_pages=args.max_pages,
            max_products=args.max_products_per_brand,
            development_mode=args.dev,
            resume=args.resume,
            no_crawl=args.no_crawl or targeted,
            no_extract=args.no_extract,
            model=args.ollama_model,
            use_llm=use_llm,
            force_llm=force_llm,
            use_colors=use_colors,
            pass_id=args.pass_id,
            reparse_from_html=reparse_from_html,
            extract_tag=args.extract_tag,
            only_text=args.only,
            retry_missing=args.retry_missing,
            do_audit=do_audit,
            audit_llm=audit_llm,
        )

    print("\nDone.")


if __name__ == "__main__":
    main()
