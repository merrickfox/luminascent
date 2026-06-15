"""Crawl configuration: generic defaults with optional per-site overrides from a local file."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse

_OVERRIDES_PATH = Path(__file__).parent / "sites.local.json"


@dataclass
class SiteConfig:
    product_link_selector: str | None = None
    pagination_selectors: list[str] = field(default_factory=list)
    wait_selector: str | None = None
    infinite_scroll: bool = True
    scroll_rounds: int = 5
    main_content_selectors: list[str] = field(default_factory=list)
    variant_swatch_selector: str | None = None
    variant_size_attr: str = "data-attr-value"
    variant_sku_attr: str = "kl-data-variant-sku"
    variant_available_attr: str = "data-available"
    variant_url_attr: str = "data-href"
    follow_variant_pages: bool = False
    variant_price_selector: str | None = None


DEFAULT_VARIANT_SWATCH_SELECTOR = (
    'a.js-swatch-attr, a.swatch-attribute-container, [data-product-option-type="option-swatch"]'
)


GENERIC_CONFIG = SiteConfig(
    wait_selector="main, [role='main'], [itemtype*='Product'], .product, article",
    infinite_scroll=True,
    scroll_rounds=5,
    variant_swatch_selector=DEFAULT_VARIANT_SWATCH_SELECTOR,
    follow_variant_pages=False,
    main_content_selectors=[
        "[itemtype*='Product']",
        "main",
        "[role='main']",
        ".product-detail",
        ".product",
        "#product",
        "article",
    ],
    pagination_selectors=[
        'a[rel="next"]',
        "a.next",
        'a[aria-label*="next"]',
        'a[aria-label*="Next"]',
        'a[href*="?page="]',
        'a[href*="/page/"]',
    ],
)


def domain_from_url(url: str) -> str:
    host = urlparse(url).netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    return host


def _load_local_overrides() -> dict[str, dict]:
    if not _OVERRIDES_PATH.exists():
        return {}
    try:
        data = json.loads(_OVERRIDES_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, OSError):
        return {}


def _config_from_dict(data: dict) -> SiteConfig:
    return SiteConfig(
        product_link_selector=data.get("product_link_selector"),
        pagination_selectors=data.get("pagination_selectors") or list(GENERIC_CONFIG.pagination_selectors),
        wait_selector=data.get("wait_selector") or GENERIC_CONFIG.wait_selector,
        infinite_scroll=data.get("infinite_scroll", GENERIC_CONFIG.infinite_scroll),
        scroll_rounds=data.get("scroll_rounds", GENERIC_CONFIG.scroll_rounds),
        main_content_selectors=data.get("main_content_selectors") or list(GENERIC_CONFIG.main_content_selectors),
        variant_swatch_selector=data.get("variant_swatch_selector", DEFAULT_VARIANT_SWATCH_SELECTOR),
        variant_size_attr=data.get("variant_size_attr", "data-attr-value"),
        variant_sku_attr=data.get("variant_sku_attr", "kl-data-variant-sku"),
        variant_available_attr=data.get("variant_available_attr", "data-available"),
        variant_url_attr=data.get("variant_url_attr", "data-href"),
        follow_variant_pages=bool(data.get("follow_variant_pages", False)),
        variant_price_selector=data.get("variant_price_selector"),
    )


def get_site_config(url: str) -> SiteConfig:
    domain = domain_from_url(url)
    overrides = _load_local_overrides()
    if domain not in overrides:
        return GENERIC_CONFIG
    return _config_from_dict(overrides[domain])


def allowed_domain(url: str) -> str:
    return domain_from_url(url)
