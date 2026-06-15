"""Generate display colors for fragrance notes and accords via Ollama."""

from __future__ import annotations

import hashlib
import json
from typing import Any

import httpx

OLLAMA_URL = "http://localhost:11434/api/chat"
DEFAULT_MODEL = "qwen3-coder:30b"

COLOR_SCHEMA = {
    "type": "object",
    "properties": {
        "color": {
            "type": "string",
            "description": "Solid hex color e.g. #c47a4a",
        },
        "color_gradient": {
            "type": ["string", "null"],
            "description": "Optional CSS linear-gradient string, or null",
        },
    },
    "required": ["color", "color_gradient"],
}

NOTE_PROMPT = """You assign a display color to a fragrance note (raw material/ingredient). Think: "If this smell was a color, what would it be?"

Return JSON with:
- color: solid hex (#rrggbb) evoking the note visually
- color_gradient: optional CSS linear-gradient, or null

Muted, sophisticated tones suitable for a luxury fragrance catalog."""

ACCORD_PROMPT = """You assign a display color to a fragrance accord (olfactive family like woody, vanilla, citrus). Think: "If this smell was a color, what would it be?"

Return JSON with:
- color: solid hex (#rrggbb)
- color_gradient: optional CSS linear-gradient, or null

Muted, sophisticated tones suitable for a luxury fragrance catalog."""

_session_cache: dict[tuple[str, str, str], dict[str, str | None]] = {}


def _normalize_hex(color: str) -> str | None:
    color = color.strip()
    if not color.startswith("#"):
        color = f"#{color}"
    if len(color) == 7 and all(c in "0123456789abcdefABCDEF#" for c in color[1:]):
        return color.lower()
    return None


def _fallback_color(name: str) -> str:
    digest = hashlib.md5(name.encode()).hexdigest()
    r = int(digest[0:2], 16) // 2 + 80
    g = int(digest[2:4], 16) // 2 + 80
    b = int(digest[4:6], 16) // 2 + 80
    return f"#{r:02x}{g:02x}{b:02x}"


def get_color(
    name: str,
    kind: str,
    *,
    model: str = DEFAULT_MODEL,
    ollama_url: str = OLLAMA_URL,
    max_retries: int = 2,
    audit: list[dict[str, Any]] | None = None,
) -> dict[str, str | None]:
    """Ask the LLM for a color for this name. No name matching — we already know the name."""
    cache_key = (kind, model, name)
    if cache_key in _session_cache:
        cached = _session_cache[cache_key]
        if audit is not None:
            audit.append({
                "pass": "color",
                "kind": kind,
                "name": name,
                "cached": True,
                "model": model,
                "parsed": cached,
            })
        return cached

    system_prompt = NOTE_PROMPT if kind == "note" else ACCORD_PROMPT
    user_content = f'What color should represent "{name}"?'
    payload = {
        "model": model,
        "stream": False,
        "options": {"temperature": 0, "num_ctx": 2048, "num_predict": 256},
        "format": COLOR_SCHEMA,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
    }

    result: dict[str, str | None] | None = None
    raw_response: str | None = None
    parsed_response: dict[str, Any] | None = None
    for _ in range(max_retries + 1):
        try:
            with httpx.Client(timeout=60.0) as client:
                response = client.post(ollama_url, json=payload)
                response.raise_for_status()
                raw_response = response.json().get("message", {}).get("content", "{}")
            parsed_response = json.loads(raw_response)
            color = _normalize_hex(parsed_response.get("color") or "")
            if color:
                gradient = parsed_response.get("color_gradient")
                gradient = gradient.strip() if isinstance(gradient, str) and gradient.strip() else None
                result = {"color": color, "color_gradient": gradient}
                break
        except Exception:
            continue

    fallback = False
    if not result:
        fallback = True
        result = {"color": _fallback_color(name), "color_gradient": None}

    if audit is not None:
        entry: dict[str, Any] = {
            "pass": "color",
            "kind": kind,
            "name": name,
            "cached": False,
            "fallback": fallback,
            "model": model,
            "ollama_url": ollama_url,
            "system_prompt": system_prompt,
            "user_content": user_content,
            "schema": COLOR_SCHEMA,
            "parsed": result,
        }
        if raw_response is not None:
            entry["raw_response"] = raw_response
        if parsed_response is not None:
            entry["llm_parsed"] = parsed_response
        audit.append(entry)

    _session_cache[cache_key] = result
    return result


def stamp_colors_on_products(
    products: list[dict[str, Any]],
    *,
    model: str = DEFAULT_MODEL,
    ollama_url: str = OLLAMA_URL,
) -> list[dict[str, Any]]:
    for product in products:
        audit = product.setdefault("_llm_audit", [])
        for note in product.get("notes") or []:
            name = note.get("name")
            if not name:
                continue
            colors = get_color(
                name,
                "note",
                model=model,
                ollama_url=ollama_url,
                audit=audit,
            )
            note["color"] = colors["color"]
            if colors.get("color_gradient"):
                note["color_gradient"] = colors["color_gradient"]
        for accord in product.get("accords") or []:
            name = accord.get("name")
            if not name:
                continue
            colors = get_color(
                name,
                "accord",
                model=model,
                ollama_url=ollama_url,
                audit=audit,
            )
            accord["color"] = colors["color"]
            if colors.get("color_gradient"):
                accord["color_gradient"] = colors["color_gradient"]

    return products
