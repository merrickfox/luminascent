"""Extract structured product data from JSON-LD in HTML."""

from __future__ import annotations

import html
import json
import re
from typing import Any


def parse_json_ld_blocks(html_text: str) -> list[Any]:
    blocks: list[Any] = []
    for match in re.finditer(
        r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        html_text,
        re.I | re.S,
    ):
        raw = match.group(1).strip()
        if not raw:
            continue
        try:
            blocks.append(json.loads(raw))
        except json.JSONDecodeError:
            continue
    return blocks


def _flatten_json_ld(blocks: list[Any]) -> list[dict[str, Any]]:
    flat: list[dict[str, Any]] = []

    def walk(node: Any) -> None:
        if isinstance(node, list):
            for item in node:
                walk(item)
        elif isinstance(node, dict):
            flat.append(node)
            for value in node.values():
                if isinstance(value, (list, dict)):
                    walk(value)

    walk(blocks)
    return flat


def first_product_ld(blocks: list[Any]) -> dict[str, Any] | None:
    for node in _flatten_json_ld(blocks):
        node_type = node.get("@type", "")
        types = node_type if isinstance(node_type, list) else [node_type]
        if any(str(t).lower() == "product" for t in types):
            return node
    return None


def offer_from_product(product: dict[str, Any]) -> dict[str, Any]:
    offers = product.get("offers")
    if isinstance(offers, list) and offers:
        return offers[0] if isinstance(offers[0], dict) else {}
    if isinstance(offers, dict):
        return offers
    return {}


def parse_price_to_minor_units(price: Any, currency: str | None = None) -> int | None:
    if price is None:
        return None
    try:
        return int(round(float(str(price).replace(",", "")) * 100))
    except ValueError:
        return None


def normalize_availability(value: str | None) -> str | None:
    if not value:
        return None
    lower = value.lower()
    if "instock" in lower or "in stock" in lower:
        return "InStock"
    if "outofstock" in lower or "out of stock" in lower:
        return "OutOfStock"
    return value.split("/")[-1] if "/" in value else value


def image_urls_from_value(value: Any) -> list[str]:
    urls: list[str] = []
    if isinstance(value, str) and value.startswith("http"):
        urls.append(value)
    elif isinstance(value, dict):
        url = value.get("url") or value.get("contentUrl")
        if isinstance(url, str) and url.startswith("http"):
            urls.append(url)
    elif isinstance(value, list):
        for item in value:
            urls.extend(image_urls_from_value(item))
    return urls


def extract_images(product: dict[str, Any]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    urls: list[str] = []
    for url in image_urls_from_value(product.get("image")):
        if url not in seen:
            seen.add(url)
            urls.append(url)
    return [
        {"source_url": url, "position": i, "is_primary": i == 0}
        for i, url in enumerate(urls)
    ]


def extract_sizes(product: dict[str, Any], source_url: str) -> list[dict[str, Any]]:
    offer = offer_from_product(product)
    currency = offer.get("priceCurrency")
    availability = normalize_availability(offer.get("availability"))
    price_amount = parse_price_to_minor_units(offer.get("price"), currency)
    if not (price_amount or product.get("sku") or offer.get("url")):
        return []
    return [{
        "size_value": None,
        "size_unit": None,
        "size_grams": None,
        "price_amount": price_amount,
        "price_currency": currency,
        "burn_time_hours": None,
        "sku": product.get("sku"),
        "availability": availability,
        "source_url": offer.get("url") or source_url,
        "is_primary": True,
    }]


def clean_text(value: str | None) -> str | None:
    if not value:
        return None
    text = html.unescape(str(value))
    text = re.sub(r"\s+", " ", text).strip()
    return text or None


def extract_product_data(html_text: str, source_url: str) -> dict[str, Any]:
    blocks = parse_json_ld_blocks(html_text)
    product = first_product_ld(blocks)
    if not product:
        return {}

    offer = offer_from_product(product)
    brand = product.get("brand")
    brand_name = brand.get("name") if isinstance(brand, dict) else (brand if isinstance(brand, str) else None)
    description = clean_text(product.get("description"))

    return {
        "name": clean_text(product.get("name")),
        "description": description,
        "brand_name": brand_name,
        "sizes": extract_sizes(product, source_url),
        "images": extract_images(product),
        "notes": [],
        "accords": [],
        "scent_summary": None,
        "wax_type": None,
        "vessel_material": None,
    }
