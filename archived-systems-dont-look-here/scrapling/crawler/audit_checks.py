"""Post-extract validation pass: cross-reference products against LLM audit artifacts."""

from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import httpx

from extract import DEFAULT_MODEL, OLLAMA_NUM_PREDICT, OLLAMA_URL
from link_discovery import product_key
from schema import WAX_TYPE_SET
from state import PassInfo, llm_audit_filename, load_failures, utc_now

Severity = str

JUNK_NOTE_STOPWORDS = frozenset({
    "that", "your", "across", "evokes", "discovery", "unforgettable", "intriguing",
    "expressing", "precious", "notes", "home", "candle", "luxury",
})

LLM_JUDGMENT_CHECKS = frozenset({"junk_notes", "discarded_llm_response"})

AUDIT_VERDICT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "verdict": {
            "type": "string",
            "enum": ["ok", "junk_notes", "missing_notes", "discarded_but_recoverable", "unclear"],
        },
        "real_notes_present": {"type": "boolean"},
        "suggested_notes": {
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
        "explanation": {"type": "string"},
    },
    "required": ["verdict", "real_notes_present", "suggested_notes", "explanation"],
}

AUDIT_SYSTEM_PROMPT = """You audit candle product extraction quality.

Given page text and the extracted notes (if any), judge whether the notes are genuine fragrance raw materials/ingredients (e.g. Bergamot, Saffron, Patchouli) or junk prose fragments from marketing copy.

Return JSON only. Use suggested_notes for real fragrance materials visible in the page text when the extracted notes are wrong or missing."""


def load_llm_audit(pass_dir: Path, source_url: str) -> list[dict[str, Any]]:
    path = pass_dir / "llm" / llm_audit_filename(product_key(source_url))
    if not path.exists():
        return []
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []


def _extract_audit_entry(entries: list[dict[str, Any]]) -> dict[str, Any] | None:
    for entry in entries:
        if entry.get("pass") == "extract":
            return entry
    return None


def _is_junk_note_name(name: str) -> bool:
    stripped = name.strip()
    if not stripped:
        return True
    if len(stripped) > 40:
        return True
    if stripped.endswith("."):
        return True
    words = stripped.split()
    if len(words) > 5:
        return True
    lower = stripped.lower()
    if any(f" {word} " in f" {lower} " or lower.startswith(f"{word} ") for word in JUNK_NOTE_STOPWORDS):
        return True
    return False


_STRUCTURAL_JSON_LINES = frozenset({"{", "}", "[", "]", "{,", "},", "[,", "],"})


def _is_substantive_line(line: str, *, min_chars: int = 25) -> bool:
    stripped = line.strip()
    if len(stripped) < min_chars:
        return False
    if stripped in _STRUCTURAL_JSON_LINES:
        return False
    if re.fullmatch(r"[\{\}\[\],]+", stripped):
        return False
    return True


def _has_repetition_loop(text: str, *, min_repeats: int = 8) -> bool:
    if not text:
        return False
    for match in re.finditer(r"(.{40,}?)\1{7,}", text, flags=re.DOTALL):
        if len(match.group(1)) >= 40:
            return True
    lines = [line.strip() for line in text.splitlines() if _is_substantive_line(line)]
    if not lines:
        return False
    counts = Counter(lines)
    return any(count >= min_repeats for count in counts.values())


def _finding(
    *,
    product: dict[str, Any],
    product_index: int,
    check: str,
    severity: Severity,
    detail: str,
    llm_verdict: dict[str, Any] | None = None,
) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "source_url": product.get("source_url", ""),
        "name": product.get("name"),
        "product_index": product_index,
        "check": check,
        "severity": severity,
        "detail": detail,
    }
    if llm_verdict is not None:
        entry["llm_verdict"] = llm_verdict
    return entry


def _check_discarded_llm_response(extract_entry: dict[str, Any] | None) -> str | None:
    if not extract_entry:
        return None
    raw = extract_entry.get("raw_response") or ""
    parsed = extract_entry.get("parsed")
    if raw and parsed == {}:
        return "Extract LLM returned non-empty raw_response but parsed result was empty (likely truncated JSON)"
    return None


def _check_truncated_llm_output(extract_entry: dict[str, Any] | None) -> str | None:
    if not extract_entry:
        return None
    raw = extract_entry.get("raw_response") or ""
    if not raw:
        return None
    parsed = extract_entry.get("parsed")
    if isinstance(parsed, dict) and parsed:
        return None
    if len(raw) >= OLLAMA_NUM_PREDICT * 2:
        return f"raw_response is very long ({len(raw)} chars), possible token-limit truncation"
    if _has_repetition_loop(raw):
        return "raw_response contains repeated lines/phrases, possible model repetition loop"
    if raw.rstrip() and not raw.rstrip().endswith("}"):
        return "raw_response does not end with closing brace, likely truncated mid-JSON"
    return None


def _check_junk_notes(product: dict[str, Any]) -> list[str]:
    issues: list[str] = []
    for note in product.get("notes") or []:
        name = note.get("name") or ""
        if _is_junk_note_name(name):
            issues.append(name)
    return issues


def _check_notes_from_fallback(
    product: dict[str, Any],
    extract_entry: dict[str, Any] | None,
) -> str | None:
    notes = product.get("notes") or []
    if not notes:
        return None
    provenance = product.get("_provenance") or {}
    if provenance.get("llm"):
        return None
    parsed_notes = []
    if extract_entry:
        parsed = extract_entry.get("parsed") or {}
        parsed_notes = parsed.get("notes") or []
    if parsed_notes:
        return None
    return "Product has notes but extract LLM parsed no notes and _provenance.llm is false (likely description-regex fallback)"


def _check_missing_critical(product: dict[str, Any]) -> list[tuple[str, Severity, str]]:
    findings: list[tuple[str, Severity, str]] = []
    if not product.get("name"):
        findings.append(("missing_critical", "high", "Product has no name"))
    if not product.get("sizes"):
        findings.append(("missing_critical", "medium", "Product has no sizes"))
    if not product.get("images"):
        findings.append(("missing_critical", "medium", "Product has no images"))
    if not product.get("notes"):
        findings.append(("missing_critical", "medium", "Product has no notes"))
    sizes = product.get("sizes") or []
    if sizes and all(size.get("price_amount") is None for size in sizes):
        findings.append(("missing_critical", "medium", "All sizes have null price_amount"))
    return findings


def _check_enum_violation(product: dict[str, Any]) -> str | None:
    wax_type = product.get("wax_type")
    if wax_type is not None and wax_type not in WAX_TYPE_SET:
        return f"wax_type {wax_type!r} is not in WAX_TYPES"
    return None


def _check_fallback_colors(audit_entries: list[dict[str, Any]]) -> list[str]:
    issues: list[str] = []
    for entry in audit_entries:
        if entry.get("pass") != "color":
            continue
        if entry.get("fallback"):
            kind = entry.get("kind", "color")
            name = entry.get("name", "?")
            issues.append(f"{kind}:{name}")
    return issues


def _audit_user_content(extract_entry: dict[str, Any] | None) -> str:
    if not extract_entry:
        return ""
    user_content = extract_entry.get("user_content") or ""
    prefix = "Extract candle product fields from this page text:\n\n"
    if user_content.startswith(prefix):
        return user_content[len(prefix):]
    return user_content


def _call_audit_llm(
    *,
    page_text: str,
    product: dict[str, Any],
    flagged_checks: set[str],
    model: str,
    ollama_url: str,
) -> dict[str, Any]:
    note_names = [n.get("name") for n in (product.get("notes") or []) if n.get("name")]
    checks_text = ", ".join(sorted(flagged_checks))
    user_content = (
        f"Flagged checks: {checks_text}\n\n"
        f"Extracted notes: {json.dumps(note_names, ensure_ascii=False)}\n\n"
        f"Page text:\n\n{page_text[:8000]}"
    )
    payload = {
        "model": model,
        "stream": False,
        "options": {"temperature": 0, "num_ctx": 4096, "num_predict": 512},
        "format": AUDIT_VERDICT_SCHEMA,
        "messages": [
            {"role": "system", "content": AUDIT_SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
    }
    with httpx.Client(timeout=120.0) as client:
        response = client.post(ollama_url, json=payload)
        response.raise_for_status()
        content = response.json().get("message", {}).get("content", "{}")
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        return {
            "verdict": "unclear",
            "real_notes_present": False,
            "suggested_notes": [],
            "explanation": "Failed to parse audit LLM response",
        }


def _collect_duplicate_findings(products: list[dict[str, Any]]) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    by_slug: dict[str, list[int]] = defaultdict(list)
    by_url: dict[str, list[int]] = defaultdict(list)
    for index, product in enumerate(products, start=1):
        slug = product.get("slug")
        url = product.get("source_url")
        if slug:
            by_slug[slug].append(index)
        if url:
            by_url[url].append(index)

    seen: set[tuple[str, str]] = set()
    for slug, indices in by_slug.items():
        if len(indices) > 1:
            key = ("slug", slug)
            if key not in seen:
                seen.add(key)
                findings.append({
                    "source_url": products[indices[0] - 1].get("source_url", ""),
                    "name": products[indices[0] - 1].get("name"),
                    "product_index": indices[0],
                    "check": "duplicate_product",
                    "severity": "medium",
                    "detail": f"Duplicate slug {slug!r} at product indices {indices}",
                })

    for url, indices in by_url.items():
        if len(indices) > 1:
            key = ("url", url)
            if key not in seen:
                seen.add(key)
                findings.append({
                    "source_url": url,
                    "name": products[indices[0] - 1].get("name"),
                    "product_index": indices[0],
                    "check": "duplicate_product",
                    "severity": "medium",
                    "detail": f"Duplicate source_url at product indices {indices}",
                })
    return findings


def _build_summary(findings: list[dict[str, Any]], products_total: int, llm_checked: int) -> dict[str, Any]:
    by_severity: Counter[str] = Counter()
    by_check: Counter[str] = Counter()
    flagged_indices: set[int] = set()
    for finding in findings:
        by_severity[finding["severity"]] += 1
        by_check[finding["check"]] += 1
        if finding.get("product_index"):
            flagged_indices.add(finding["product_index"])

    return {
        "products_total": products_total,
        "products_with_findings": len(flagged_indices),
        "by_severity": dict(by_severity),
        "by_check": dict(by_check),
        "llm_checked": llm_checked,
    }


def _print_console_summary(report: dict[str, Any], report_path: Path) -> None:
    summary = report.get("summary") or {}
    total = summary.get("products_total", 0)
    flagged = summary.get("products_with_findings", 0)
    by_severity = summary.get("by_severity") or {}
    high = by_severity.get("high", 0)
    medium = by_severity.get("medium", 0)
    low = by_severity.get("low", 0)

    print(f"\n  Audit: {flagged}/{total} products flagged ({high} high, {medium} medium, {low} low)")
    print(f"  Report: {report_path}")

    if not report.get("findings"):
        print("  No issues detected.")
        return

    severity_rank = {"high": 0, "medium": 1, "low": 2}
    worst = sorted(
        report["findings"],
        key=lambda f: (severity_rank.get(f.get("severity", "low"), 9), f.get("product_index", 0)),
    )[:8]

    print(f"\n  {'Sev':<6} {'Check':<28} Product")
    print("  " + "-" * 68)
    for finding in worst:
        name = (finding.get("name") or finding.get("source_url") or "—")[:36]
        print(
            f"  {finding.get('severity', ''):<6} {finding.get('check', ''):<28} {name}"
        )
    remaining = len(report["findings"]) - len(worst)
    if remaining > 0:
        print(f"  ... and {remaining} more finding(s) in report")


def run_audit_checks(
    brand_dir: Path,
    pass_info: PassInfo,
    products: list[dict[str, Any]],
    *,
    brand_name: str,
    use_llm: bool = True,
    model: str = DEFAULT_MODEL,
    ollama_url: str = OLLAMA_URL,
) -> dict[str, Any]:
    llm_dir = pass_info.pass_dir / "llm"
    if pass_info.legacy or not llm_dir.exists():
        print("  Audit: skipped (no llm/ artifacts for this pass)")
        return {}

    failures = load_failures(brand_dir / "failures.jsonl")
    failure_urls = {f.get("url") for f in failures if f.get("url")}

    findings: list[dict[str, Any]] = []
    findings.extend(_collect_duplicate_findings(products))

    llm_checked = 0
    per_product_findings: dict[int, list[dict[str, Any]]] = defaultdict(list)

    for index, product in enumerate(products, start=1):
        source_url = product.get("source_url", "")
        audit_entries = load_llm_audit(pass_info.pass_dir, source_url)
        extract_entry = _extract_audit_entry(audit_entries)

        if source_url in failure_urls:
            per_product_findings[index].append(
                _finding(
                    product=product,
                    product_index=index,
                    check="pipeline_failure",
                    severity="medium",
                    detail="source_url appears in failures.jsonl",
                )
            )

        detail = _check_discarded_llm_response(extract_entry)
        if detail:
            per_product_findings[index].append(
                _finding(
                    product=product,
                    product_index=index,
                    check="discarded_llm_response",
                    severity="high",
                    detail=detail,
                )
            )

        detail = _check_truncated_llm_output(extract_entry)
        if detail:
            per_product_findings[index].append(
                _finding(
                    product=product,
                    product_index=index,
                    check="truncated_llm_output",
                    severity="high",
                    detail=detail,
                )
            )

        junk_notes = _check_junk_notes(product)
        if junk_notes:
            per_product_findings[index].append(
                _finding(
                    product=product,
                    product_index=index,
                    check="junk_notes",
                    severity="medium",
                    detail=f"Suspicious note names: {junk_notes}",
                )
            )

        detail = _check_notes_from_fallback(product, extract_entry)
        if detail:
            per_product_findings[index].append(
                _finding(
                    product=product,
                    product_index=index,
                    check="notes_from_text_fallback",
                    severity="low",
                    detail=detail,
                )
            )

        for check, severity, detail in _check_missing_critical(product):
            per_product_findings[index].append(
                _finding(
                    product=product,
                    product_index=index,
                    check=check,
                    severity=severity,
                    detail=detail,
                )
            )

        detail = _check_enum_violation(product)
        if detail:
            per_product_findings[index].append(
                _finding(
                    product=product,
                    product_index=index,
                    check="enum_violation",
                    severity="medium",
                    detail=detail,
                )
            )

        color_issues = _check_fallback_colors(audit_entries)
        if color_issues:
            per_product_findings[index].append(
                _finding(
                    product=product,
                    product_index=index,
                    check="fallback_color",
                    severity="low",
                    detail=f"Hash fallback colors used for: {color_issues}",
                )
            )

        flagged_checks = {f["check"] for f in per_product_findings[index]}
        if use_llm and flagged_checks & LLM_JUDGMENT_CHECKS:
            page_text = _audit_user_content(extract_entry)
            if page_text:
                try:
                    verdict = _call_audit_llm(
                        page_text=page_text,
                        product=product,
                        flagged_checks=flagged_checks & LLM_JUDGMENT_CHECKS,
                        model=model,
                        ollama_url=ollama_url,
                    )
                    llm_checked += 1
                    for finding in per_product_findings[index]:
                        if finding["check"] in LLM_JUDGMENT_CHECKS:
                            finding["llm_verdict"] = verdict
                except Exception as exc:
                    for finding in per_product_findings[index]:
                        if finding["check"] in LLM_JUDGMENT_CHECKS:
                            finding["llm_verdict"] = {
                                "verdict": "unclear",
                                "real_notes_present": False,
                                "suggested_notes": [],
                                "explanation": str(exc),
                            }

    for product_findings in per_product_findings.values():
        findings.extend(product_findings)

    llm_checked_count = llm_checked
    report = {
        "pass_id": pass_info.pass_id,
        "brand": brand_name,
        "generated_at": utc_now(),
        "failures_total": len(failures),
        "summary": _build_summary(findings, len(products), llm_checked_count),
        "findings": findings,
    }

    report_path = pass_info.pass_dir / "audit_report.json"
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    _print_console_summary(report, report_path)
    return report
