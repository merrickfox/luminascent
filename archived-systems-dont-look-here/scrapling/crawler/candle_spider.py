"""Scrapling spider for crawling candle category and product pages."""

from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any, Callable

from scrapling.fetchers import AsyncStealthySession
from scrapling.spiders import Request, Response, Spider

from link_discovery import collect_product_links, product_key
from parsing import extract_json_ld_blocks, extract_main_text, extract_variant_swatches, is_product_page
from sites import SiteConfig, allowed_domain, get_site_config
from state import format_exception, safe_page_filename
from timing import StageTimer, TimingAccumulator, log_timing, page_wait_seconds, stamp_request_meta


FailureCallback = Callable[..., None]


def find_pagination_link(response: Response, config: SiteConfig) -> str | None:
    from urllib.parse import urljoin, urlparse

    def normalize(href: str) -> str | None:
        if not href or href.startswith(("<", "#", "javascript:")):
            return None
        absolute = urljoin(response.url, href)
        parsed = urlparse(absolute)
        if parsed.scheme not in ("http", "https"):
            return None
        return absolute

    for selector in config.pagination_selectors:
        try:
            href = response.css(f"{selector}::attr(href)").get()
            if href:
                return normalize(href)
        except Exception:
            continue

    for label in ("Next", "Load more", "Show more", "See more", "View more"):
        try:
            element = response.find_by_text(label, first_match=True)
            if element:
                href = element.attrib.get("href") or element.css("::attr(href)").get()
                if href:
                    return normalize(href)
        except Exception:
            pass

    for pattern in (r'href="[^"]*\?page=\d+', r'href="[^"]*/page/\d+'):
        match = re.search(pattern, response.html_content or "", re.I)
        if match:
            href_match = re.search(r'href="([^"]+)"', match.group(0))
            if href_match:
                return normalize(href_match.group(1))

    return None


_CARD_PROBE_SELECTORS = (
    "[itemtype*='Product']",
    ".product-item",
    ".product-card",
    ".product-tile",
    ".product",
    "[data-product]",
    "li.item.product",
)


def make_browse_action(config: SiteConfig):
    card_probe = ", ".join(_CARD_PROBE_SELECTORS)
    max_rounds = max(config.scroll_rounds, 5) * 2

    async def action(page):
        try:
            await page.wait_for_load_state("networkidle", timeout=8_000)
        except Exception:
            pass

        previous, stable = -1, 0
        for _ in range(max_rounds):
            count = await page.evaluate(
                """(selector) => {
                    const cards = document.querySelectorAll(selector);
                    if (cards.length) return cards.length;
                    return document.querySelectorAll('a[href]').length;
                }""",
                card_probe,
            )
            if count == previous:
                stable += 1
                if stable >= 2 and count > 0:
                    break
            else:
                stable = 0
            previous = count
            if config.infinite_scroll:
                await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            await page.wait_for_timeout(1_200)

    return action


def create_candle_spider(
    seed_url: str,
    output_dir: Path,
    *,
    brand_name: str | None = None,
    pass_dir: Path | None = None,
    raw_output_path: Path | None = None,
    failure_callback: FailureCallback | None = None,
    skip_product_keys: set[str] | None = None,
    max_pages: int = 10,
    max_products: int | None = None,
    development_mode: bool = False,
    solve_cloudflare: bool = False,
    network_idle: bool = False,
) -> type[Spider]:
    site_config = get_site_config(seed_url)
    domain = allowed_domain(seed_url)
    scrape_pass_dir = pass_dir or output_dir
    raw_path = raw_output_path or scrape_pass_dir / "products.raw.jsonl"
    pages_dir = scrape_pass_dir / "pages"
    dev_mode = development_mode
    on_failure = failure_callback
    initial_skip = skip_product_keys or set()
    brand = brand_name
    cf_solve = solve_cloudflare
    net_idle = network_idle
    browse_action = make_browse_action(site_config)

    def browse_kwargs(*, category_page: int | None = None) -> dict[str, Any]:
        meta = stamp_request_meta({"category_page": category_page} if category_page else None)
        return {
            "meta": meta,
            "network_idle": net_idle,
            "wait_selector": site_config.wait_selector,
            "wait_selector_state": "visible",
            "timeout": 60_000,
            "page_action": browse_action,
        }

    class CandleSpider(Spider):
        name = f"candles_{domain.replace('.', '_')}"
        start_urls = [seed_url]
        allowed_domains = {domain}
        concurrent_requests = 3
        concurrent_requests_per_domain = 2
        download_delay = 1.0
        development_mode = dev_mode

        _category_pages_seen = 0
        _products_queued = 0
        _product_keys_seen: set[str] = set(initial_skip)
        _raw_file = None
        _browse_timing = TimingAccumulator()
        _product_timing = TimingAccumulator()
        crawl_timing_summary: dict[str, Any] = {}

        def configure_sessions(self, manager):
            manager.add(
                "stealth",
                AsyncStealthySession(
                    headless=True,
                    solve_cloudflare=cf_solve,
                    network_idle=net_idle,
                    block_webrtc=True,
                    hide_canvas=True,
                    block_ads=True,
                    dns_over_https=True,
                    timeout=60_000,
                    max_pages=4,
                    google_search=True,
                ),
                default=True,
            )

        async def on_start(self, resuming: bool = False):
            self._crawl_started_at = time.perf_counter()
            raw_path.parent.mkdir(parents=True, exist_ok=True)
            pages_dir.mkdir(parents=True, exist_ok=True)
            self._raw_file = open(raw_path, "a", encoding="utf-8")
            self.logger.info(f"Crawling {seed_url} -> {raw_path}")

        async def start_requests(self):
            for url in self.start_urls:
                yield Request(
                    url,
                    callback=self.parse,
                    sid="stealth",
                    **browse_kwargs(category_page=1),
                )

        async def on_close(self):
            if self._raw_file:
                self._raw_file.close()
                self._raw_file = None
            self.crawl_timing_summary = {
                "browse": self._browse_timing.summary(),
                "products": self._product_timing.summary(),
                "crawl_elapsed_seconds": round(
                    time.perf_counter() - getattr(self, "_crawl_started_at", time.perf_counter()), 3
                ),
            }
            browse = self.crawl_timing_summary["browse"]
            products = self.crawl_timing_summary["products"]
            log_timing(
                "crawl total",
                f"{products.get('items', 0)} products, {browse.get('browse_pages', 0)} browse pages",
                {
                    "page_wait_seconds": browse.get("page_wait_seconds", 0) + products.get("page_wait_seconds", 0),
                    "parse_seconds": browse.get("total_seconds", 0),
                    "scrape_seconds": products.get("total_seconds", 0),
                    "total_seconds": self.crawl_timing_summary["crawl_elapsed_seconds"],
                },
                keys=["page_wait_seconds", "parse_seconds", "scrape_seconds", "total_seconds"],
            )

        async def on_error(self, request, error: Exception):
            self.logger.error(f"Failed: {request.url} - {error}")
            if on_failure:
                on_failure(url=request.url, stage="request", **format_exception(error))

        async def on_scraped_item(self, item: dict) -> dict | None:
            html = item.pop("_html", None)
            if html:
                key = product_key(item.get("source_url", ""))
                filename = safe_page_filename(key)
                html_path = pages_dir / filename
                html_path.write_text(html, encoding="utf-8")
                item["html_file"] = f"pages/{filename}"
            if self._raw_file:
                self._raw_file.write(json.dumps(item, ensure_ascii=False) + "\n")
                self._raw_file.flush()
            return item

        async def parse(self, response: Response):
            parse_started = time.perf_counter()
            timer = StageTimer()
            timer.add("page_wait_seconds", page_wait_seconds(response.meta))

            category_page = response.meta.get("category_page", self._category_pages_seen + 1)
            self._category_pages_seen = max(self._category_pages_seen, category_page)
            self.logger.info(f"Parsing category page {category_page}: {response.url}")

            with timer.stage("link_discovery_seconds"):
                product_links = collect_product_links(
                    response,
                    extra_selector=site_config.product_link_selector,
                )
            self.logger.info(f"Found {len(product_links)} product links on {response.url}")

            if not product_links and on_failure:
                on_failure(
                    url=response.url,
                    stage="browse",
                    reason="no product links found on category page",
                )

            queued_this_page = 0
            for link in product_links:
                if max_products is not None and self._products_queued >= max_products:
                    break
                key = product_key(link)
                if key in self._product_keys_seen:
                    continue
                self._product_keys_seen.add(key)
                self._products_queued += 1
                queued_this_page += 1
                yield response.follow(
                    link,
                    sid="stealth",
                    callback=self.parse_product,
                    priority=10,
                    meta=stamp_request_meta(),
                    network_idle=net_idle,
                    wait_selector=site_config.wait_selector,
                    timeout=60_000,
                    wait=2_000,
                )

            if category_page < max_pages:
                with timer.stage("pagination_seconds"):
                    next_link = find_pagination_link(response, site_config)
                if next_link:
                    yield response.follow(
                        next_link,
                        callback=self.parse,
                        sid="stealth",
                        **browse_kwargs(category_page=category_page + 1),
                    )
                elif site_config.infinite_scroll and category_page == 1:
                    yield Request(
                        response.url,
                        callback=self.parse,
                        sid="stealth",
                        dont_filter=True,
                        **browse_kwargs(category_page=category_page + 1),
                    )

            timer.set_total(time.perf_counter() - parse_started)
            browse_timing = timer.as_dict()
            browse_timing["links_found"] = len(product_links)
            browse_timing["links_queued"] = queued_this_page
            self._browse_timing.add(browse_timing, item_key="browse_pages")
            log_timing(
                "browse",
                f"page {category_page} ({queued_this_page} queued)",
                browse_timing,
                keys=["page_wait_seconds", "link_discovery_seconds", "pagination_seconds", "total_seconds"],
            )
            browse_total = self._browse_timing.summary()
            log_timing(
                "browse total",
                f"{browse_total.get('browse_pages', 0)} pages",
                browse_total,
                keys=["page_wait_seconds", "link_discovery_seconds", "pagination_seconds", "total_seconds"],
            )

        async def parse_product(self, response: Response):
            scrape_started = time.perf_counter()
            timer = StageTimer()
            timer.add("page_wait_seconds", page_wait_seconds(response.meta))

            if not is_product_page(response):
                self.logger.info(f"Skipping non-product page: {response.url}")
                if on_failure:
                    on_failure(
                        url=response.url,
                        stage="product",
                        reason="page does not appear to be a product page",
                    )
                return

            with timer.stage("json_ld_seconds"):
                json_ld = extract_json_ld_blocks(response)
            with timer.stage("text_extract_seconds"):
                text_content = extract_main_text(response, site_config)
            with timer.stage("variant_swatches_seconds"):
                variant_swatches = extract_variant_swatches(response, site_config, base_url=response.url)

            timer.set_total(time.perf_counter() - scrape_started)
            scrape_timing = timer.as_dict()
            self._product_timing.add(scrape_timing)
            short_url = response.url.rsplit("/", 1)[-1][:48] or response.url
            log_timing(
                "product",
                short_url,
                scrape_timing,
                keys=["page_wait_seconds", "json_ld_seconds", "text_extract_seconds", "variant_swatches_seconds", "total_seconds"],
            )

            parent_key = product_key(response.url)
            record = {
                "source_url": response.url,
                "json_ld": json_ld,
                "text_content": text_content[:50_000],
                "brand_name": brand,
                "variant_swatches": variant_swatches,
                "_html": response.html_content or "",
                "_timing": {"scrape": scrape_timing},
            }
            yield record

            if site_config.follow_variant_pages and variant_swatches:
                seen_urls: set[str] = set()
                for swatch in variant_swatches:
                    variant_url = swatch.get("variant_url")
                    if not variant_url or variant_url in seen_urls:
                        continue
                    seen_urls.add(variant_url)
                    yield response.follow(
                        variant_url,
                        sid="stealth",
                        callback=self.parse_variant,
                        priority=5,
                        meta=stamp_request_meta({
                            "_variant_of": parent_key,
                            "variant_size": swatch.get("size"),
                            "variant_sku": swatch.get("sku"),
                        }),
                        network_idle=net_idle,
                        wait_selector=site_config.wait_selector,
                        timeout=60_000,
                        wait=2_000,
                        dont_filter=True,
                    )

        async def parse_variant(self, response: Response):
            scrape_started = time.perf_counter()
            timer = StageTimer()
            timer.add("page_wait_seconds", page_wait_seconds(response.meta))

            with timer.stage("json_ld_seconds"):
                json_ld = extract_json_ld_blocks(response)
            with timer.stage("text_extract_seconds"):
                text_content = extract_main_text(response, site_config)

            timer.set_total(time.perf_counter() - scrape_started)
            scrape_timing = timer.as_dict()
            self._product_timing.add(scrape_timing)

            yield {
                "source_url": response.url,
                "json_ld": json_ld,
                "text_content": text_content[:50_000],
                "brand_name": brand,
                "_variant_of": response.meta.get("_variant_of"),
                "variant_size": response.meta.get("variant_size"),
                "variant_sku": response.meta.get("variant_sku"),
                "_html": response.html_content or "",
                "_timing": {"scrape": scrape_timing},
            }

    return CandleSpider
