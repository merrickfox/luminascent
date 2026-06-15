"""Extract structured candle data from raw crawl records."""

from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any

import httpx

from timing import StageTimer, TimingAccumulator, log_timing

from schema import (
    build_extraction_schema,
    map_to_product_record,
    normalize_availability,
    normalize_wax_type,
    parse_price_to_minor_units,
    parse_size,
    slugify,
)


OLLAMA_URL = "http://localhost:11434/api/chat"
DEFAULT_MODEL = "qwen3-coder:30b"
MAX_TEXT_CHARS = 12_000
OLLAMA_NUM_CTX = 8192
OLLAMA_NUM_PREDICT = 2048

SYSTEM_PROMPT = """You extract structured candle product data from web page text.

Return only the fields in the JSON schema. Use null for unknown scalar fields.

NOTES: Extract individual fragrance raw materials or ingredients (e.g. "Bergamot", "Cypress Oil", "Patchouli"). Map pyramid labels: Top->top, Heart/Middle->middle, Base->base, unlabeled->general or unknown. Do NOT treat olfactive/fragrance family lines as notes.

SCENT SUMMARY: A short phrase describing the overall scent character (e.g. from "Olfactive Family: Woody Aromatic Pine" extract "Woody Aromatic Pine"). This is NOT the accord list.

ACCORDS: Broad fragrance families inferred from the copy (woody, vanilla, citrus, floral, gourmand, amber, smoky, spicy, fresh, etc.).

DESCRIPTION: Clean marketing copy in full sentences only. Exclude navigation, prices, SKUs, cart buttons, engraving UI, shipping promos, and "you may also like" sections.

SIZES: All variants with size_value, size_unit, size_grams, price_amount (minor units), price_currency, burn_time_hours, sku, availability, source_url, is_primary.

IMAGES: source_url, position (0-based), is_primary (true for first/main image).

burn_time_hours: integer hours per size variant.

wax_type: exactly one schema enum value, or null if not stated. Use blend for unspecified wax mixtures, other for uncommon types. Never invent prose.

vessel_material: glass, ceramic, tin, metal, concrete, porcelain, wood."""

LLM_ALWAYS_FIELDS = frozenset({"notes", "accords", "scent_summary", "title"})


def _flatten_json_ld(blocks: list[Any]) -> list[dict[str, Any]]:
    flat: list[dict[str, Any]] = []

    def walk(node: Any):
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


def _first_product_ld(blocks: list[Any]) -> dict[str, Any] | None:
    for node in _flatten_json_ld(blocks):
        node_type = node.get("@type", "")
        types = node_type if isinstance(node_type, list) else [node_type]
        types = [str(t).lower() for t in types]
        if "product" in types:
            return node
    return None


def _offer_from_product(product: dict[str, Any]) -> dict[str, Any]:
    offers = product.get("offers")
    if isinstance(offers, list) and offers:
        return offers[0]
    if isinstance(offers, dict):
        return offers
    return {}


def _image_urls_from_value(value: Any) -> list[str]:
    urls: list[str] = []
    if isinstance(value, str) and value.startswith("http"):
        urls.append(value)
    elif isinstance(value, dict):
        url = value.get("url") or value.get("contentUrl")
        if isinstance(url, str) and url.startswith("http"):
            urls.append(url)
    elif isinstance(value, list):
        for item in value:
            urls.extend(_image_urls_from_value(item))
    return urls


def extract_images_from_json_ld(product: dict[str, Any]) -> list[dict[str, Any]]:
    urls: list[str] = []
    seen: set[str] = set()
    for url in _image_urls_from_value(product.get("image")):
        if url not in seen:
            seen.add(url)
            urls.append(url)
    return [
        {"source_url": url, "position": i, "is_primary": i == 0}
        for i, url in enumerate(urls)
    ]


def _size_entry(
    *,
    raw_size: str | None,
    price: Any = None,
    currency: str | None = None,
    sku: str | None = None,
    availability: str | None = None,
    source_url: str | None = None,
    burn_time_hours: int | None = None,
    is_primary: bool = False,
) -> dict[str, Any] | None:
    if not raw_size and price is None and not sku:
        return None
    value, unit, grams = parse_size(raw_size)
    return {
        "size_value": value,
        "size_unit": unit,
        "size_grams": grams,
        "price_amount": parse_price_to_minor_units(price, currency),
        "price_currency": currency,
        "burn_time_hours": burn_time_hours,
        "sku": sku,
        "availability": normalize_availability(availability),
        "source_url": source_url,
        "is_primary": is_primary,
    }


def _variant_sources(product: dict[str, Any]) -> list[dict[str, Any]]:
    variants: list[dict[str, Any]] = []
    for key in ("isSimilarTo", "hasVariant", "model"):
        val = product.get(key)
        if isinstance(val, list):
            variants.extend(v for v in val if isinstance(v, dict))
        elif isinstance(val, dict):
            variants.append(val)
    return variants


def extract_sizes_from_json_ld(product: dict[str, Any], source_url: str) -> list[dict[str, Any]]:
    offer = _offer_from_product(product)
    currency = offer.get("priceCurrency")
    sizes: list[dict[str, Any]] = []
    seen_keys: set[str] = set()

    def add(entry: dict[str, Any] | None) -> None:
        if not entry:
            return
        key = f"{entry.get('size_value')}-{entry.get('size_unit')}-{entry.get('sku')}"
        if key in seen_keys:
            return
        seen_keys.add(key)
        sizes.append(entry)

    add(_size_entry(
        raw_size=product.get("size"),
        price=offer.get("price"),
        currency=currency,
        sku=product.get("sku"),
        availability=offer.get("availability"),
        source_url=offer.get("url") or source_url,
        is_primary=True,
    ))

    offers = product.get("offers")
    if isinstance(offers, list):
        for i, off in enumerate(offers):
            if isinstance(off, dict):
                add(_size_entry(
                    raw_size=off.get("size") or product.get("size"),
                    price=off.get("price"),
                    currency=off.get("priceCurrency") or currency,
                    sku=off.get("sku") or product.get("sku"),
                    availability=off.get("availability"),
                    source_url=off.get("url") or source_url,
                    is_primary=i == 0 and not sizes,
                ))

    for variant in _variant_sources(product):
        v_offer = variant.get("offers") if isinstance(variant.get("offers"), dict) else {}
        if not isinstance(v_offer, dict):
            v_offer = {}
        add(_size_entry(
            raw_size=variant.get("size"),
            price=v_offer.get("price") or variant.get("price"),
            currency=v_offer.get("priceCurrency") or currency,
            sku=variant.get("sku"),
            availability=v_offer.get("availability") or variant.get("availability"),
            source_url=variant.get("url") or source_url,
            is_primary=False,
        ))

    if sizes and not any(s.get("is_primary") for s in sizes):
        sizes[0]["is_primary"] = True
    return sizes


def extract_sizes_from_text(text: str, currency: str | None = None) -> list[dict[str, Any]]:
    sizes: list[dict[str, Any]] = []
    seen: set[str] = set()

    choose = re.search(r"choose your size\s*([\d./\s,gkozml]+)", text, re.I)
    if choose:
        for token in re.findall(r"(\d+)\s*(g|kg|oz|ml)\b", choose.group(1), re.I):
            key = f"{token[0]}{token[1].lower()}"
            if key not in seen:
                seen.add(key)
                value, unit, grams = parse_size(f"{token[0]}{token[1]}")
                sizes.append({
                    "size_value": value, "size_unit": unit, "size_grams": grams,
                    "price_amount": None, "price_currency": currency,
                    "burn_time_hours": None,
                    "sku": None, "availability": None, "source_url": None,
                    "is_primary": len(sizes) == 0,
                })

    if not sizes:
        for match in re.finditer(r"weight:\s*(\d+)\s*(g|oz)\b", text, re.I):
            key = match.group(0).lower()
            if key not in seen:
                seen.add(key)
                value, unit, grams = parse_size(match.group(0))
                sizes.append({
                    "size_value": value, "size_unit": unit, "size_grams": grams,
                    "price_amount": None, "price_currency": currency,
                    "burn_time_hours": None,
                    "sku": None, "availability": None, "source_url": None,
                    "is_primary": True,
                })
                break

    return sizes


def extract_variant_offer_data(record: dict[str, Any]) -> dict[str, Any]:
    json_ld_blocks = record.get("json_ld") or []
    text_content = record.get("text_content") or ""
    product = _first_product_ld(json_ld_blocks)
    if not product:
        return {
            "sku": record.get("variant_sku"),
            "size": record.get("variant_size"),
        }

    offer = _offer_from_product(product)
    combined = text_content or product.get("description") or ""
    return {
        "sku": product.get("sku") or record.get("variant_sku"),
        "size": record.get("variant_size") or product.get("size"),
        "price": offer.get("price"),
        "currency": offer.get("priceCurrency"),
        "availability": offer.get("availability"),
        "burn_time_hours": parse_burn_time_hours(combined),
        "source_url": offer.get("url") or record.get("source_url"),
    }


def extract_sizes_from_swatches(
    swatches: list[dict[str, Any]],
    *,
    variant_records: list[dict[str, Any]] | None = None,
    source_url: str,
    json_ld_sizes: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    if not swatches:
        return []

    variant_data_by_key: dict[str, dict[str, Any]] = {}
    for record in variant_records or []:
        data = extract_variant_offer_data(record)
        for key in (data.get("sku"), data.get("size")):
            if key:
                variant_data_by_key[str(key).lower()] = data

    sizes: list[dict[str, Any]] = []
    seen: set[str] = set()
    primary_assigned = False

    for swatch in swatches:
        raw_size = swatch.get("size")
        sku = swatch.get("sku")
        key = f"{raw_size}|{sku or ''}".lower()
        if key in seen:
            continue
        seen.add(key)

        variant_data = None
        if sku and str(sku).lower() in variant_data_by_key:
            variant_data = variant_data_by_key[str(sku).lower()]
        elif raw_size and str(raw_size).lower() in variant_data_by_key:
            variant_data = variant_data_by_key[str(raw_size).lower()]

        available = swatch.get("available")
        availability = None
        if available is True:
            availability = "InStock"
        elif available is False:
            availability = "OutOfStock"

        is_primary = bool(swatch.get("is_selected")) or not primary_assigned
        if is_primary:
            primary_assigned = True

        entry = _size_entry(
            raw_size=raw_size,
            price=variant_data.get("price") if variant_data else None,
            currency=variant_data.get("currency") if variant_data else None,
            sku=sku or (variant_data.get("sku") if variant_data else None),
            availability=variant_data.get("availability") if variant_data else availability,
            source_url=(variant_data.get("source_url") if variant_data else None) or swatch.get("variant_url") or source_url,
            burn_time_hours=variant_data.get("burn_time_hours") if variant_data else None,
            is_primary=is_primary,
        )
        if entry:
            sizes.append(entry)

    if json_ld_sizes:
        for ld_size in json_ld_sizes:
            ld_key = f"{ld_size.get('size_value')}{ld_size.get('size_unit')}|{ld_size.get('sku') or ''}".lower()
            matched = False
            for size in sizes:
                size_key = f"{size.get('size_value')}{size.get('size_unit')}|{size.get('sku') or ''}".lower()
                if size_key == ld_key or (ld_size.get("sku") and size.get("sku") == ld_size.get("sku")):
                    for field in ("price_amount", "price_currency", "availability", "burn_time_hours", "source_url"):
                        if size.get(field) is None and ld_size.get(field) is not None:
                            size[field] = ld_size[field]
                    matched = True
                    break
            if not matched and ld_size.get("size_grams"):
                sizes.append({**ld_size, "is_primary": not primary_assigned})
                if not primary_assigned:
                    primary_assigned = True

    if sizes and not any(s.get("is_primary") for s in sizes):
        sizes[0]["is_primary"] = True
    return sizes


def _fold_burn_time_into_sizes(sizes: list[dict[str, Any]], burn_time_hours: int | None) -> list[dict[str, Any]]:
    if burn_time_hours is None or not sizes:
        return sizes
    for size in sizes:
        if size.get("is_primary") and size.get("burn_time_hours") is None:
            size["burn_time_hours"] = burn_time_hours
            break
    else:
        if sizes[0].get("burn_time_hours") is None:
            sizes[0]["burn_time_hours"] = burn_time_hours
    return sizes


def group_raw_records(records: list[dict[str, Any]]) -> list[tuple[dict[str, Any], list[dict[str, Any]]]]:
    from link_discovery import product_key

    variants_by_parent: dict[str, list[dict[str, Any]]] = {}
    mains: list[dict[str, Any]] = []

    for record in records:
        parent = record.get("_variant_of")
        if parent:
            variants_by_parent.setdefault(parent, []).append(record)
        else:
            mains.append(record)

    grouped: list[tuple[dict[str, Any], list[dict[str, Any]]]] = []
    for main in mains:
        key = product_key(main.get("source_url", ""))
        grouped.append((main, variants_by_parent.pop(key, [])))

    for parent_key, orphans in variants_by_parent.items():
        if orphans:
            grouped.append((orphans[0], orphans[1:]))

    return grouped


def parse_burn_time_hours(text: str | None) -> int | None:
    if not text:
        return None
    match = re.search(
        r"(?:burn(?:ing)?\s*time|burns?\s+for|up\s+to)\s*:?\s*(?:up\s+to\s+)?(\d+)\s*(?:hours?|hrs?)\b",
        text, re.I,
    )
    if match:
        return int(match.group(1))
    return None


def parse_wax_type(text: str | None) -> str | None:
    if not text:
        return None
    patterns = [
        (r"coconut[\s-]+soy", "coconut-soy"),
        (r"coconut[\s-]+rapeseed", "coconut-rapeseed"),
        (r"soy\s+blend", "soy blend"),
        (r"wax\s+blend", "blend"),
        (r"vegetable\s+wax", "vegetable wax"),
        (r"mineral\s+wax", "mineral wax"),
        (r"soy\s+wax", "soy"),
        (r"paraffin\s+wax", "paraffin"),
        (r"beeswax", "beeswax"),
        (r"coconut\s+wax", "coconut"),
        (r"rapeseed\s+wax", "rapeseed"),
        (r"palm\s+wax", "palm"),
        (r"gel\s+wax", "gel"),
        (r"stearin", "stearin"),
        (r"bayberry", "bayberry"),
        (r"carnauba", "carnauba"),
        (r"tallow", "tallow"),
        (r"apricot\s+wax", "apricot"),
        (r"ceresin", "ceresin"),
    ]
    lower = text.lower()
    for pattern, label in patterns:
        if re.search(pattern, lower):
            return normalize_wax_type(label)
    return None


def parse_vessel_material(text: str | None) -> str | None:
    if not text:
        return None
    patterns = [
        (r"glass\s+jar", "glass"),
        (r"glass\s+vessel", "glass"),
        (r"in\s+a\s+glass", "glass"),
        (r"ceramic", "ceramic"),
        (r"porcelain", "porcelain"),
        (r"\btin\b", "tin"),
        (r"metal\s+(?:jar|tin|vessel)", "metal"),
        (r"concrete", "concrete"),
        (r"wooden?\s+(?:jar|vessel|box)", "wood"),
    ]
    lower = text.lower()
    for pattern, label in patterns:
        if re.search(pattern, lower):
            return label
    return None


def parse_scent_summary(text: str | None) -> str | None:
    if not text:
        return None
    match = re.search(r"olfactive\s+family:\s*([^\n.]+)", text, re.I)
    if match:
        return match.group(1).strip()
    return None


_UI_NOISE_MARKERS = (
    "add to cart",
    "choose your size",
    "add to wishlist",
    "go to wishlist",
    "type your letters",
    "you may also like",
    "engraving",
    "out of stock",
    "best seller",
    "limited edition",
    "take a look at the product on your smartphone",
    "images are illustrative only",
    "complimentary delivery",
    "free samples with purchase",
)


def _normalize_prose(text: str) -> str:
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def is_noisy_description(text: str | None) -> bool:
    if not text or len(text.strip()) < 40:
        return True
    lower = text.lower()
    if sum(1 for marker in _UI_NOISE_MARKERS if marker in lower) >= 2:
        return True
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if len(lines) >= 12:
        short_lines = sum(1 for line in lines if len(line) < 28)
        if short_lines / len(lines) >= 0.55:
            return True
    if re.search(r"£\s*\d|[$€]\s*\d|\bqty\b", lower):
        if "add to cart" in lower or "choose your size" in lower:
            return True
    return False


def extract_description_from_text(text: str | None) -> str | None:
    """Pull marketing copy from noisy full-page text."""
    if not text:
        return None

    parts: list[str] = []

    tagline_match = re.search(
        r"(?:^|\n)([A-Z][^\n]{40,}\.)\s*\n+More information\s*\n",
        text,
        re.I,
    )
    if tagline_match:
        tagline = _normalize_prose(tagline_match.group(1))
        if tagline and not is_noisy_description(tagline):
            parts.append(tagline)

    detail_match = re.search(
        r"More information\s*\n+(.+?)(?="
        r"\n(?:Dimensions|Weight|Burning time|Burn time|PACKAGING|IMPORTANT|"
        r"Tasting Notes|Ingredients|YOU MAY ALSO|YOUR UNBOXING)\s*:|\Z)",
        text,
        re.I | re.S,
    )
    if detail_match:
        detail = _normalize_prose(detail_match.group(1))
        if detail and not is_noisy_description(detail):
            parts.append(detail)

    if not parts:
        section_match = re.search(
            r"(?:Description|Product details|About (?:this|the) (?:product|candle))\s*\n+(.+?)(?="
            r"\n(?:Dimensions|Weight|Burning time|Burn time|PACKAGING|IMPORTANT|"
            r"Tasting Notes|Ingredients|YOU MAY ALSO)\s*:|\Z)",
            text,
            re.I | re.S,
        )
        if section_match:
            section = _normalize_prose(section_match.group(1))
            if section and not is_noisy_description(section):
                parts.append(section)

    if not parts:
        paragraphs: list[str] = []
        for block in re.split(r"\n{2,}", text):
            block = _normalize_prose(block)
            if len(block) < 80 or is_noisy_description(block):
                continue
            if block.count(".") >= 1 and len(block.split()) >= 12:
                paragraphs.append(block)
        if paragraphs:
            parts.append(max(paragraphs, key=len))

    if not parts:
        return None
    return _normalize_prose("\n\n".join(parts))


def pick_description(
    json_ld_data: dict[str, Any],
    llm_data: dict[str, Any],
    *,
    fallback_text: str | None = None,
) -> str | None:
    candidates: list[tuple[str, str]] = []
    for source, value in (
        ("json_ld", json_ld_data.get("description")),
        ("llm", llm_data.get("description")),
    ):
        if isinstance(value, str) and value.strip():
            candidates.append((source, value.strip()))

    clean = [(source, value) for source, value in candidates if not is_noisy_description(value)]
    if clean:
        return max(clean, key=lambda item: len(item[1]))[1]

    if fallback_text:
        extracted = extract_description_from_text(fallback_text)
        if extracted:
            return extracted

    for _, value in candidates:
        extracted = extract_description_from_text(value)
        if extracted:
            return extracted

    return candidates[0][1] if candidates else None


def parse_notes_accords_from_description(description: str | None) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    if not description:
        return [], []

    notes: list[dict[str, str]] = []
    accords: list[dict[str, str]] = []

    stage_map = {"top": "top", "heart": "middle", "middle": "middle", "base": "base"}

    inline = re.search(r"tasting\s+notes\s*:\s*([^\n]+)", description, re.I)
    if inline:
        for part in re.split(r",|\band\b", inline.group(1)):
            name = part.strip()
            if name and len(name) > 2:
                notes.append({"name": name, "pyramid_stage": "unknown"})

    if notes:
        return notes, accords

    for label in ("tasting notes", "notes", "fragrance notes", "olfactory notes"):
        match = re.search(rf"{label}\s*:?\s*(.+?)(?:\n[A-Z]|$)", description, re.I | re.S)
        if match:
            chunk = match.group(1)
            for stage_label, stage in stage_map.items():
                stage_match = re.search(rf"{stage_label}\s*:\s*([^.;]+)", chunk, re.I)
                if stage_match:
                    for part in re.split(r",|\band\b", stage_match.group(1)):
                        name = part.strip()
                        if name:
                            notes.append({"name": name, "pyramid_stage": stage})
            if not notes:
                for part in re.split(r",|\band\b", chunk):
                    name = re.sub(r"^[\d.]+\s*", "", part.strip())
                    if name and len(name) > 2:
                        notes.append({"name": name, "pyramid_stage": "unknown"})
            break

    accord_keywords = [
        "woody", "vanilla", "citrus", "floral", "gourmand", "amber", "smoky",
        "spicy", "fresh", "musky", "powdery", "fruity", "green", "balsamic",
        "leather", "aquatic", "aromatic", "sweet", "warm",
    ]
    lower = description.lower()
    for keyword in accord_keywords:
        if keyword in lower:
            accords.append({"name": keyword})

    family = parse_scent_summary(description)
    if family and not any(a["name"].lower() == family.lower() for a in accords):
        accords.insert(0, {"name": family})

    return notes, accords


def extract_from_json_ld(blocks: list[Any], source_url: str) -> dict[str, Any]:
    product = _first_product_ld(blocks)
    if not product:
        return {}

    offer = _offer_from_product(product)
    brand = product.get("brand")
    brand_name = brand.get("name") if isinstance(brand, dict) else (brand if isinstance(brand, str) else None)

    description = product.get("description")
    combined_text = description or ""

    sizes = extract_sizes_from_json_ld(product, source_url)
    images = extract_images_from_json_ld(product)

    return {
        "title": product.get("name"),
        "description": description,
        "scent_summary": parse_scent_summary(combined_text),
        "brand_name": brand_name,
        "notes": [],
        "accords": [],
        "sizes": sizes,
        "images": images,
        "wax_type": parse_wax_type(combined_text),
        "vessel_material": parse_vessel_material(combined_text),
        "burn_time_hours": parse_burn_time_hours(combined_text),
    }


def needs_llm_extraction(
    json_ld_data: dict[str, Any],
    text_content: str,
    *,
    force_llm: bool = False,
) -> bool:
    if force_llm:
        return bool(text_content.strip())
    if not json_ld_data.get("title") and not text_content.strip():
        return False
    if len(text_content.strip()) < 80:
        return False
    description = json_ld_data.get("description")
    if not description or is_noisy_description(description):
        if text_content.strip():
            return True
    if not json_ld_data.get("notes"):
        return True
    if not json_ld_data.get("sizes"):
        return True
    if not json_ld_data.get("burn_time_hours") and text_content:
        return True
    if not json_ld_data.get("wax_type") and text_content:
        return True
    return False


def llm_fields_for_data(json_ld_data: dict[str, Any]) -> set[str]:
    fields = set(LLM_ALWAYS_FIELDS)
    if not json_ld_data.get("sizes"):
        fields.add("sizes")
    if not json_ld_data.get("images"):
        fields.add("images")
    description = json_ld_data.get("description")
    if not description or is_noisy_description(description):
        fields.add("description")
    if not json_ld_data.get("wax_type"):
        fields.add("wax_type")
    if not json_ld_data.get("vessel_material"):
        fields.add("vessel_material")
    if not json_ld_data.get("burn_time_hours"):
        fields.add("burn_time_hours")
    return fields


def prep_text_for_llm(text: str, max_chars: int = MAX_TEXT_CHARS) -> str:
    lines = text.splitlines()
    collapsed: list[str] = []
    prev_stripped: str | None = None
    for line in lines:
        stripped = line.strip()
        if stripped and stripped == prev_stripped:
            continue
        collapsed.append(line)
        if stripped:
            prev_stripped = stripped
    return "\n".join(collapsed)[:max_chars]


def call_ollama(
    text_content: str,
    *,
    schema: dict[str, Any],
    model: str = DEFAULT_MODEL,
    ollama_url: str = OLLAMA_URL,
    audit: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    trimmed = prep_text_for_llm(text_content)
    user_content = f"Extract candle product fields from this page text:\n\n{trimmed}"
    payload = {
        "model": model,
        "stream": False,
        "options": {
            "temperature": 0,
            "num_ctx": OLLAMA_NUM_CTX,
            "num_predict": OLLAMA_NUM_PREDICT,
        },
        "format": schema,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
    }

    with httpx.Client(timeout=300.0) as client:
        response = client.post(ollama_url, json=payload)
        response.raise_for_status()
        data = response.json()

    content = data.get("message", {}).get("content", "{}")
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        parsed = {}

    if audit is not None:
        audit.append({
            "pass": "extract",
            "model": model,
            "ollama_url": ollama_url,
            "system_prompt": SYSTEM_PROMPT,
            "user_content": user_content,
            "schema": schema,
            "input_chars": len(text_content),
            "trimmed_chars": len(trimmed),
            "raw_response": content,
            "parsed": parsed,
        })

    return parsed


def _merge_sizes(
    json_ld: list[dict],
    llm: list[dict],
    *,
    swatches: list[dict[str, Any]] | None = None,
    variant_records: list[dict[str, Any]] | None = None,
    source_url: str = "",
    page_burn_time: int | None = None,
) -> list[dict]:
    if swatches:
        merged = extract_sizes_from_swatches(
            swatches,
            variant_records=variant_records,
            source_url=source_url,
            json_ld_sizes=json_ld or None,
        )
        if merged:
            return _fold_burn_time_into_sizes(merged, page_burn_time)

    if json_ld and len(json_ld) > 1:
        return _fold_burn_time_into_sizes(json_ld, page_burn_time)
    if json_ld:
        return _fold_burn_time_into_sizes(json_ld, page_burn_time)
    if llm:
        return _fold_burn_time_into_sizes(llm, page_burn_time)
    return []


def _merge_images(json_ld: list[dict], llm: list[dict]) -> list[dict]:
    if json_ld:
        return json_ld
    return llm or []


def merge_extractions(
    json_ld_data: dict[str, Any],
    llm_data: dict[str, Any],
    *,
    source_url: str,
    brand_name: str | None = None,
    brand_slug: str | None = None,
    used_llm: bool = False,
    variant_swatches: list[dict[str, Any]] | None = None,
    variant_records: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    description = pick_description(json_ld_data, llm_data)
    text_for_parse = description or json_ld_data.get("description") or llm_data.get("description") or ""

    title = json_ld_data.get("title") or llm_data.get("title")
    scent_summary = llm_data.get("scent_summary") or json_ld_data.get("scent_summary")
    wax_type = normalize_wax_type(
        json_ld_data.get("wax_type") or llm_data.get("wax_type") or parse_wax_type(text_for_parse)
    )
    vessel_material = json_ld_data.get("vessel_material") or llm_data.get("vessel_material") or parse_vessel_material(text_for_parse)
    page_burn_time = (
        json_ld_data.get("burn_time_hours")
        or llm_data.get("burn_time_hours")
        or parse_burn_time_hours(text_for_parse)
    )

    if llm_data.get("notes"):
        notes = llm_data["notes"]
    elif json_ld_data.get("notes"):
        notes = json_ld_data["notes"]
    else:
        notes, _ = parse_notes_accords_from_description(text_for_parse)

    if llm_data.get("accords"):
        accords = llm_data["accords"]
    elif json_ld_data.get("accords"):
        accords = json_ld_data["accords"]
    else:
        _, accords = parse_notes_accords_from_description(text_for_parse)

    sizes = _merge_sizes(
        json_ld_data.get("sizes") or [],
        llm_data.get("sizes") or [],
        swatches=variant_swatches,
        variant_records=variant_records,
        source_url=source_url,
        page_burn_time=page_burn_time,
    )
    if page_burn_time is not None:
        sizes = _fold_burn_time_into_sizes(sizes, page_burn_time)

    if llm_data.get("burn_time_hours") and sizes:
        for size in sizes:
            if size.get("burn_time_hours") is None and llm_data.get("sizes"):
                for llm_size in llm_data["sizes"]:
                    if (
                        llm_size.get("size_grams") == size.get("size_grams")
                        or llm_size.get("sku") == size.get("sku")
                    ) and llm_size.get("burn_time_hours") is not None:
                        size["burn_time_hours"] = llm_size["burn_time_hours"]
                        break

    images = _merge_images(json_ld_data.get("images") or [], llm_data.get("images") or [])

    resolved_brand = brand_name or json_ld_data.get("brand_name")

    return map_to_product_record(
        source_url=source_url,
        title=title,
        description=description,
        scent_summary=scent_summary,
        notes=notes,
        accords=accords,
        sizes=sizes,
        images=images,
        wax_type=wax_type,
        vessel_material=vessel_material,
        brand_name=resolved_brand,
        brand_slug=brand_slug or (slugify(resolved_brand) if resolved_brand else None),
        provenance={"json_ld": bool(json_ld_data), "llm": used_llm},
    )


def _reparse_record_from_html(
    record: dict[str, Any],
    pass_dir: Path,
    *,
    brand_name: str | None = None,
) -> dict[str, Any]:
    from sites import get_site_config
    from parsing import reparse_html

    html_file = record.get("html_file")
    if not html_file:
        return record
    html_path = pass_dir / html_file
    if not html_path.exists():
        return record
    source_url = record.get("source_url", "")
    site_config = get_site_config(source_url)
    reparsed = reparse_html(
        html_path.read_text(encoding="utf-8"),
        source_url,
        site_config,
        brand_name=brand_name or record.get("brand_name"),
    )
    merged = dict(record)
    merged.update(reparsed)
    merged["html_file"] = html_file
    return merged


def extract_raw_record(
    record: dict[str, Any],
    *,
    model: str = DEFAULT_MODEL,
    use_llm: bool = True,
    force_llm: bool = False,
    ollama_url: str = OLLAMA_URL,
    brand_name: str | None = None,
    brand_slug: str | None = None,
    pass_dir: Path | None = None,
    reparse_from_html: bool = False,
    variant_records: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    extract_started = time.perf_counter()
    timer = StageTimer()
    if reparse_from_html and pass_dir is not None:
        record = _reparse_record_from_html(record, pass_dir, brand_name=brand_name)
    source_url = record.get("source_url", "")
    json_ld_blocks = record.get("json_ld", [])
    text_content = record.get("text_content", "")

    with timer.stage("json_ld_seconds"):
        json_ld_data = extract_from_json_ld(json_ld_blocks, source_url)

    with timer.stage("text_heuristics_seconds"):
        variant_swatches = record.get("variant_swatches") or []
        if variant_swatches and not json_ld_data.get("sizes"):
            swatch_sizes = extract_sizes_from_swatches(
                variant_swatches,
                variant_records=variant_records,
                source_url=source_url,
            )
            if swatch_sizes:
                json_ld_data["sizes"] = swatch_sizes

        if not json_ld_data.get("sizes") and text_content:
            currency = None
            if json_ld_data.get("sizes"):
                currency = json_ld_data["sizes"][0].get("price_currency")
            text_sizes = extract_sizes_from_text(text_content, currency)
            if text_sizes:
                json_ld_data["sizes"] = text_sizes

        if not json_ld_data.get("burn_time_hours") and text_content:
            json_ld_data["burn_time_hours"] = parse_burn_time_hours(text_content)
        if not json_ld_data.get("wax_type") and text_content:
            json_ld_data["wax_type"] = parse_wax_type(text_content)
        if not json_ld_data.get("vessel_material") and text_content:
            json_ld_data["vessel_material"] = parse_vessel_material(text_content)
        if not json_ld_data.get("scent_summary") and text_content:
            json_ld_data["scent_summary"] = parse_scent_summary(text_content)
        if not json_ld_data.get("description") and text_content:
            json_ld_data["description"] = extract_description_from_text(text_content)
        elif is_noisy_description(json_ld_data.get("description")) and text_content:
            cleaned = extract_description_from_text(text_content)
            if cleaned:
                json_ld_data["description"] = cleaned

    llm_data: dict[str, Any] = {}
    used_llm = False
    llm_audit: list[dict[str, Any]] = []

    if use_llm and needs_llm_extraction(json_ld_data, text_content, force_llm=force_llm):
        try:
            with timer.stage("llm_seconds"):
                llm_schema = build_extraction_schema(llm_fields_for_data(json_ld_data))
                llm_data = call_ollama(
                    text_content,
                    schema=llm_schema,
                    model=model,
                    ollama_url=ollama_url,
                    audit=llm_audit,
                )
            used_llm = bool(llm_data)
        except Exception as exc:
            llm_data = {"_llm_error": str(exc)}
    else:
        timer.stages["llm_seconds"] = 0.0
    if "llm_seconds" not in timer.stages:
        timer.stages["llm_seconds"] = 0.0

    with timer.stage("merge_seconds"):
        product = merge_extractions(
            json_ld_data, llm_data,
            source_url=source_url,
            brand_name=brand_name or record.get("brand_name"),
            brand_slug=brand_slug or record.get("brand_slug"),
            used_llm=used_llm,
            variant_swatches=record.get("variant_swatches"),
            variant_records=variant_records,
        )
        if is_noisy_description(product.get("description")) and text_content:
            cleaned = pick_description(json_ld_data, llm_data, fallback_text=text_content)
            if cleaned:
                product["description"] = cleaned

    timer.set_total(time.perf_counter() - extract_started)
    extract_timing = timer.as_dict()
    extract_timing["used_llm"] = used_llm

    scrape_timing = (record.get("_timing") or {}).get("scrape")
    product["_timing"] = {
        "scrape": scrape_timing,
        "extract": extract_timing,
    }
    if scrape_timing and scrape_timing.get("total_seconds") is not None:
        product["_timing"]["total_seconds"] = round(
            scrape_timing["total_seconds"] + extract_timing["total_seconds"], 3
        )

    if llm_data.get("_llm_error"):
        product["_llm_error"] = llm_data["_llm_error"]
    product["_llm_audit"] = llm_audit
    return product


def _product_for_output(product: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in product.items() if key != "_llm_audit"}


def _persist_llm_audit(pass_dir: Path, product: dict[str, Any], *, source_url: str = "") -> None:
    from link_discovery import product_key
    from state import write_llm_audit

    url = source_url or product.get("source_url") or ""
    if not url:
        return
    write_llm_audit(pass_dir, product_key(url), product.get("_llm_audit") or [])


def extract_from_html_file(
    html_path: Path,
    *,
    source_url: str = "file://local",
    model: str = DEFAULT_MODEL,
    use_llm: bool = True,
    force_llm: bool = False,
    brand_name: str | None = None,
    brand_slug: str | None = None,
) -> dict[str, Any]:
    from sites import get_site_config
    from parsing import reparse_html

    site_config = get_site_config(source_url)
    record = reparse_html(
        html_path.read_text(encoding="utf-8"),
        source_url,
        site_config,
        brand_name=brand_name,
    )
    record["brand_slug"] = brand_slug
    return extract_raw_record(
        record,
        model=model,
        use_llm=use_llm,
        force_llm=force_llm,
        brand_name=brand_name,
        brand_slug=brand_slug,
    )


def run_extract(
    raw_path: Path,
    output_path: Path,
    *,
    model: str = DEFAULT_MODEL,
    use_llm: bool = True,
    force_llm: bool = False,
    use_colors: bool = True,
    brand_name: str | None = None,
    brand_slug: str | None = None,
    skip_keys: set[str] | None = None,
    on_failure: Any = None,
    pass_dir: Path | None = None,
    reparse_from_html: bool = False,
    ollama_url: str = OLLAMA_URL,
) -> list[dict[str, Any]]:
    from link_discovery import product_key

    if not raw_path.exists():
        raise FileNotFoundError(f"Raw data not found: {raw_path}")

    records: list[dict[str, Any]] = []
    with raw_path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))

    grouped = group_raw_records(records)
    results: list[dict[str, Any]] = []
    output_path.parent.mkdir(parents=True, exist_ok=True)
    skip = skip_keys or set()
    extract_totals = TimingAccumulator()
    llm_used_count = 0
    extract_started = time.perf_counter()

    mode = "a" if output_path.exists() and skip else "w"
    with output_path.open(mode, encoding="utf-8") as out:
        for i, (record, variant_records) in enumerate(grouped, 1):
            key = product_key(record.get("source_url", ""))
            if key in skip:
                continue
            print(f"Extracting {i}/{len(grouped)}: {record.get('source_url', '')}")
            try:
                product = extract_raw_record(
                    record,
                    model=model,
                    use_llm=use_llm,
                    force_llm=force_llm,
                    brand_name=brand_name,
                    brand_slug=brand_slug,
                    pass_dir=pass_dir,
                    reparse_from_html=reparse_from_html,
                    variant_records=variant_records,
                )
                if not product.get("name"):
                    if on_failure:
                        on_failure(url=record.get("source_url", ""), stage="extract", reason="no product name extracted")
                    continue
                extract_timing = (product.get("_timing") or {}).get("extract", {})
                extract_totals.add(extract_timing)
                if extract_timing.get("used_llm"):
                    llm_used_count += 1
                label = (product.get("name") or record.get("source_url", ""))[:48]
                log_timing(
                    "extract",
                    label,
                    extract_timing,
                    keys=["json_ld_seconds", "text_heuristics_seconds", "llm_seconds", "merge_seconds", "total_seconds"],
                )
                if pass_dir is not None:
                    _persist_llm_audit(pass_dir, product, source_url=record.get("source_url", ""))
                results.append(product)
                out.write(json.dumps(_product_for_output(product), ensure_ascii=False) + "\n")
            except Exception as exc:
                if on_failure:
                    from state import format_exception

                    on_failure(
                        url=record.get("source_url", ""),
                        stage="extract",
                        **format_exception(exc),
                    )
                print(f"  extract failed: {exc}")

    if use_colors and results:
        from colors import stamp_colors_on_products

        color_started = time.perf_counter()
        try:
            stamp_colors_on_products(results, model=model, ollama_url=ollama_url)
            if pass_dir is not None:
                for product in results:
                    _persist_llm_audit(pass_dir, product)
            with output_path.open("w", encoding="utf-8") as out:
                for product in results:
                    out.write(json.dumps(_product_for_output(product), ensure_ascii=False) + "\n")
        except Exception as exc:
            print(f"  color generation failed: {exc}")

        color_elapsed = round(time.perf_counter() - color_started, 3)
        extract_summary_colors = {"colors_seconds": color_elapsed}
        print(f"  colors: {len(results)} products in {color_elapsed}s")

    extract_summary = extract_totals.summary()
    extract_summary["llm_used"] = llm_used_count
    extract_summary["extract_elapsed_seconds"] = round(time.perf_counter() - extract_started, 3)
    if use_colors and results:
        extract_summary.update(extract_summary_colors)
    log_timing(
        "extract total",
        f"{extract_summary.get('items', 0)} products ({llm_used_count} used LLM)",
        {
            **extract_summary,
            "total_seconds": extract_summary.get("extract_elapsed_seconds", 0),
        },
        keys=["json_ld_seconds", "text_heuristics_seconds", "llm_seconds", "merge_seconds", "total_seconds"],
    )
    print(f"Wrote {len(results)} products to {output_path}")
    return results, extract_summary


def run_extract_targeted(
    raw_path: Path,
    *,
    target_keys: set[str],
    model: str = DEFAULT_MODEL,
    use_llm: bool = True,
    force_llm: bool = True,
    use_colors: bool = True,
    brand_name: str | None = None,
    brand_slug: str | None = None,
    on_failure: Any = None,
    pass_dir: Path | None = None,
    reparse_from_html: bool = True,
    ollama_url: str = OLLAMA_URL,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    from link_discovery import product_key

    if not raw_path.exists():
        raise FileNotFoundError(f"Raw data not found: {raw_path}")
    if not target_keys:
        return [], {}

    records: list[dict[str, Any]] = []
    with raw_path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))

    grouped = group_raw_records(records)
    targets = [(record, variant_records) for record, variant_records in grouped
               if product_key(record.get("source_url", "")) in target_keys]

    results: list[dict[str, Any]] = []
    extract_totals = TimingAccumulator()
    llm_used_count = 0
    extract_started = time.perf_counter()

    for i, (record, variant_records) in enumerate(targets, 1):
        print(f"Re-extracting {i}/{len(targets)}: {record.get('source_url', '')}")
        try:
            product = extract_raw_record(
                record,
                model=model,
                use_llm=use_llm,
                force_llm=force_llm,
                brand_name=brand_name,
                brand_slug=brand_slug,
                pass_dir=pass_dir,
                reparse_from_html=reparse_from_html,
                variant_records=variant_records,
            )
            if not product.get("name"):
                if on_failure:
                    on_failure(url=record.get("source_url", ""), stage="extract", reason="no product name extracted")
                continue
            extract_timing = (product.get("_timing") or {}).get("extract", {})
            extract_totals.add(extract_timing)
            if extract_timing.get("used_llm"):
                llm_used_count += 1
            label = (product.get("name") or record.get("source_url", ""))[:48]
            log_timing(
                "extract",
                label,
                extract_timing,
                keys=["json_ld_seconds", "text_heuristics_seconds", "llm_seconds", "merge_seconds", "total_seconds"],
            )
            if pass_dir is not None:
                _persist_llm_audit(pass_dir, product, source_url=record.get("source_url", ""))
            results.append(product)
        except Exception as exc:
            if on_failure:
                from state import format_exception

                on_failure(
                    url=record.get("source_url", ""),
                    stage="extract",
                    **format_exception(exc),
                )
            print(f"  extract failed: {exc}")

    extract_summary_colors: dict[str, Any] = {}
    if use_colors and results:
        from colors import stamp_colors_on_products

        color_started = time.perf_counter()
        try:
            stamp_colors_on_products(results, model=model, ollama_url=ollama_url)
            if pass_dir is not None:
                for product in results:
                    _persist_llm_audit(pass_dir, product)
        except Exception as exc:
            print(f"  color generation failed: {exc}")

        color_elapsed = round(time.perf_counter() - color_started, 3)
        extract_summary_colors = {"colors_seconds": color_elapsed}
        print(f"  colors: {len(results)} products in {color_elapsed}s")

    extract_summary = extract_totals.summary()
    extract_summary["llm_used"] = llm_used_count
    extract_summary["extract_elapsed_seconds"] = round(time.perf_counter() - extract_started, 3)
    if extract_summary_colors:
        extract_summary.update(extract_summary_colors)
    log_timing(
        "extract targeted",
        f"{extract_summary.get('items', 0)} products ({llm_used_count} used LLM)",
        {
            **extract_summary,
            "total_seconds": extract_summary.get("extract_elapsed_seconds", 0),
        },
        keys=["json_ld_seconds", "text_heuristics_seconds", "llm_seconds", "merge_seconds", "total_seconds"],
    )
    print(f"Re-extracted {len(results)} products")
    return results, extract_summary
