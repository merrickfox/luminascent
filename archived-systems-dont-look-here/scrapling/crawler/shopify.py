"""Shopify storefront fast-path: API discovery + plain HTTP product pages.

Shopify exposes /products.json for structured variant data, but theme-rendered
detail (burn time, materials, dimensions) lives only on the product page HTML.
This module discovers products via the JSON API, fetches each page over plain
HTTP (no browser), parses with the shared reparse_html pipeline, and merges API
variants into the record for full parity with the browser crawl.
"""

from __future__ import annotations

import asyncio
import html
import json
import random
import re
import time
from pathlib import Path
from typing import Any, Callable

import httpx

from link_discovery import product_key
from parsing import reparse_html
from probe import PROBE_USER_AGENT, SiteProbe, _detect_cloudflare_challenge
from sites import get_site_config
from state import safe_page_filename
from timing import TimingAccumulator, log_timing, round_seconds

FailureCallback = Callable[..., None]

PAGE_LIMIT = 250
MAX_API_PAGES = 100
INTER_PAGE_DELAY = 0.3
FETCH_CONCURRENCY = 6
FETCH_JITTER_SECONDS = 0.15
FETCH_TIMEOUT = 30.0

HTML_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
JSON_ACCEPT = "application/json"


def collection_handle_from_url(url: str) -> str | None:
    from urllib.parse import urlparse

    parts = [p for p in urlparse(url).path.strip("/").split("/") if p]
    if "collections" in parts:
        idx = parts.index("collections")
        if idx + 1 < len(parts):
            handle = parts[idx + 1]
            if handle and handle.lower() != "all":
                return handle
    return None


def products_endpoint(origin: str, seed_url: str) -> str:
    handle = collection_handle_from_url(seed_url)
    if handle:
        return f"{origin}/collections/{handle}/products.json"
    return f"{origin}/products.json"


def _html_to_text(raw_html: str) -> str:
    if not raw_html:
        return ""
    text = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", raw_html)
    text = re.sub(r"(?i)<\s*br\s*/?\s*>", "\n", text)
    text = re.sub(r"(?i)</\s*(p|div|li|h[1-6]|tr)\s*>", "\n", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _variant_size_label(variant: dict[str, Any]) -> str | None:
    title = variant.get("title")
    if title and title != "Default Title":
        return title
    for key in ("option1", "option2", "option3"):
        value = variant.get(key)
        if value and value != "Default Title":
            return value
    return None


def _availability(available: Any) -> str:
    return "https://schema.org/InStock" if available else "https://schema.org/OutOfStock"


def _first_product_ld(blocks: list[Any]) -> dict[str, Any] | None:
    def walk(node: Any) -> dict[str, Any] | None:
        if isinstance(node, list):
            for item in node:
                found = walk(item)
                if found:
                    return found
        elif isinstance(node, dict):
            node_type = node.get("@type", "")
            types = node_type if isinstance(node_type, list) else [node_type]
            if any(str(t).lower() == "product" for t in types):
                return node
            for value in node.values():
                if isinstance(value, (list, dict)):
                    found = walk(value)
                    if found:
                        return found
        return None

    return walk(blocks)


def _api_offers(
    api_product: dict[str, Any],
    *,
    source_url: str,
    currency: str | None,
) -> list[dict[str, Any]]:
    offers: list[dict[str, Any]] = []
    for variant in api_product.get("variants") or []:
        sku = variant.get("sku")
        offers.append({
            "@type": "Offer",
            "price": variant.get("price"),
            "priceCurrency": currency,
            "availability": _availability(variant.get("available")),
            "sku": str(sku) if sku else None,
            "url": f"{source_url}?variant={variant.get('id')}",
            "size": _variant_size_label(variant),
        })
    return offers


def _api_images(api_product: dict[str, Any]) -> list[str]:
    return [img.get("src") for img in (api_product.get("images") or []) if img.get("src")]


def merge_api_into_record(
    record: dict[str, Any],
    api_product: dict[str, Any],
    *,
    currency: str | None,
) -> dict[str, Any]:
    """Augment a parsed HTML record with complete API variant and image data."""
    source_url = record.get("source_url", "")
    product_ld = _first_product_ld(record.get("json_ld") or [])
    if product_ld is None:
        return record

    offers = _api_offers(api_product, source_url=source_url, currency=currency)
    if offers:
        product_ld["offers"] = offers

    api_images = _api_images(api_product)
    existing = product_ld.get("image")
    existing_count = 0
    if isinstance(existing, list):
        existing_count = len(existing)
    elif isinstance(existing, str):
        existing_count = 1

    if api_images and (not existing or existing_count < len(api_images)):
        product_ld["image"] = api_images

    variants = api_product.get("variants") or []
    if variants and variants[0].get("sku"):
        product_ld["sku"] = str(variants[0]["sku"])

    if api_product.get("title") and not product_ld.get("name"):
        product_ld["name"] = api_product["title"]

    return record


def shopify_product_to_record(
    product: dict[str, Any],
    *,
    origin: str,
    currency: str | None,
    brand_name: str | None,
    page_wait_seconds: float = 0.0,
) -> dict[str, Any]:
    """Build a crawl record from API data only (fallback when HTML fetch fails)."""
    handle = product.get("handle", "")
    source_url = f"{origin}/products/{handle}"
    description = _html_to_text(product.get("body_html") or "")
    variants = product.get("variants") or []
    images = _api_images(product)

    offers = _api_offers(product, source_url=source_url, currency=currency)

    primary_sku = None
    if variants and variants[0].get("sku"):
        primary_sku = str(variants[0]["sku"])

    product_ld: dict[str, Any] = {
        "@context": "https://schema.org/",
        "@type": "Product",
        "name": product.get("title"),
        "description": description,
        "brand": {"@type": "Brand", "name": product.get("vendor")},
        "sku": primary_sku,
        "image": images,
        "url": source_url,
    }
    if offers:
        product_ld["offers"] = offers

    return {
        "source_url": source_url,
        "json_ld": [product_ld],
        "text_content": _build_text_content(product, description, currency)[:50_000],
        "brand_name": brand_name,
        "variant_swatches": [],
        "_source": "shopify_api_fallback",
        "_timing": {
            "scrape": {
                "page_wait_seconds": round_seconds(page_wait_seconds),
                "json_ld_seconds": 0.0,
                "text_extract_seconds": 0.0,
                "total_seconds": 0.0,
            }
        },
    }


def _build_text_content(product: dict[str, Any], description: str, currency: str | None) -> str:
    parts: list[str] = []
    if product.get("title"):
        parts.append(str(product["title"]))
    if description:
        parts.append(description)
    if product.get("product_type"):
        parts.append(f"Type: {product['product_type']}")

    for option in product.get("options") or []:
        if isinstance(option, dict):
            name = option.get("name")
            values = option.get("values") or []
            if name and values:
                parts.append(f"{name}: {', '.join(str(v) for v in values)}")

    variant_lines: list[str] = []
    for variant in product.get("variants") or []:
        label = _variant_size_label(variant) or "Default"
        price = variant.get("price")
        stock = "in stock" if variant.get("available") else "out of stock"
        price_str = f"{price} {currency}".strip() if price else ""
        variant_lines.append(f"{label} {price_str} ({stock})".strip())
    if variant_lines:
        parts.append("Variants: " + "; ".join(variant_lines))

    tags = product.get("tags")
    if isinstance(tags, list) and tags:
        parts.append("Tags: " + ", ".join(str(t) for t in tags))

    return "\n".join(parts)


def _is_challenge_response(response: httpx.Response) -> bool:
    body_lower = (response.text or "")[:20_000].lower()
    return _detect_cloudflare_challenge(response.headers, response.status_code, body_lower)


def _scrape_timing(page_wait_seconds: float) -> dict[str, float]:
    return {
        "page_wait_seconds": round_seconds(page_wait_seconds),
        "json_ld_seconds": 0.0,
        "text_extract_seconds": 0.0,
        "total_seconds": 0.0,
    }


def discover_shopify_products(
    endpoint: str,
    origin: str,
    *,
    skip_keys: set[str],
    max_products: int | None,
    on_failure: FailureCallback | None,
) -> tuple[list[tuple[str, dict[str, Any]]], int, str | None]:
    """Page through the Shopify JSON API and return (source_url, api_product) pairs."""
    request_headers = {"User-Agent": PROBE_USER_AGENT, "Accept": JSON_ACCEPT}
    discovered: list[tuple[str, dict[str, Any]]] = []
    seen_keys = set(skip_keys)
    requests_count = 0
    currency: str | None = None

    with httpx.Client(follow_redirects=True, timeout=FETCH_TIMEOUT, headers=request_headers) as client:
        try:
            meta = client.get(f"{origin}/meta.json")
            if meta.status_code == 200:
                currency = meta.json().get("currency")
        except Exception:  # noqa: BLE001
            pass

        for page in range(1, MAX_API_PAGES + 1):
            if max_products is not None and len(discovered) >= max_products:
                break
            try:
                response = client.get(endpoint, params={"limit": PAGE_LIMIT, "page": page})
                response.raise_for_status()
                payload = response.json()
            except Exception as exc:  # noqa: BLE001
                if on_failure:
                    on_failure(
                        url=f"{endpoint}?page={page}",
                        stage="browse",
                        reason=f"shopify products.json fetch failed: {type(exc).__name__}: {exc}",
                    )
                break

            requests_count += 1
            products = payload.get("products") or []
            if not products:
                break

            for product in products:
                if max_products is not None and len(discovered) >= max_products:
                    break
                handle = product.get("handle", "")
                if not handle:
                    continue
                source_url = f"{origin}/products/{handle}"
                key = product_key(source_url)
                if key in seen_keys:
                    continue
                seen_keys.add(key)
                discovered.append((source_url, product))

            if len(products) < PAGE_LIMIT:
                break
            time.sleep(INTER_PAGE_DELAY)

    return discovered, requests_count, currency


async def _fetch_product_page(
    client: httpx.AsyncClient,
    semaphore: asyncio.Semaphore,
    *,
    source_url: str,
    api_product: dict[str, Any],
    origin: str,
    currency: str | None,
    brand_name: str | None,
    pages_dir: Path,
    on_failure: FailureCallback | None,
) -> tuple[dict[str, Any], float]:
    async with semaphore:
        await asyncio.sleep(random.uniform(0, FETCH_JITTER_SECONDS))
        started = time.perf_counter()
        try:
            response = await client.get(source_url)
            elapsed = time.perf_counter() - started

            if response.status_code != 200 or _is_challenge_response(response):
                reason = (
                    f"product page HTTP {response.status_code}"
                    if response.status_code != 200
                    else "cloudflare challenge on product page"
                )
                if on_failure:
                    on_failure(url=source_url, stage="product", reason=reason)
                record = shopify_product_to_record(
                    api_product,
                    origin=origin,
                    currency=currency,
                    brand_name=brand_name,
                    page_wait_seconds=elapsed,
                )
                return record, elapsed

            html_content = response.text or ""
            site_config = get_site_config(source_url)
            record = reparse_html(html_content, source_url, site_config, brand_name=brand_name)
            record = merge_api_into_record(record, api_product, currency=currency)
            record["brand_name"] = brand_name
            record["_source"] = "shopify_hybrid"

            key = product_key(source_url)
            filename = safe_page_filename(key)
            html_path = pages_dir / filename
            html_path.write_text(html_content, encoding="utf-8")
            record["html_file"] = f"pages/{filename}"

            record["_timing"] = {"scrape": _scrape_timing(elapsed)}
            return record, elapsed

        except Exception as exc:  # noqa: BLE001
            elapsed = time.perf_counter() - started
            if on_failure:
                on_failure(
                    url=source_url,
                    stage="product",
                    reason=f"product page fetch failed: {type(exc).__name__}: {exc}",
                )
            record = shopify_product_to_record(
                api_product,
                origin=origin,
                currency=currency,
                brand_name=brand_name,
                page_wait_seconds=elapsed,
            )
            return record, elapsed


async def _fetch_all_product_pages(
    products: list[tuple[str, dict[str, Any]]],
    *,
    origin: str,
    currency: str | None,
    brand_name: str | None,
    pages_dir: Path,
    on_failure: FailureCallback | None,
) -> list[tuple[dict[str, Any], float]]:
    headers = {
        "User-Agent": PROBE_USER_AGENT,
        "Accept": HTML_ACCEPT,
        "Accept-Language": "en-US,en;q=0.9",
    }
    semaphore = asyncio.Semaphore(FETCH_CONCURRENCY)

    async with httpx.AsyncClient(
        follow_redirects=True,
        timeout=FETCH_TIMEOUT,
        headers=headers,
    ) as client:
        tasks = [
            _fetch_product_page(
                client,
                semaphore,
                source_url=source_url,
                api_product=api_product,
                origin=origin,
                currency=currency,
                brand_name=brand_name,
                pages_dir=pages_dir,
                on_failure=on_failure,
            )
            for source_url, api_product in products
        ]
        return await asyncio.gather(*tasks)


def crawl_shopify_source(
    seed_url: str,
    probe: SiteProbe,
    *,
    raw_path: Path,
    brand_name: str | None,
    skip_product_keys: set[str] | None = None,
    max_products: int | None = None,
    on_failure: FailureCallback | None = None,
    logger: Callable[[str], None] = print,
) -> dict[str, Any]:
    """Harvest a Shopify storefront: API discovery + plain HTTP product pages."""
    started = time.perf_counter()
    origin = probe.origin
    endpoint = products_endpoint(origin, seed_url)
    skip = skip_product_keys or set()

    raw_path.parent.mkdir(parents=True, exist_ok=True)
    pages_dir = raw_path.parent / "pages"
    pages_dir.mkdir(parents=True, exist_ok=True)
    product_timing = TimingAccumulator()

    logger(f"  Shopify hybrid: discover via {endpoint}, fetch product HTML (concurrency={FETCH_CONCURRENCY})")

    discovered, api_requests, currency = discover_shopify_products(
        endpoint,
        origin,
        skip_keys=skip,
        max_products=max_products,
        on_failure=on_failure,
    )
    currency = currency or probe.currency

    if not discovered:
        elapsed = round_seconds(time.perf_counter() - started)
        return {
            "technique": "shopify_api",
            "browse": {"page_wait_seconds": 0.0, "total_seconds": elapsed, "browse_pages": api_requests},
            "products": {},
            "crawl_elapsed_seconds": elapsed,
            "requests_count": api_requests,
            "items_scraped": 0,
            "engine_elapsed_seconds": elapsed,
            "probe": probe.summary(),
        }

    logger(f"  Shopify hybrid: fetching {len(discovered)} product page(s)")

    results = asyncio.run(
        _fetch_all_product_pages(
            discovered,
            origin=origin,
            currency=currency,
            brand_name=brand_name,
            pages_dir=pages_dir,
            on_failure=on_failure,
        )
    )

    written = 0
    html_saved = 0
    with raw_path.open("a", encoding="utf-8") as raw_file:
        for record, _elapsed in results:
            raw_file.write(json.dumps(record, ensure_ascii=False) + "\n")
            raw_file.flush()
            product_timing.add(record["_timing"]["scrape"])
            written += 1
            if record.get("html_file"):
                html_saved += 1

    requests_count = api_requests + len(discovered)
    elapsed = round_seconds(time.perf_counter() - started)
    products_summary = product_timing.summary()
    crawl_timings = {
        "technique": "shopify_api",
        "browse": {
            "page_wait_seconds": products_summary.get("page_wait_seconds", 0.0),
            "total_seconds": elapsed,
            "browse_pages": api_requests,
        },
        "products": products_summary,
        "crawl_elapsed_seconds": elapsed,
        "requests_count": requests_count,
        "items_scraped": written,
        "html_pages_saved": html_saved,
        "engine_elapsed_seconds": elapsed,
        "probe": probe.summary(),
    }

    log_timing(
        "shopify crawl",
        f"{written} products ({html_saved} HTML pages) in {requests_count} request(s)",
        {"page_wait_seconds": products_summary.get("page_wait_seconds", 0.0), "total_seconds": elapsed},
        keys=["page_wait_seconds", "total_seconds"],
    )
    return crawl_timings
