#!/usr/bin/env python3
"""Pretty-print candle crawl results."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from schema import slugify
from state import brand_output_dir, list_passes, load_failures, load_products_jsonl


def format_price(amount: int | None, currency: str | None) -> str:
    if amount is None:
        return "—"
    symbol = {"GBP": "£", "USD": "$", "EUR": "€"}.get(currency or "", "")
    if symbol:
        return f"{symbol}{amount / 100:.2f}"
    return f"{amount / 100:.2f} {currency or ''}".strip()


def load_brand_products(brand_dir: Path) -> list[dict]:
    json_path = brand_dir / "products.json"
    if json_path.exists():
        return json.loads(json_path.read_text(encoding="utf-8"))
    jsonl_path = brand_dir / "products.jsonl"
    return load_products_jsonl(jsonl_path)


def primary_size(record: dict) -> dict | None:
    sizes = record.get("sizes") or []
    if not sizes:
        return None
    for size in sizes:
        if size.get("is_primary"):
            return size
    return sizes[0]


def print_summary(records: list[dict]) -> None:
    if not records:
        print("No records found.")
        return

    print(f"\n{'Name':<42} {'Price':>10}  Sz  Img  Notes")
    print("-" * 72)
    for r in records:
        name = (r.get("name") or "—")[:40]
        primary = primary_size(r) or {}
        price = format_price(primary.get("price_amount"), primary.get("price_currency"))
        sizes = len(r.get("sizes") or [])
        images = len(r.get("images") or [])
        notes = len(r.get("notes") or [])
        print(f"{name:<42} {price:>10}  {sizes:>2}  {images:>3}  {notes:>5}")

    print(f"\n{len(records)} products total")


def print_detail(record: dict) -> None:
    print(json.dumps(record, indent=2, ensure_ascii=False))


def print_passes(brand_dir: Path) -> None:
    passes = list_passes(brand_dir)
    if not passes:
        print("No scrape passes recorded.")
        return
    print(f"\n{'Pass ID':<28} {'Products':>8}  {'HTML':>6}  Sources")
    print("-" * 72)
    for entry in passes:
        sources = ", ".join(entry.get("sources") or [])[:32]
        legacy = " (legacy)" if entry.get("legacy") else ""
        print(
            f"{entry['pass_id']:<28} {entry.get('products_count', 0):>8}  "
            f"{entry.get('html_count', 0):>6}  {sources}{legacy}"
        )
    print(f"\n{len(passes)} passes total")


def print_timings(brand_dir: Path) -> None:
    timings_path = brand_dir / "timings.json"
    if timings_path.exists():
        payload = json.loads(timings_path.read_text(encoding="utf-8"))
    else:
        state_path = brand_dir / "state.json"
        if state_path.exists():
            payload = json.loads(state_path.read_text(encoding="utf-8")).get("timings", {})
        else:
            payload = {}
    if not payload:
        print("No timings recorded.")
        return
    print(json.dumps(payload, indent=2, ensure_ascii=False))


def print_failures(brand_dir: Path) -> None:
    failures = load_failures(brand_dir / "failures.jsonl")
    if not failures:
        print("No failures recorded.")
        return
    print(f"\n{'Stage':<10} {'Type':<14} {'URL':<42} Reason")
    print("-" * 110)
    for f in failures:
        url = (f.get("url") or "")[:40]
        error_type = (f.get("error_type") or "")[:12]
        print(f"{f.get('stage', ''):<10} {error_type:<14} {url:<42} {f.get('reason', '')}")
    print(f"\n{len(failures)} failures total")
    if any(f.get("detail") for f in failures):
        print("\nUse --failures --index N to see full traceback for one failure.")


def main():
    parser = argparse.ArgumentParser(description="View candle crawl results")
    parser.add_argument("brand", nargs="?", help="Brand name (matches brands.json)")
    parser.add_argument("--file", type=Path, help="Direct path to products.json or .jsonl")
    parser.add_argument("--failures", action="store_true", help="Show failures.jsonl for the brand")
    parser.add_argument("--timings", action="store_true", help="Show crawl/extract timing summary")
    parser.add_argument("--passes", action="store_true", help="List stored scrape passes")
    parser.add_argument("--index", type=int, help="Show full JSON for one record (1-based)")
    parser.add_argument("--output-dir", type=Path, default=Path(__file__).parent / "output")
    args = parser.parse_args()

    if args.file:
        brand_dir = args.file.parent
        if args.file.suffix == ".json":
            records = json.loads(args.file.read_text(encoding="utf-8"))
        else:
            records = load_products_jsonl(args.file)
    elif args.brand:
        brand_dir = brand_output_dir(args.output_dir, args.brand)
        records = load_brand_products(brand_dir)
    else:
        parser.error("Provide brand name or --file")

    if args.passes:
        print_passes(brand_dir)
        return

    if args.timings:
        print_timings(brand_dir)
        return

    if args.failures:
        failures = load_failures(brand_dir / "failures.jsonl")
        if args.index:
            if args.index < 1 or args.index > len(failures):
                print(f"Index out of range (1-{len(failures)})")
                raise SystemExit(1)
            print_detail(failures[args.index - 1])
        else:
            print_failures(brand_dir)
        return

    if not records and not args.failures:
        print(f"No products at {brand_dir}")
        print("Run: python crawl_brands.py brands.json --brand \"Your Brand\"")
        raise SystemExit(1)

    if args.index:
        if args.index < 1 or args.index > len(records):
            print(f"Index out of range (1-{len(records)})")
            raise SystemExit(1)
        print_detail(records[args.index - 1])
    else:
        print_summary(records)
        if args.brand:
            print(f"\nFull detail: python view.py \"{args.brand}\" --index 1")
            print(f"Failures:    python view.py \"{args.brand}\" --failures")
        print(f"Timings:     python view.py \"{args.brand}\" --timings")
        print(f"Passes:      python view.py \"{args.brand}\" --passes")
        print(f"Source: {brand_dir / 'products.json'}")


if __name__ == "__main__":
    main()
