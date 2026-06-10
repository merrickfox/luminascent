"""Shared HTML parsing helpers for crawl and offline reprocess."""

from __future__ import annotations

import json
from typing import Any, Protocol
from urllib.parse import urljoin

from sites import SiteConfig


class PageLike(Protocol):
    def css(self, selector: str): ...
    def get_all_text(self, *, strip: bool = False) -> str: ...


def extract_json_ld_blocks(page: PageLike) -> list[Any]:
    blocks: list[Any] = []
    for script in page.css('script[type="application/ld+json"]'):
        raw = script.text
        if not raw:
            continue
        try:
            blocks.append(json.loads(raw))
        except json.JSONDecodeError:
            continue
    return blocks


def _has_product_json_ld(blocks: list[Any]) -> bool:
    def walk(node):
        if isinstance(node, list):
            return any(walk(item) for item in node)
        if isinstance(node, dict):
            node_type = node.get("@type", "")
            types = node_type if isinstance(node_type, list) else [node_type]
            if any(str(t).lower() == "product" for t in types):
                return True
            return any(walk(v) for v in node.values() if isinstance(v, (list, dict)))
        return False

    return walk(blocks)


def extract_main_text(page: PageLike, config: SiteConfig) -> str:
    for selector in config.main_content_selectors:
        nodes = page.css(selector)
        if nodes:
            text = nodes[0].get_all_text(strip=True)
            if text and len(text) > 50:
                return text
    return page.get_all_text(strip=True)


def is_product_page(page: PageLike) -> bool:
    json_ld = extract_json_ld_blocks(page)
    if _has_product_json_ld(json_ld):
        return True
    if page.css("[itemtype*='Product'], .product-detail, .product-price, [data-product-price]"):
        return True
    return False


def _attr_from_node(node, attr: str, *, on_child: str | None = None) -> str | None:
    if on_child:
        child = node.css(on_child)
        if child:
            value = child[0].attrib.get(attr) or child[0].css(f"::attr({attr})").get()
            if value:
                return str(value).strip()
    value = node.attrib.get(attr) or node.css(f"::attr({attr})").get()
    if value:
        return str(value).strip()
    return None


def extract_variant_swatches(page: PageLike, config: SiteConfig, base_url: str = "") -> list[dict[str, Any]]:
    """Extract size variant swatches from product page markup."""
    selector = config.variant_swatch_selector
    if not selector:
        return []

    swatches: list[dict[str, Any]] = []
    seen: set[str] = set()

    try:
        nodes = page.css(selector)
    except Exception:
        return []

    for node in nodes:
        size = _attr_from_node(node, config.variant_size_attr, on_child=".swatch-value")
        if not size:
            size = _attr_from_node(node, config.variant_size_attr)
        if not size:
            size = (node.css(".swatch-value::text").get() or node.css(".size-value::text").get() or "").strip()
        if not size:
            continue

        sku = _attr_from_node(node, config.variant_sku_attr, on_child=".swatch-value")
        if not sku:
            sku = _attr_from_node(node, config.variant_sku_attr)

        available_raw = _attr_from_node(node, config.variant_available_attr, on_child=".swatch-value")
        if available_raw is None:
            available_raw = _attr_from_node(node, config.variant_available_attr)
        available: bool | None = None
        if available_raw is not None:
            available = str(available_raw).lower() in ("true", "1", "yes")

        variant_url = _attr_from_node(node, config.variant_url_attr)
        if not variant_url:
            variant_url = node.attrib.get("href")
        if variant_url and base_url:
            variant_url = urljoin(base_url, variant_url)
        elif variant_url and hasattr(page, "url") and page.url:
            variant_url = urljoin(page.url, variant_url)

        is_selected = bool(node.css(".selected, .is-selected, [class*='selected']").get())

        key = f"{size}|{sku or ''}"
        if key in seen:
            continue
        seen.add(key)

        swatches.append({
            "size": size,
            "sku": sku,
            "available": available,
            "variant_url": variant_url,
            "is_selected": is_selected,
        })

    return swatches


def reparse_html(
    html: str,
    url: str,
    site_config: SiteConfig,
    *,
    brand_name: str | None = None,
) -> dict[str, Any]:
    """Re-derive crawl record fields from stored product HTML."""
    from scrapling import Selector

    page = Selector(html, url=url)
    json_ld = extract_json_ld_blocks(page)
    text_content = extract_main_text(page, site_config)
    variant_swatches = extract_variant_swatches(page, site_config, base_url=url)
    return {
        "source_url": url,
        "json_ld": json_ld,
        "text_content": text_content[:50_000],
        "brand_name": brand_name,
        "variant_swatches": variant_swatches,
    }
