"""JSON schemas and mapping to the backend product shape."""

from __future__ import annotations

import re
from typing import Any

WAX_TYPES = [
    "soy",
    "paraffin",
    "beeswax",
    "coconut",
    "rapeseed",
    "palm",
    "vegetable wax",
    "gel",
    "mineral wax",
    "stearin",
    "bayberry",
    "carnauba",
    "tallow",
    "apricot",
    "ceresin",
    "coconut-soy",
    "coconut-rapeseed",
    "soy blend",
    "blend",
    "other",
]

WAX_TYPE_SET = frozenset(WAX_TYPES)


def normalize_wax_type(value: str | None) -> str | None:
    if value is None:
        return None
    if value in WAX_TYPE_SET:
        return value
    return "other"


SIZE_SCHEMA = {
    "type": "object",
    "properties": {
        "size_value": {"type": ["number", "null"]},
        "size_unit": {"type": ["string", "null"]},
        "size_grams": {"type": ["integer", "null"]},
        "price_amount": {"type": ["integer", "null"]},
        "price_currency": {"type": ["string", "null"]},
        "burn_time_hours": {"type": ["integer", "null"]},
        "sku": {"type": ["string", "null"]},
        "availability": {"type": ["string", "null"]},
        "source_url": {"type": ["string", "null"]},
        "is_primary": {"type": "boolean"},
    },
    "required": [
        "size_value", "size_unit", "size_grams", "price_amount", "price_currency",
        "burn_time_hours", "sku", "availability", "source_url", "is_primary",
    ],
}

EXTRACTION_FIELD_PROPERTIES: dict[str, Any] = {
    "title": {"type": ["string", "null"]},
    "description": {"type": ["string", "null"]},
    "scent_summary": {"type": ["string", "null"]},
    "wax_type": {"type": ["string", "null"], "enum": [*WAX_TYPES, None]},
    "vessel_material": {"type": ["string", "null"]},
    "burn_time_hours": {"type": ["integer", "null"]},
    "notes": {
        "type": "array",
        "items": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "pyramid_stage": {
                    "type": "string",
                    "enum": ["top", "middle", "base", "general", "unknown"],
                },
            },
            "required": ["name", "pyramid_stage"],
        },
    },
    "accords": {
        "type": "array",
        "items": {
            "type": "object",
            "properties": {"name": {"type": "string"}},
            "required": ["name"],
        },
    },
    "sizes": {
        "type": "array",
        "items": SIZE_SCHEMA,
    },
    "images": {
        "type": "array",
        "items": {
            "type": "object",
            "properties": {
                "source_url": {"type": "string"},
                "position": {"type": "integer"},
                "is_primary": {"type": "boolean"},
            },
            "required": ["source_url", "position", "is_primary"],
        },
    },
}

ALL_EXTRACTION_FIELDS = frozenset(EXTRACTION_FIELD_PROPERTIES)


def build_extraction_schema(fields: set[str]) -> dict[str, Any]:
    requested = sorted(f for f in fields if f in EXTRACTION_FIELD_PROPERTIES)
    if not requested:
        requested = sorted(ALL_EXTRACTION_FIELDS)
    properties = {name: EXTRACTION_FIELD_PROPERTIES[name] for name in requested}
    return {
        "type": "object",
        "properties": properties,
        "required": requested,
    }


EXTRACTION_JSON_SCHEMA: dict[str, Any] = build_extraction_schema(set(ALL_EXTRACTION_FIELDS))


def slugify(value: str) -> str:
    slug = value.lower().strip()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    return slug.strip("-")


def parse_price_to_minor_units(price: str | float | int | None, currency: str | None = None) -> int | None:
    if price is None:
        return None
    if isinstance(price, (int, float)):
        if isinstance(price, int) and price > 100 and currency:
            return price
        return int(round(float(price) * 100))
    text = str(price).strip()
    text = re.sub(r"[^\d.,]", "", text)
    if not text:
        return None
    if "," in text and "." in text:
        if text.rfind(",") > text.rfind("."):
            text = text.replace(".", "").replace(",", ".")
        else:
            text = text.replace(",", "")
    elif "," in text:
        parts = text.split(",")
        text = parts[0] + "." + parts[1] if len(parts) == 2 and len(parts[1]) == 2 else text.replace(",", "")
    try:
        return int(round(float(text) * 100))
    except ValueError:
        return None


def parse_size(raw: str | int | float | None) -> tuple[float | None, str | None, int | None]:
    if raw is None:
        return None, None, None
    text = str(raw).strip().lower()
    if not text:
        return None, None, None

    match = re.search(r"([\d.]+)\s*(g|kg|oz|ml|lb|lbs)\b", text, re.I)
    if not match:
        match = re.search(r"([\d.]+)\s*(g|kg|oz|ml|lb|lbs)", text, re.I)
    if not match:
        return None, None, None

    value = float(match.group(1))
    unit = match.group(2).lower()
    if unit == "lbs":
        unit = "lb"

    grams: int | None = None
    if unit == "g":
        grams = int(round(value))
    elif unit == "kg":
        grams = int(round(value * 1000))
    elif unit == "oz":
        grams = int(round(value * 28.3495))
    elif unit == "lb":
        grams = int(round(value * 453.592))

    return value, unit, grams


def parse_size_grams_from_title(title: str | None) -> int | None:
    if not title:
        return None
    _, _, grams = parse_size(title)
    return grams


def normalize_availability(value: str | None) -> str | None:
    if not value:
        return None
    lower = value.lower()
    if "instock" in lower or "in stock" in lower:
        return "InStock"
    if "outofstock" in lower or "out of stock" in lower:
        return "OutOfStock"
    return value


def _primary_size(sizes: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not sizes:
        return None
    for s in sizes:
        if s.get("is_primary"):
            return s
    return sizes[0]


def map_to_product_record(
    *,
    source_url: str,
    title: str | None = None,
    description: str | None = None,
    scent_summary: str | None = None,
    notes: list[dict[str, str]] | None = None,
    accords: list[dict[str, str]] | None = None,
    sizes: list[dict[str, Any]] | None = None,
    images: list[dict[str, Any]] | None = None,
    wax_type: str | None = None,
    vessel_material: str | None = None,
    brand_name: str | None = None,
    brand_slug: str | None = None,
    release_year: int | None = None,
    is_discontinued: bool = False,
    provenance: dict[str, bool] | None = None,
) -> dict[str, Any]:
    name = (title or "").strip() or None
    size_list = sizes or []

    record: dict[str, Any] = {
        "source_url": source_url,
        "category_slug": "candle",
        "brand_name": brand_name,
        "brand_slug": brand_slug or (slugify(brand_name) if brand_name else None),
        "name": name,
        "slug": slugify(name) if name else None,
        "description": (description or "").strip() or None,
        "scent_summary": (scent_summary or "").strip() or None,
        "release_year": release_year,
        "wax_type": wax_type,
        "vessel_material": vessel_material,
        "is_discontinued": is_discontinued,
        "sizes": size_list,
        "images": images or [],
        "notes": [
            {
                "note_slug": slugify(n["name"]),
                "name": n["name"],
                "pyramid_stage": n.get("pyramid_stage", "unknown"),
                **({"color": n["color"]} if n.get("color") else {}),
                **({"color_gradient": n["color_gradient"]} if n.get("color_gradient") else {}),
            }
            for n in (notes or [])
            if n.get("name")
        ],
        "accords": [
            {
                "accord_slug": slugify(a["name"]),
                "name": a["name"],
                **({"color": a["color"]} if a.get("color") else {}),
                **({"color_gradient": a["color_gradient"]} if a.get("color_gradient") else {}),
            }
            for a in (accords or [])
            if a.get("name")
        ],
        "_provenance": provenance or {"json_ld": False, "llm": False},
    }
    return record
