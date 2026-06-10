#!/usr/bin/env python3
"""Dedupe duplicate size entries in a brand's products JSON.

Some sites (notably Acqua di Parma, on Salesforce Commerce Cloud) expose the
same physical size under two different SKUs: one from the variation endpoint
(no price) and one from the product-page JSON-LD (with price). The crawler keys
its merge on SKU, so these land as two entries sharing the same ``size_grams``.

This util collapses sizes that share the same (non-null) ``size_grams``,
keeping the entry that has a price and backfilling any missing fields from the
dropped duplicate. Entries without ``size_grams`` are left untouched, since on
this brand they come from category/listing pages where each null-grams entry is
a distinct candle rather than a duplicate of the same size.

Usage:
    python dedupe_sizes.py [path/to/products.json] [--dry-run] [--no-backup]

Defaults to output/acqua-di-parma/products.json when no path is given.
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path
from typing import Any

DEFAULT_PATH = Path(__file__).parent / "output" / "acqua-di-parma" / "products.json"


def _group_key(size: dict[str, Any]) -> Any:
    """Group sizes that share the same weight. Returns None for null-grams entries
    so they are never deduped against each other."""
    grams = size.get("size_grams")
    if grams is None:
        return None
    return ("g", grams)


def _has_price(size: dict[str, Any]) -> bool:
    return size.get("price_amount") is not None


def _dedupe_sizes(sizes: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
    """Return (deduped_sizes, num_removed), preserving original order of kept entries."""
    if not sizes:
        return sizes, 0

    # Bucket dedupable entries by weight; passthrough entries (null grams) keep
    # their original position via a placeholder in the order list.
    groups: dict[Any, list[dict[str, Any]]] = {}
    order: list[Any] = []
    for size in sizes:
        key = _group_key(size)
        if key is None:
            order.append(("passthrough", size))
            continue
        if key not in groups:
            groups[key] = []
            order.append(("group", key))
        groups[key].append(size)

    deduped: list[dict[str, Any]] = []
    removed = 0
    for kind, payload in order:
        if kind == "passthrough":
            deduped.append(payload)
            continue
        group = groups[payload]
        if len(group) == 1:
            deduped.append(group[0])
            continue

        # Prefer a priced entry, then a primary one, then the first seen.
        kept = next((s for s in group if _has_price(s)), None) or group[0]

        # Backfill any missing fields on the kept entry from its duplicates.
        for other in group:
            if other is kept:
                continue
            for field, value in other.items():
                if kept.get(field) is None and value is not None:
                    kept[field] = value

        # Keep primary flag if any duplicate was primary.
        if any(s.get("is_primary") for s in group):
            kept["is_primary"] = True

        deduped.append(kept)
        removed += len(group) - 1

    return deduped, removed


def dedupe_file(path: Path, *, dry_run: bool, backup: bool) -> None:
    products = json.loads(path.read_text())
    if not isinstance(products, list):
        raise SystemExit(f"Expected a JSON array of products in {path}")

    total_removed = 0
    affected_products = 0
    for product in products:
        sizes = product.get("sizes")
        if not isinstance(sizes, list):
            continue
        deduped, removed = _dedupe_sizes(sizes)
        if removed:
            product["sizes"] = deduped
            total_removed += removed
            affected_products += 1
            print(f"  {product.get('slug') or product.get('name')}: removed {removed} duplicate size(s)")

    print(f"\n{affected_products} product(s) affected, {total_removed} duplicate size(s) removed.")

    if dry_run:
        print("Dry run: no changes written.")
        return

    if total_removed == 0:
        print("Nothing to write.")
        return

    if backup:
        backup_path = path.with_suffix(path.suffix + ".bak")
        shutil.copy2(path, backup_path)
        print(f"Backup written to {backup_path}")

    path.write_text(json.dumps(products, indent=2, ensure_ascii=False) + "\n")
    print(f"Updated {path}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("path", nargs="?", type=Path, default=DEFAULT_PATH, help="Path to products JSON file")
    parser.add_argument("--dry-run", action="store_true", help="Report changes without writing")
    parser.add_argument("--no-backup", action="store_true", help="Skip writing a .bak copy before overwriting")
    args = parser.parse_args()

    if not args.path.exists():
        raise SystemExit(f"File not found: {args.path}")

    print(f"Deduping sizes in {args.path}")
    dedupe_file(args.path, dry_run=args.dry_run, backup=not args.no_backup)


if __name__ == "__main__":
    main()
