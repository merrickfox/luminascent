"""Generic product link discovery for category/listing pages."""

from __future__ import annotations

import json
import re
from urllib.parse import urljoin, urlparse

from scrapling.spiders import Response

PRODUCT_PATH_HINTS = (
    r"/product[s]?/",
    r"/p/",
    r"/item[s]?/",
    r"/dp/",
    r"/sku/",
    r"/detail/",
    r"/buy/",
    r"-p\d+",
    r"/\d{5,}",
)

EXCLUDE_PATH_HINTS = (
    r"/cart",
    r"/basket",
    r"/checkout",
    r"/login",
    r"/signin",
    r"/account",
    r"/search",
    r"/help",
    r"/privacy",
    r"/terms",
    r"/contact",
    r"/store-locator",
    r"/newsletter",
    r"\.pdf$",
    r"\.jpg$",
    r"\.png$",
)

PRODUCT_CARD_SELECTORS = (
    ".product a",
    ".product-card a",
    ".product-item a",
    ".product-tile a",
    ".grid-item a",
    ".item a",
    "[data-product] a",
    "[itemtype*='Product'] a",
    "article a",
)

MIN_LINK_SCORE = 2


def _normalize_url(base_url: str, href: str) -> str | None:
    if not href:
        return None
    href = href.strip()
    if href.startswith(("<", "javascript:", "#", "mailto:", "tel:", "data:")):
        return None
    if not (href.startswith("/") or href.startswith("http")):
        return None
    absolute = urljoin(base_url, href)
    parsed = urlparse(absolute)
    if parsed.scheme not in ("http", "https"):
        return None
    return f"{parsed.scheme}://{parsed.netloc}{parsed.path}" + (
        f"?{parsed.query}" if parsed.query else ""
    )


def _same_domain(base_url: str, url: str) -> bool:
    return urlparse(base_url).netloc.lower() == urlparse(url).netloc.lower()


def _path(url: str) -> str:
    return urlparse(url).path.lower()


def _is_excluded(url: str) -> bool:
    path = _path(url)
    return any(re.search(pattern, path, re.I) for pattern in EXCLUDE_PATH_HINTS)


def _product_path_score(url: str) -> int:
    path = _path(url)
    score = 0
    for pattern in PRODUCT_PATH_HINTS:
        if re.search(pattern, path, re.I):
            score += 2
    if len(path.strip("/").split("/")) >= 3:
        score += 1
    return score


def product_key(url: str) -> str:
    parsed = urlparse(url)
    return f"{parsed.netloc.lower()}{parsed.path.lower().rstrip('/')}"


def _flatten_json_ld(node) -> list[dict]:
    nodes: list[dict] = []

    def walk(item):
        if isinstance(item, list):
            for child in item:
                walk(child)
        elif isinstance(item, dict):
            nodes.append(item)
            for value in item.values():
                if isinstance(value, (list, dict)):
                    walk(value)

    walk(node)
    return nodes


def _urls_from_json_ld(response: Response) -> set[str]:
    urls: set[str] = set()
    for script in response.css('script[type="application/ld+json"]'):
        raw = script.text
        if not raw:
            continue
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            continue
        for node in _flatten_json_ld(data):
            node_type = node.get("@type", "")
            types = node_type if isinstance(node_type, list) else [node_type]
            types = [str(t).lower() for t in types]
            if "itemlist" in types or "product" in types:
                for key in ("url", "@id"):
                    value = node.get(key)
                    if isinstance(value, str) and value.startswith("http"):
                        urls.add(value)
                for item in node.get("itemListElement", []) or []:
                    if isinstance(item, dict):
                        entry = item.get("item") or item.get("url") or item
                        if isinstance(entry, str) and entry.startswith("http"):
                            urls.add(entry)
                        elif isinstance(entry, dict):
                            for key in ("url", "@id"):
                                value = entry.get(key)
                                if isinstance(value, str) and value.startswith("http"):
                                    urls.add(value)
    return urls


def _card_hrefs(response: Response) -> set[str]:
    hrefs: set[str] = set()
    for selector in PRODUCT_CARD_SELECTORS:
        for href in response.css(f"{selector}::attr(href)").getall():
            if href:
                hrefs.add(href)
    return hrefs


def _all_hrefs(response: Response) -> list[str]:
    hrefs = response.css("a::attr(href)").getall()
    html = response.html_content or ""
    for match in re.finditer(r'href="([^"]+)"', html, re.I):
        hrefs.append(match.group(1))
    return hrefs


def collect_product_links(
    response: Response,
    *,
    extra_selector: str | None = None,
) -> list[str]:
    base_url = response.url
    json_ld_urls = _urls_from_json_ld(response)
    card_hrefs = _card_hrefs(response)

    scored: dict[str, int] = {}
    for url in json_ld_urls:
        normalized = _normalize_url(base_url, url)
        if normalized and _same_domain(base_url, normalized) and not _is_excluded(normalized):
            scored[normalized] = 6

    href_sources: list[tuple[str, int]] = []
    if extra_selector:
        for href in response.css(f"{extra_selector}::attr(href)").getall():
            href_sources.append((href, 3))
    for href in _all_hrefs(response):
        href_sources.append((href, 0))
    for href in card_hrefs:
        href_sources.append((href, 2))

    for href, bonus in href_sources:
        url = _normalize_url(base_url, href)
        if not url or not _same_domain(base_url, url) or _is_excluded(url):
            continue
        if url.rstrip("/") == base_url.rstrip("/"):
            continue

        score = _product_path_score(url) + bonus
        if url in json_ld_urls:
            score += 4
        if href in card_hrefs:
            score += 2

        if score >= MIN_LINK_SCORE:
            scored[url] = max(scored.get(url, 0), score)

    return sorted(scored, key=lambda u: scored[u], reverse=True)
