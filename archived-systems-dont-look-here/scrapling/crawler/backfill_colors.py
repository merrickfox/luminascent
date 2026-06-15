#!/usr/bin/env python3
"""Backfill display colors for notes and accords in the Luminascent database."""

from __future__ import annotations

import argparse
import sys

import httpx

from colors import DEFAULT_MODEL, get_color


def fetch_entities(client: httpx.Client, host: str, path: str, api_key: str) -> list[dict]:
    response = client.get(
        f"{host}/admin{path}",
        headers={"x-api-key": api_key},
    )
    response.raise_for_status()
    key = "notes" if "notes" in path else "accords"
    return response.json()[key]


def patch_color(
    client: httpx.Client,
    host: str,
    path: str,
    entity_id: str,
    color: str,
    color_gradient: str | None,
    api_key: str,
) -> dict:
    response = client.patch(
        f"{host}/admin{path}/{entity_id}",
        headers={"x-api-key": api_key, "Content-Type": "application/json"},
        json={"color": color, "color_gradient": color_gradient},
    )
    response.raise_for_status()
    return response.json()


def backfill_kind(
    client: httpx.Client,
    *,
    host: str,
    api_key: str,
    kind: str,
    path: str,
    force: bool,
    dry_run: bool,
    model: str,
    ollama_url: str,
) -> int:
    entities = fetch_entities(client, host, path, api_key)
    pending = [e for e in entities if force or not e.get("color")]

    if not pending:
        print(f"  {kind}s: nothing to backfill ({len(entities)} total)")
        return 0

    print(f"  {kind}s: {len(pending)} to color ({len(entities)} total)")
    updated = 0

    for i, entity in enumerate(pending, 1):
        name = entity["name"]
        colors = get_color(name, kind, model=model, ollama_url=ollama_url)
        color = colors["color"]
        gradient = colors.get("color_gradient")
        label = f"{color}" + (f" / {gradient}" if gradient else "")

        if dry_run:
            print(f"    [{i}/{len(pending)}] [dry-run] {name}: {label}")
        else:
            patch_color(client, host, path, entity["id"], color, gradient, api_key)
            print(f"    [{i}/{len(pending)}] {name}: {label}")

        updated += 1

    return updated


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill note/accord colors via Ollama")
    parser.add_argument("--host", default="http://localhost:8023", help="Backend API host")
    parser.add_argument("--api-key", default="dev-admin-key", help="Admin API key")
    parser.add_argument("--force", action="store_true", help="Regenerate colors even when already set")
    parser.add_argument("--dry-run", action="store_true", help="Generate colors but do not write to DB")
    parser.add_argument("--ollama-model", default=DEFAULT_MODEL)
    parser.add_argument("--ollama-url", default="http://localhost:11434/api/chat")
    parser.add_argument("--notes-only", action="store_true")
    parser.add_argument("--accords-only", action="store_true")
    args = parser.parse_args()

    if args.notes_only and args.accords_only:
        parser.error("--notes-only and --accords-only are mutually exclusive")

    print(f"Backfill colors -> {args.host}")
    if args.dry_run:
        print("  (dry run)")

    with httpx.Client(timeout=60.0) as client:
        total = 0

        if not args.accords_only:
            total += backfill_kind(
                client,
                host=args.host,
                api_key=args.api_key,
                kind="note",
                path="/notes",
                force=args.force,
                dry_run=args.dry_run,
                model=args.ollama_model,
                ollama_url=args.ollama_url,
            )

        if not args.notes_only:
            total += backfill_kind(
                client,
                host=args.host,
                api_key=args.api_key,
                kind="accord",
                path="/accords",
                force=args.force,
                dry_run=args.dry_run,
                model=args.ollama_model,
                ollama_url=args.ollama_url,
            )

    print(f"\nDone: {total} colored")


if __name__ == "__main__":
    try:
        main()
    except httpx.HTTPStatusError as exc:
        print(f"API error: {exc.response.status_code} {exc.response.text}", file=sys.stderr)
        sys.exit(1)
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)
