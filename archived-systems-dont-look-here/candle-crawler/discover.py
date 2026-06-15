"""Discover candle product URLs via Shopify API, browse links, seeding, and deep crawl."""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

import httpx
from crawl4ai import AsyncUrlSeeder, AsyncWebCrawler, CrawlerRunConfig, SeedingConfig
from crawl4ai.deep_crawling import BFSDeepCrawlStrategy
from crawl4ai.deep_crawling.filters import DomainFilter, FilterChain, URLPatternFilter
from crawl4ai.deep_crawling.scorers import KeywordRelevanceScorer

from utils import (
    domain_from_url,
    is_excluded_url,
    is_product_page_url,
    is_same_domain,
    log_stage,
    normalize_url,
    site_origin,
    write_json,
)


CANDLE_QUERY = "candle scented candle wax fragrance"
PRODUCT_SITEMAP_PATTERN = "*/products/*"


def _score_entry(entry: dict[str, Any]) -> float:
    url = entry.get("url") or ""
    score = float(entry.get("relevance_score") or 0.0)
    if is_product_page_url(url):
        score += 1.0
    elif is_excluded_url(url):
        score -= 2.0
    head = entry.get("head_data") or {}
    og_type = (head.get("meta") or {}).get("og:type", "")
    if og_type == "product":
        score += 0.5
    title = (head.get("title") or "").lower()
    if "candle" in title and is_product_page_url(url):
        score += 0.2
    return score


async def discover_shopify_products(seed_url: str) -> list[dict[str, Any]]:
    origin = site_origin(seed_url)
    candidates: list[dict[str, Any]] = []
    page = 1

    async with httpx.AsyncClient(follow_redirects=True, timeout=20.0) as client:
        while page <= 10:
            api_url = f"{origin}/products.json?limit=250&page={page}"
            try:
                response = await client.get(api_url)
            except httpx.HTTPError:
                break
            if response.status_code != 200:
                break
            data = response.json()
            products = data.get("products")
            if not isinstance(products, list) or not products:
                break
            for product in products:
                handle = product.get("handle")
                if not handle:
                    continue
                url = f"{origin}/products/{handle}"
                title = product.get("title") or ""
                product_type = (product.get("product_type") or "").lower()
                tags = " ".join(product.get("tags") or []).lower()
                candleish = any(
                    word in f"{title} {product_type} {tags}".lower()
                    for word in ("candle", "scented", "wax", "pyropet")
                )
                candidates.append({
                    "url": url,
                    "source": "shopify_api",
                    "status": "valid",
                    "relevance_score": 1.0 if candleish else 0.5,
                    "score": 2.0 if candleish else 1.2,
                    "title": title,
                })
            if len(products) < 250:
                break
            page += 1

    return candidates


async def discover_from_browse_page(seed_url: str) -> list[dict[str, Any]]:
    log_stage(f"  Discover: scanning browse page {seed_url}")
    config = CrawlerRunConfig(prefetch=True, verbose=False)
    candidates: list[dict[str, Any]] = []
    seen: set[str] = set()

    async with AsyncWebCrawler() as crawler:
        result = await crawler.arun(seed_url, config=config)
        if not result.success:
            return candidates

        links = result.links or {}
        for bucket in ("internal",):
            for link in links.get(bucket) or []:
                href = link.get("href") if isinstance(link, dict) else str(link)
                url = normalize_url(seed_url, href)
                if not url or not is_same_domain(seed_url, url) or url in seen:
                    continue
                seen.add(url)
                if not is_product_page_url(url):
                    continue
                candidates.append({
                    "url": url,
                    "source": "browse_links",
                    "status": "valid",
                    "relevance_score": 1.0,
                    "score": 1.8,
                })

        html = result.html or ""
        for match in re.finditer(r'href="(/products/[^"#?]+)"', html, re.I):
            url = normalize_url(seed_url, match.group(1))
            if url and url not in seen and is_product_page_url(url):
                seen.add(url)
                candidates.append({
                    "url": url,
                    "source": "browse_html",
                    "status": "valid",
                    "relevance_score": 1.0,
                    "score": 1.7,
                })

    return candidates


async def discover_via_seeder(
    seed_url: str,
    *,
    max_urls: int = 200,
    score_threshold: float = 0.15,
) -> list[dict[str, Any]]:
    domain = domain_from_url(seed_url)
    config = SeedingConfig(
        source="sitemap+cc",
        extract_head=True,
        query=CANDLE_QUERY,
        scoring_method="bm25",
        score_threshold=score_threshold,
        pattern=PRODUCT_SITEMAP_PATTERN,
        max_urls=max_urls,
        verbose=False,
    )

    async with AsyncUrlSeeder() as seeder:
        raw = await seeder.urls(domain, config)

    candidates: list[dict[str, Any]] = []
    seen: set[str] = set()
    for entry in raw:
        url = normalize_url(seed_url, entry.get("url", ""))
        if not url or not is_same_domain(seed_url, url) or url in seen:
            continue
        seen.add(url)
        if not is_product_page_url(url):
            continue
        candidates.append({
            "url": url,
            "source": "seeder",
            "status": entry.get("status"),
            "relevance_score": entry.get("relevance_score"),
            "score": _score_entry({**entry, "url": url}),
            "head_data": entry.get("head_data"),
        })

    candidates.sort(key=lambda item: item["score"], reverse=True)
    return candidates


async def discover_via_deep_crawl(
    seed_url: str,
    *,
    max_depth: int = 2,
    max_pages: int = 30,
) -> list[dict[str, Any]]:
    log_stage(f"  Discover: deep crawl from {seed_url}")
    allowed = domain_from_url(seed_url)

    filter_chain = FilterChain([
        DomainFilter(allowed_domains=[allowed]),
        URLPatternFilter(patterns=["*/products/*", "*/collections/*", "*candle*"]),
    ])
    scorer = KeywordRelevanceScorer(
        keywords=["candle", "candles", "product", "pyropet"],
        weight=0.8,
    )
    strategy = BFSDeepCrawlStrategy(
        max_depth=max_depth,
        include_external=False,
        max_pages=max_pages,
        filter_chain=filter_chain,
        url_scorer=scorer,
    )
    config = CrawlerRunConfig(
        deep_crawl_strategy=strategy,
        prefetch=True,
        stream=True,
        verbose=False,
    )

    candidates: list[dict[str, Any]] = []
    seen: set[str] = set()

    async with AsyncWebCrawler() as crawler:
        async for result in await crawler.arun(seed_url, config=config):
            url = normalize_url(seed_url, result.url)
            if not url or url in seen:
                continue
            seen.add(url)
            if not is_product_page_url(url):
                continue
            score = float(result.metadata.get("score", 0.0) if result.metadata else 0.0) + 1.0
            candidates.append({
                "url": url,
                "source": "deep_crawl",
                "status": "valid" if result.success else "failed",
                "relevance_score": result.metadata.get("score") if result.metadata else None,
                "score": score,
                "depth": result.metadata.get("depth") if result.metadata else None,
            })

    candidates.sort(key=lambda item: item["score"], reverse=True)
    return candidates


def select_product_urls(
    candidates: list[dict[str, Any]],
    seed_url: str,
    *,
    max_products: int | None = None,
) -> list[str]:
    selected: list[str] = []
    seen: set[str] = set()

    def add(url: str) -> None:
        normalized = normalize_url(seed_url, url)
        if not normalized or normalized in seen:
            return
        if not is_product_page_url(normalized):
            return
        seen.add(normalized)
        selected.append(normalized)

    ranked = sorted(candidates, key=lambda item: float(item.get("score") or 0), reverse=True)
    for entry in ranked:
        add(entry.get("url", ""))
        if max_products is not None and len(selected) >= max_products:
            break

    return selected


def count_product_urls(urls: list[str]) -> int:
    return sum(1 for url in urls if is_product_page_url(url))


async def discover_product_urls(
    seed_url: str,
    *,
    max_products: int | None = None,
    max_seeder_urls: int = 200,
    deep_crawl_fallback: bool = True,
) -> dict[str, Any]:
    techniques: list[str] = []
    all_candidates: list[dict[str, Any]] = []
    shopify_candidates: list[dict[str, Any]] = []
    browse_candidates: list[dict[str, Any]] = []
    seeder_candidates: list[dict[str, Any]] = []
    min_needed = max_products or 3

    log_stage("  Discover: trying Shopify products.json API")
    try:
        shopify_candidates = await discover_shopify_products(seed_url)
    except Exception as exc:
        log_stage(f"  Discover: shopify_api failed ({exc})")
    if shopify_candidates:
        techniques.append("shopify_api")
        all_candidates.extend(shopify_candidates)
        log_stage(f"  Discover: shopify_api found {len(shopify_candidates)} products")

    product_urls = select_product_urls(all_candidates, seed_url, max_products=max_products)
    if len(product_urls) >= min_needed:
        technique = "+".join(techniques) if techniques else "none"
        log_stage(f"  Discover: selected {len(product_urls)} product URL(s) via {technique}")
        for url in product_urls[:10]:
            log_stage(f"    - {url}")
        return {
            "seed_url": seed_url,
            "technique": technique,
            "shopify_count": len(shopify_candidates),
            "browse_count": 0,
            "seeder_count": 0,
            "deep_crawl_count": 0,
            "candidates": all_candidates,
            "product_urls": product_urls,
        }

    try:
        browse_candidates = await discover_from_browse_page(seed_url)
    except Exception as exc:
        log_stage(f"  Discover: browse page failed ({exc})")
    if browse_candidates:
        techniques.append("browse_links")
        all_candidates.extend(browse_candidates)
        log_stage(f"  Discover: browse page found {len(browse_candidates)} product links")

    product_urls = select_product_urls(all_candidates, seed_url, max_products=max_products)
    if len(product_urls) >= min_needed:
        technique = "+".join(techniques) if techniques else "none"
        log_stage(f"  Discover: selected {len(product_urls)} product URL(s) via {technique}")
        for url in product_urls[:10]:
            log_stage(f"    - {url}")
        return {
            "seed_url": seed_url,
            "technique": technique,
            "shopify_count": len(shopify_candidates),
            "browse_count": len(browse_candidates),
            "seeder_count": 0,
            "deep_crawl_count": 0,
            "candidates": all_candidates,
            "product_urls": product_urls,
        }

    try:
        seeder_candidates = await discover_via_seeder(seed_url, max_urls=max_seeder_urls)
    except Exception as exc:
        log_stage(f"  Discover: sitemap seeder failed ({exc})")
    if seeder_candidates:
        techniques.append("seeder")
        all_candidates.extend(seeder_candidates)
        log_stage(f"  Discover: sitemap seeder found {len(seeder_candidates)} product URLs")

    product_urls = select_product_urls(all_candidates, seed_url, max_products=max_products)

    if deep_crawl_fallback and count_product_urls(product_urls) < min_needed:
        try:
            deep_candidates = await discover_via_deep_crawl(seed_url)
        except Exception as exc:
            log_stage(f"  Discover: deep crawl failed ({exc})")
            deep_candidates = []
        if deep_candidates:
            techniques.append("deep_crawl")
            all_candidates.extend(deep_candidates)
            product_urls = select_product_urls(all_candidates, seed_url, max_products=max_products)
            log_stage(f"  Discover: deep crawl added product URLs, total {len(product_urls)}")

    technique = "+".join(techniques) if techniques else "none"
    log_stage(f"  Discover: selected {len(product_urls)} product URL(s) via {technique}")
    for url in product_urls[:10]:
        log_stage(f"    - {url}")

    return {
        "seed_url": seed_url,
        "technique": technique,
        "shopify_count": len(shopify_candidates),
        "browse_count": len(browse_candidates),
        "seeder_count": len(seeder_candidates),
        "deep_crawl_count": len([c for c in all_candidates if c.get("source") == "deep_crawl"]),
        "candidates": all_candidates,
        "product_urls": product_urls,
    }


async def discover_and_save(
    seed_url: str,
    discovery_path,
    *,
    max_products: int | None = None,
) -> dict[str, Any]:
    summary = await discover_product_urls(seed_url, max_products=max_products)
    write_json(discovery_path, summary)
    return summary
