"""Orchestrate discover, fetch, extract, and audit output."""

from __future__ import annotations

import argparse
import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from audit import RunPaths
from discover import discover_and_save
from extract import DEFAULT_MODEL, DEFAULT_OLLAMA_BASE, extract_results
from fetch import FetchConfig, fetch_and_audit
from models import CandleProduct
from profiles import resolve_profile_path, solve_for_site
from reload import load_saved_results
from utils import load_jsonl, log_stage, product_key, site_slug, slugify, utc_now_iso, write_json


@dataclass
class PipelineConfig:
    sites_file: Path
    output_dir: Path = Path("output")
    run_id: str | None = None
    site_filter: str | None = None
    limit: int | None = None
    max_products: int | None = None
    model: str = DEFAULT_MODEL
    ollama_base_url: str = DEFAULT_OLLAMA_BASE
    headless: bool = True
    headful: bool = False
    screenshot: bool = False
    profile_path: str | None = None
    resume: bool = False
    no_discover: bool = False
    no_fetch: bool = False
    no_extract: bool = False
    solve: bool = False


@dataclass
class SiteRunSummary:
    name: str
    url: str
    slug: str
    product_urls: list[str] = field(default_factory=list)
    fetched: int = 0
    extracted: int = 0
    elapsed_seconds: float = 0.0
    error: str | None = None


def load_sites(path: Path) -> list[dict[str, str]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError("sites.json must be a JSON array")
    sites: list[dict[str, str]] = []
    for entry in data:
        name = (entry.get("name") or entry.get("brand") or "").strip()
        url = (entry.get("url") or "").strip()
        if name and url:
            sites.append({"name": name, "url": url})
    return sites


def existing_product_keys(raw_path: Path) -> set[str]:
    return {product_key(item.get("source_url", "")) for item in load_jsonl(raw_path)}


def compile_products(raw_path: Path, json_path: Path) -> list[dict[str, Any]]:
    records = load_jsonl(raw_path)
    write_json(json_path, records)
    return records


def validate_products(records: list[dict[str, Any]]) -> list[str]:
    errors: list[str] = []
    for index, record in enumerate(records, 1):
        try:
            payload = {k: v for k, v in record.items() if not k.startswith("_")}
            CandleProduct.model_validate(payload)
        except Exception as exc:
            errors.append(f"record {index}: {exc}")
    return errors


async def run_site(
    paths: RunPaths,
    site: dict[str, str],
    cfg: PipelineConfig,
) -> SiteRunSummary:
    started = time.perf_counter()
    name = site["name"]
    url = site["url"]
    slug = site_slug(name)
    brand_slug = slugify(name)
    summary = SiteRunSummary(name=name, url=url, slug=slug)

    try:
        if cfg.solve:
            profile = await solve_for_site(url)
            cfg.profile_path = str(profile)

        profile = resolve_profile_path(url, cfg.profile_path)
        raw_path = paths.raw_products_path(name)
        skip_keys = existing_product_keys(raw_path) if cfg.resume else set()
        if not cfg.resume and raw_path.exists() and not cfg.no_extract:
            raw_path.unlink()

        if not cfg.no_discover:
            log_stage("  Stage: discover")
            discovery = await discover_and_save(
                url,
                paths.discovery_path(name),
                max_products=cfg.max_products,
            )
            product_urls = discovery.get("product_urls") or []
            if not product_urls:
                log_stage("  Discover found no product URLs")
        else:
            discovery_path = paths.discovery_path(name)
            if discovery_path.exists():
                discovery = json.loads(discovery_path.read_text(encoding="utf-8"))
                product_urls = discovery.get("product_urls") or [url]
            else:
                product_urls = [url]

        if cfg.resume and skip_keys:
            product_urls = [
                candidate
                for candidate in product_urls
                if product_key(candidate) not in skip_keys
            ]

        summary.product_urls = product_urls

        fetch_cfg = FetchConfig(
            headless=not cfg.headful,
            screenshot=cfg.screenshot,
            profile_path=str(profile) if profile else None,
        )

        results: list[Any] = []
        crawl_stats: dict[str, Any] = {"urls": {}}
        if not cfg.no_fetch and product_urls:
            log_stage(f"  Stage: fetch ({len(product_urls)} URL(s))")
            results, crawl_stats = await fetch_and_audit(
                paths,
                name,
                product_urls,
                fetch_cfg,
            )
            write_json(paths.crawl_stats_path(name), crawl_stats)
        elif cfg.no_fetch:
            results = load_saved_results(paths, name)
            if cfg.max_products is not None:
                results = results[: cfg.max_products]
        summary.fetched = len(results)

        products: list[dict[str, Any]] = []
        if not cfg.no_extract and results:
            log_stage(f"  Stage: extract ({len(results)} page(s), model={cfg.model})")
            products = await extract_results(
                paths,
                name,
                results,
                brand_name=name,
                brand_slug=brand_slug,
                model=cfg.model,
                ollama_base_url=cfg.ollama_base_url,
                raw_products_path=raw_path,
                skip_keys=skip_keys if cfg.resume else None,
            )

        if cfg.resume and raw_path.exists():
            by_key = {product_key(item.get("source_url", "")): item for item in load_jsonl(raw_path)}
            for item in products:
                by_key[product_key(item.get("source_url", ""))] = item
            merged = list(by_key.values())
            write_json(paths.products_path(name), merged)
            summary.extracted = len(merged)
        elif raw_path.exists():
            merged = compile_products(raw_path, paths.products_path(name))
            summary.extracted = len(merged)
        else:
            write_json(paths.products_path(name), products)
            summary.extracted = len(products)

        validation_errors = validate_products(load_jsonl(raw_path) if raw_path.exists() else products)
        if validation_errors:
            summary.error = "; ".join(validation_errors[:3])

    except Exception as exc:
        summary.error = str(exc)

    summary.elapsed_seconds = round(time.perf_counter() - started, 3)
    return summary


async def run_pipeline(cfg: PipelineConfig) -> dict[str, Any]:
    sites = load_sites(cfg.sites_file)
    if cfg.site_filter:
        sites = [s for s in sites if s["name"] == cfg.site_filter]
    if cfg.limit is not None:
        sites = sites[: cfg.limit]

    if cfg.run_id:
        paths = RunPaths.from_run_id(cfg.output_dir, cfg.run_id)
    else:
        paths = RunPaths.create(cfg.output_dir)

    run_started = time.perf_counter()
    site_summaries: list[SiteRunSummary] = []

    for site in sites:
        print(f"\n=== {site['name']} ===")
        summary = await run_site(paths, site, cfg)
        site_summaries.append(summary)
        print(
            f"  URLs: {len(summary.product_urls)} | fetched: {summary.fetched} | "
            f"products: {summary.extracted} | {summary.elapsed_seconds}s"
        )
        if summary.error:
            print(f"  error: {summary.error}")

    combined: list[dict[str, Any]] = []
    for summary in site_summaries:
        products_path = paths.products_path(summary.name)
        if products_path.exists():
            combined.extend(json.loads(products_path.read_text(encoding="utf-8")))

    if combined:
        write_json(paths.combined_products_path, combined)

    manifest = {
        "run_id": paths.run_id,
        "started_at": utc_now_iso(),
        "sites_file": str(cfg.sites_file),
        "config": {
            "model": cfg.model,
            "ollama_base_url": cfg.ollama_base_url,
            "max_products": cfg.max_products,
            "headful": cfg.headful,
            "resume": cfg.resume,
        },
        "sites": [
            {
                "name": s.name,
                "url": s.url,
                "slug": s.slug,
                "product_urls": len(s.product_urls),
                "fetched": s.fetched,
                "extracted": s.extracted,
                "elapsed_seconds": s.elapsed_seconds,
                "error": s.error,
            }
            for s in site_summaries
        ],
        "totals": {
            "sites": len(site_summaries),
            "products": len(combined),
            "elapsed_seconds": round(time.perf_counter() - run_started, 3),
        },
    }
    write_json(paths.manifest_path, manifest)
    print(f"\nRun complete: {paths.root}")
    print(f"Products: {len(combined)} across {len(site_summaries)} sites")
    return manifest


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Crawl candle product sites with crawl4ai")
    parser.add_argument("sites_file", type=Path, nargs="?", default=Path("sites.json"))
    parser.add_argument("--output-dir", type=Path, default=Path("output"))
    parser.add_argument("--run-id", help="Resume or append to an existing run folder")
    parser.add_argument("--site", help="Run a single site by name")
    parser.add_argument("--limit", type=int, help="Limit number of sites")
    parser.add_argument("--max-products", type=int, help="Max product URLs per site")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--ollama-base-url", default=DEFAULT_OLLAMA_BASE)
    parser.add_argument("--headful", action="store_true", help="Visible browser during fetch")
    parser.add_argument("--screenshot", action="store_true", help="Save page screenshots")
    parser.add_argument("--profile", help="Managed browser profile path")
    parser.add_argument("--solve", action="store_true", help="Open browser profile to solve CAPTCHA/Cloudflare")
    parser.add_argument("--resume", action="store_true", help="Skip URLs already in products.raw.jsonl")
    parser.add_argument("--no-discover", action="store_true")
    parser.add_argument("--no-fetch", action="store_true")
    parser.add_argument("--no-extract", action="store_true")
    return parser


async def main_async(argv: list[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)
    cfg = PipelineConfig(
        sites_file=args.sites_file,
        output_dir=args.output_dir,
        run_id=args.run_id,
        site_filter=args.site,
        limit=args.limit,
        max_products=args.max_products,
        model=args.model,
        ollama_base_url=args.ollama_base_url,
        headful=args.headful,
        screenshot=args.screenshot,
        profile_path=args.profile,
        resume=args.resume,
        no_discover=args.no_discover,
        no_fetch=args.no_fetch,
        no_extract=args.no_extract,
        solve=args.solve,
    )
    await run_pipeline(cfg)
