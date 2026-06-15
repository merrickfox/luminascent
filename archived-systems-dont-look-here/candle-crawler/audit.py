"""Audit trail layout and artifact writers."""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from utils import ensure_dir, fs_timestamp, site_slug, url_hash, write_json


@dataclass
class RunPaths:
    run_id: str
    root: Path

    @classmethod
    def create(cls, output_base: Path) -> RunPaths:
        run_id = fs_timestamp()
        root = ensure_dir(output_base / run_id)
        return cls(run_id=run_id, root=root)

    @classmethod
    def from_run_id(cls, output_base: Path, run_id: str) -> RunPaths:
        return cls(run_id=run_id, root=output_base / run_id)

    @property
    def manifest_path(self) -> Path:
        return self.root / "run.json"

    @property
    def combined_products_path(self) -> Path:
        return self.root / "products.combined.json"

    def site_dir(self, site_name: str) -> Path:
        return ensure_dir(self.root / site_slug(site_name))

    def discovery_path(self, site_name: str) -> Path:
        return self.site_dir(site_name) / "discovery.json"

    def crawl_stats_path(self, site_name: str) -> Path:
        return self.site_dir(site_name) / "crawl_stats.json"

    def raw_products_path(self, site_name: str) -> Path:
        return self.site_dir(site_name) / "products.raw.jsonl"

    def products_path(self, site_name: str) -> Path:
        return self.site_dir(site_name) / "products.json"

    def failures_path(self, site_name: str) -> Path:
        return self.site_dir(site_name) / "failures.jsonl"

    def pages_dir(self, site_name: str) -> Path:
        return ensure_dir(self.site_dir(site_name) / "pages")

    def markdown_dir(self, site_name: str) -> Path:
        return ensure_dir(self.site_dir(site_name) / "markdown")

    def llm_dir(self, site_name: str) -> Path:
        return ensure_dir(self.site_dir(site_name) / "llm")

    def screenshots_dir(self, site_name: str) -> Path:
        return ensure_dir(self.site_dir(site_name) / "screenshots")

    def artifact_key(self, url: str) -> str:
        return url_hash(url)


def write_page_artifacts(
    paths: RunPaths,
    site_name: str,
    *,
    url: str,
    html: str | None,
    markdown: str | None,
    screenshot_b64: str | None = None,
) -> dict[str, str | None]:
    key = paths.artifact_key(url)
    written: dict[str, str | None] = {
        "html_file": None,
        "markdown_file": None,
        "screenshot_file": None,
    }

    if html:
        html_path = paths.pages_dir(site_name) / f"{key}.html"
        html_path.write_text(html, encoding="utf-8")
        written["html_file"] = str(html_path.relative_to(paths.root))

    if markdown is not None:
        md_path = paths.markdown_dir(site_name) / f"{key}.md"
        md_path.write_text(markdown, encoding="utf-8")
        written["markdown_file"] = str(md_path.relative_to(paths.root))

    if screenshot_b64:
        png_path = paths.screenshots_dir(site_name) / f"{key}.png"
        png_path.write_bytes(base64.b64decode(screenshot_b64))
        written["screenshot_file"] = str(png_path.relative_to(paths.root))

    return written


def write_llm_audit(
    paths: RunPaths,
    site_name: str,
    *,
    url: str,
    audit: dict[str, Any],
) -> Path:
    key = paths.artifact_key(url)
    path = paths.llm_dir(site_name) / f"{key}.json"
    write_json(path, audit)
    return path


def log_failure(
    paths: RunPaths,
    site_name: str,
    *,
    url: str,
    stage: str,
    reason: str,
    detail: str | None = None,
) -> None:
    entry: dict[str, Any] = {
        "url": url,
        "stage": stage,
        "reason": reason,
    }
    if detail:
        entry["detail"] = detail
    failure_path = paths.failures_path(site_name)
    ensure_dir(failure_path.parent)
    with failure_path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
