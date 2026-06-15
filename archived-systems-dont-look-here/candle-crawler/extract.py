"""LLM extraction using crawl4ai LLMExtractionStrategy."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from crawl4ai import LLMConfig, LLMExtractionStrategy

from audit import RunPaths, log_failure, write_llm_audit
from fetch import fit_markdown_from_result
from json_ld import extract_product_data
from models import CandleProduct, parse_extracted_product
from utils import append_jsonl, log_stage, product_key


DEFAULT_MODEL = "ollama/qwen3:8b"
DEFAULT_OLLAMA_BASE = "http://localhost:11434"

EXTRACTION_INSTRUCTION = """Extract structured candle product data from this page.

Return one product object with these rules:
- category_slug must be "candle" unless clearly not a candle product
- name is the product title
- description is clean marketing copy only (no nav, cart, shipping promos)
- scent_summary is a short phrase for overall scent character
- notes are individual fragrance materials with pyramid_stage (top/middle/base/general/unknown)
- accords are broad fragrance families (woody, vanilla, citrus, floral, gourmand, etc.)
- sizes include price_amount in minor units (cents/pence), price_currency, burn_time_hours, sku, availability, source_url, is_primary
- images include source_url, position (0-based), is_primary
- wax_type must be one of: soy, paraffin, beeswax, coconut, rapeseed, palm, vegetable wax, gel, mineral wax, stearin, bayberry, carnauba, tallow, apricot, ceresin, coconut-soy, coconut-rapeseed, soy blend, blend, other, or null
- vessel_material examples: glass, ceramic, tin, metal, concrete, porcelain, wood
- use null for unknown scalar fields
- if this page is not a candle product, still return best-effort fields with nulls where unknown
"""


def build_llm_config(model: str, ollama_base_url: str) -> LLMConfig:
    if model.startswith("ollama/"):
        return LLMConfig(
            provider=model,
            base_url=ollama_base_url,
            temperature=0.0,
        )
    return LLMConfig(provider=model, temperature=0.0)


def build_extraction_strategy(llm_config: LLMConfig) -> LLMExtractionStrategy:
    return LLMExtractionStrategy(
        llm_config=llm_config,
        schema=CandleProduct.model_json_schema(),
        extraction_type="schema",
        instruction=EXTRACTION_INSTRUCTION,
        input_format="html",
        apply_chunking=False,
        verbose=False,
        extra_args={"temperature": 0.0, "max_tokens": 4096},
    )


def block_to_payload(blocks: list[dict[str, Any]] | None) -> dict[str, Any] | list[Any] | None:
    if not blocks:
        return None
    first = blocks[0]
    if first.get("error"):
        return None
    if "content" in first and isinstance(first["content"], str):
        try:
            return json.loads(first["content"])
        except json.JSONDecodeError:
            return None
    return first


async def extract_from_html(
    strategy: LLMExtractionStrategy,
    *,
    url: str,
    html: str,
    markdown: str,
    brand_name: str | None,
    brand_slug: str | None,
) -> tuple[CandleProduct | None, dict[str, Any]]:
    blocks = await strategy.aextract(url=url, ix=0, html=html)
    parsed = block_to_payload(blocks)
    product = parse_extracted_product(
        parsed or {},
        source_url=url,
        brand_name=brand_name,
        brand_slug=brand_slug,
    )

    usage = {
        "usages": [
            {
                "completion_tokens": u.completion_tokens,
                "prompt_tokens": u.prompt_tokens,
                "total_tokens": u.total_tokens,
            }
            for u in (getattr(strategy, "usages", []) or [])
        ],
        "total_usage": {
            "completion_tokens": getattr(getattr(strategy, "total_usage", None), "completion_tokens", 0),
            "prompt_tokens": getattr(getattr(strategy, "total_usage", None), "prompt_tokens", 0),
            "total_tokens": getattr(getattr(strategy, "total_usage", None), "total_tokens", 0),
        },
    }
    audit = {
        "url": url,
        "instruction": EXTRACTION_INSTRUCTION,
        "schema": CandleProduct.model_json_schema(),
        "input_format": "html",
        "input_text": markdown,
        "blocks": blocks,
        "parsed": parsed,
        "usage": usage,
    }
    return product, audit


async def extract_from_result(
    result,
    strategy: LLMExtractionStrategy,
    *,
    brand_name: str | None,
    brand_slug: str | None,
) -> tuple[CandleProduct | None, dict[str, Any]]:
    html = result.html or ""
    markdown = fit_markdown_from_result(result)
    json_ld_data = extract_product_data(html, result.url)
    if json_ld_data.get("name"):
        merged = {**json_ld_data, "source_url": result.url}
        product = parse_extracted_product(
            merged,
            source_url=result.url,
            brand_name=brand_name,
            brand_slug=brand_slug,
        )
        if product is not None:
            audit = {
                "url": result.url,
                "technique": "json_ld",
                "json_ld_data": json_ld_data,
                "input_text": markdown[:5000],
            }
            return product, audit

    return await extract_from_html(
        strategy,
        url=result.url,
        html=html,
        markdown=markdown,
        brand_name=brand_name,
        brand_slug=brand_slug,
    )


async def extract_results(
    paths: RunPaths,
    site_name: str,
    results: list[Any],
    *,
    brand_name: str | None,
    brand_slug: str | None,
    model: str,
    ollama_base_url: str,
    raw_products_path: Path,
    skip_keys: set[str] | None = None,
) -> list[dict[str, Any]]:
    llm_config = build_llm_config(model, ollama_base_url)
    strategy = build_extraction_strategy(llm_config)
    products: list[dict[str, Any]] = []
    skip = skip_keys or set()

    for index, result in enumerate(results, 1):
        key = product_key(result.url)
        if key in skip:
            continue
        short = (result.url.rsplit("/", 1)[-1][:48]) or result.url
        log_stage(f"  Extract [{index}/{len(results)}]: {short}")
        try:
            product, audit = await extract_from_result(
                result,
                strategy,
                brand_name=brand_name,
                brand_slug=brand_slug,
            )
            write_llm_audit(paths, site_name, url=result.url, audit=audit)
            if product is None:
                log_failure(
                    paths,
                    site_name,
                    url=result.url,
                    stage="extract",
                    reason="no product name extracted",
                )
                continue
            provenance = {"json_ld": audit.get("technique") == "json_ld", "llm": audit.get("technique") != "json_ld"}
            record = product.to_import_record(provenance=provenance)
            append_jsonl(raw_products_path, record)
            products.append(record)
            log_stage(f"  Extract ok: {product.name}")
        except Exception as exc:
            log_failure(
                paths,
                site_name,
                url=result.url,
                stage="extract",
                reason=str(exc),
            )

    return products
