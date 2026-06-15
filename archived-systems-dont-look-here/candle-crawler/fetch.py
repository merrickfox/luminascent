"""Fetch product pages with crawl4ai anti-bot features."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, AsyncIterator, Callable

from crawl4ai import (
    AsyncWebCrawler,
    BrowserConfig,
    CacheMode,
    CrawlerRunConfig,
    MemoryAdaptiveDispatcher,
    RateLimiter,
    UndetectedAdapter,
)
from crawl4ai.async_crawler_strategy import AsyncPlaywrightCrawlerStrategy
from crawl4ai.content_filter_strategy import PruningContentFilter
from crawl4ai.markdown_generation_strategy import DefaultMarkdownGenerator

from audit import RunPaths, log_failure, write_page_artifacts
from profiles import profile_browser_config
from utils import log_stage


CHALLENGE_MARKERS = (
    "just a moment",
    "challenges.cloudflare.com",
    "cf-browser-verification",
    "checking your browser",
    "access denied",
    "turnstile",
)


def is_blocked_result(result) -> bool:
    if not result.success:
        return True
    html = (result.html or "").lower()
    if any(marker in html for marker in CHALLENGE_MARKERS):
        if len(html) < 5000 or "just a moment" in html:
            return True
    stats = getattr(result, "crawl_stats", None) or {}
    for attempt in stats.get("proxies_used") or []:
        if attempt.get("blocked"):
            return True
    return False


def fit_markdown_from_result(result) -> str:
    markdown = getattr(result, "markdown", None)
    if markdown is None:
        return ""
    fit = getattr(markdown, "fit_markdown", None) or ""
    raw = getattr(markdown, "raw_markdown", None) or ""
    if len(fit.strip()) >= 200:
        return fit
    if raw.strip():
        return raw
    return fit


@dataclass
class FetchConfig:
    headless: bool = True
    use_stealth: bool = True
    magic: bool = True
    simulate_user: bool = False
    max_retries: int = 1
    screenshot: bool = False
    undetected: bool = False
    profile_path: str | None = None
    page_timeout_ms: int = 45000
    scan_full_page: bool = False


def build_browser_config(cfg: FetchConfig) -> BrowserConfig:
    if cfg.profile_path:
        return profile_browser_config(cfg.profile_path, headless=cfg.headless)
    return BrowserConfig(
        headless=cfg.headless,
        enable_stealth=cfg.use_stealth,
        verbose=False,
    )


def build_run_config(cfg: FetchConfig, *, stream: bool = True) -> CrawlerRunConfig:
    markdown_generator = DefaultMarkdownGenerator(
        content_filter=PruningContentFilter(threshold=0.45, min_word_threshold=20),
        options={"ignore_links": False},
    )
    return CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS,
        magic=cfg.magic,
        simulate_user=cfg.simulate_user,
        wait_until="domcontentloaded",
        page_timeout=cfg.page_timeout_ms,
        delay_before_return_html=0.3,
        scan_full_page=cfg.scan_full_page,
        scroll_delay=0.15,
        remove_overlay_elements=True,
        screenshot=cfg.screenshot,
        max_retries=cfg.max_retries,
        markdown_generator=markdown_generator,
        stream=stream,
        verbose=False,
    )


def build_dispatcher() -> MemoryAdaptiveDispatcher:
    return MemoryAdaptiveDispatcher(
        memory_threshold_percent=75.0,
        max_session_permit=3,
        rate_limiter=RateLimiter(base_delay=(0.5, 1.0), max_delay=10.0, max_retries=1),
    )


def build_crawler(cfg: FetchConfig):
    browser_config = build_browser_config(cfg)
    if cfg.undetected:
        strategy = AsyncPlaywrightCrawlerStrategy(
            browser_config=browser_config,
            browser_adapter=UndetectedAdapter(),
        )
        return AsyncWebCrawler(crawler_strategy=strategy, config=browser_config)
    return AsyncWebCrawler(config=browser_config)


async def fetch_urls(
    urls: list[str],
    cfg: FetchConfig,
    *,
    on_result: Callable[[Any, int, int], None] | None = None,
) -> AsyncIterator[Any]:
    if not urls:
        return

    run_config = build_run_config(cfg, stream=True)
    dispatcher = build_dispatcher()
    total = len(urls)

    async with build_crawler(cfg) as crawler:
        results = await crawler.arun_many(urls, config=run_config, dispatcher=dispatcher)
        index = 0
        if hasattr(results, "__aiter__"):
            async for result in results:
                index += 1
                if on_result:
                    on_result(result, index, total)
                yield result
        else:
            for result in results:
                index += 1
                if on_result:
                    on_result(result, index, total)
                yield result


async def fetch_with_escalation(
    urls: list[str],
    cfg: FetchConfig,
) -> AsyncIterator[tuple[Any, str]]:
    pending = list(urls)
    resolved: set[str] = set()
    blocked_results: dict[str, Any] = {}

    log_stage(f"  Fetch: {len(pending)} URL(s)")

    mode_cfg = FetchConfig(
        headless=cfg.headless,
        use_stealth=cfg.use_stealth,
        magic=cfg.magic,
        simulate_user=cfg.simulate_user,
        max_retries=cfg.max_retries,
        screenshot=cfg.screenshot,
        undetected=False,
        profile_path=cfg.profile_path,
        page_timeout_ms=cfg.page_timeout_ms,
        scan_full_page=cfg.scan_full_page,
    )

    def on_result(result, index, total):
        short = result.url.rsplit("/", 1)[-1][:48] or result.url
        log_stage(f"  Fetch [{index}/{total}]: {short}")

    async for result in fetch_urls(pending, mode_cfg, on_result=on_result):
        if is_blocked_result(result):
            blocked_results[result.url] = result
        else:
            resolved.add(result.url)
        yield result, "standard"

    retry_urls = [url for url in blocked_results if url not in resolved]
    if not retry_urls or cfg.undetected:
        return

    log_stage(f"  Fetch: retrying {len(retry_urls)} blocked URL(s) with undetected browser")
    retry_cfg = FetchConfig(
        headless=False,
        use_stealth=cfg.use_stealth,
        magic=cfg.magic,
        simulate_user=cfg.simulate_user,
        max_retries=cfg.max_retries,
        screenshot=cfg.screenshot,
        undetected=True,
        profile_path=cfg.profile_path,
        page_timeout_ms=cfg.page_timeout_ms,
        scan_full_page=cfg.scan_full_page,
    )

    async for result in fetch_urls(retry_urls, retry_cfg, on_result=on_result):
        yield result, "undetected"


async def fetch_and_audit(
    paths: RunPaths,
    site_name: str,
    urls: list[str],
    cfg: FetchConfig,
) -> tuple[list[Any], dict[str, Any]]:
    crawl_stats: dict[str, Any] = {"urls": {}}
    successful: list[Any] = []

    async for result, mode in fetch_with_escalation(urls, cfg):
        url = result.url
        blocked = is_blocked_result(result)
        crawl_stats["urls"][url] = {
            "success": result.success and not blocked,
            "mode": mode,
            "blocked": blocked,
            "status_code": getattr(result, "status_code", None),
            "error_message": getattr(result, "error_message", None),
            "crawl_stats": getattr(result, "crawl_stats", None),
        }

        if blocked or not result.success:
            log_stage(f"  Fetch failed: {url}")
            log_failure(
                paths,
                site_name,
                url=url,
                stage="fetch",
                reason=getattr(result, "error_message", None) or "blocked or failed fetch",
            )
            continue

        markdown = fit_markdown_from_result(result)
        artifacts = write_page_artifacts(
            paths,
            site_name,
            url=url,
            html=result.html,
            markdown=markdown,
            screenshot_b64=getattr(result, "screenshot", None),
        )
        crawl_stats["urls"][url]["artifacts"] = artifacts
        successful.append(result)
        log_stage(f"  Fetch ok: {url}")

    return successful, crawl_stats
