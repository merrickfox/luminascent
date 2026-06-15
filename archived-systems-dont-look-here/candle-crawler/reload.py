"""Reload saved fetch artifacts for re-extraction."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from audit import RunPaths


@dataclass
class SavedPage:
    url: str
    html: str
    markdown: str


class SavedResult:
    def __init__(self, page: SavedPage):
        self.url = page.url
        self.html = page.html
        self.markdown = _Markdown(page.markdown)


class _Markdown:
    def __init__(self, text: str):
        self.fit_markdown = text
        self.raw_markdown = text


def load_saved_results(paths: RunPaths, site_name: str) -> list[SavedResult]:
    discovery_path = paths.discovery_path(site_name)
    if not discovery_path.exists():
        return []

    discovery = json.loads(discovery_path.read_text(encoding="utf-8"))
    urls = discovery.get("product_urls") or []
    crawl_stats_path = paths.crawl_stats_path(site_name)
    crawl_stats = {}
    if crawl_stats_path.exists():
        crawl_stats = json.loads(crawl_stats_path.read_text(encoding="utf-8"))

    results: list[SavedResult] = []
    for url in urls:
        entry = (crawl_stats.get("urls") or {}).get(url) or {}
        if entry and not entry.get("success", True):
            continue
        key = paths.artifact_key(url)
        html_path = paths.pages_dir(site_name) / f"{key}.html"
        md_path = paths.markdown_dir(site_name) / f"{key}.md"
        if not html_path.exists():
            continue
        page = SavedPage(
            url=url,
            html=html_path.read_text(encoding="utf-8"),
            markdown=md_path.read_text(encoding="utf-8") if md_path.exists() else "",
        )
        results.append(SavedResult(page))
    return results
