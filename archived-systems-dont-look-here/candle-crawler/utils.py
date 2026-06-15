"""Shared helpers for paths, slugs, and timestamps."""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def fs_timestamp(dt: datetime | None = None) -> str:
    if dt is None:
        dt = datetime.now(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H-%M-%SZ")


def slugify(value: str) -> str:
    slug = value.lower().strip()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    return slug.strip("-") or "unknown"


def url_hash(url: str, length: int = 12) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()[:length]


def site_slug(name: str) -> str:
    return slugify(name)


def domain_from_url(url: str) -> str:
    return urlparse(url).netloc.lower()


def site_origin(url: str) -> str:
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}"


def ensure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def write_json(path: Path, data: object) -> None:
    ensure_dir(path.parent)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def append_jsonl(path: Path, record: dict) -> None:
    ensure_dir(path.parent)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def load_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    records: list[dict] = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records


def product_key(url: str) -> str:
    parsed = urlparse(url)
    return f"{parsed.netloc.lower()}{parsed.path.lower().rstrip('/')}"


EXCLUDE_PATH_PATTERNS = (
    r"/blogs/",
    r"/blog/",
    r"/news/",
    r"/pages/",
    r"/cart",
    r"/checkout",
    r"/account",
    r"/search",
    r"/policies/",
    r"/apps/",
    r"\.pdf$",
    r"\.jpg$",
    r"\.png$",
)

PRODUCT_PAGE_PATTERNS = (
    r"/products/[^/?#]+",
    r"/product/[^/?#]+",
    r"/p/[^/?#]+",
    r"/item/[^/?#]+",
    r"/dp/[^/?#]+",
)

BROWSE_PAGE_PATTERNS = (
    r"/collections/",
    r"/collection/",
    r"/shop/",
    r"/candles",
    r"/catalog",
)


def normalize_url(base_url: str, href: str) -> str | None:
    if not href or href.startswith(("<", "#", "javascript:", "mailto:", "tel:", "data:")):
        return None
    if not (href.startswith("/") or href.startswith("http")):
        return None
    from urllib.parse import urljoin

    absolute = urljoin(base_url, href)
    parsed = urlparse(absolute)
    if parsed.scheme not in ("http", "https"):
        return None
    return f"{parsed.scheme}://{parsed.netloc}{parsed.path}" + (f"?{parsed.query}" if parsed.query else "")


def is_excluded_url(url: str) -> bool:
    path = urlparse(url).path.lower()
    return any(re.search(pattern, path, re.I) for pattern in EXCLUDE_PATH_PATTERNS)


def is_product_page_url(url: str) -> bool:
    if is_excluded_url(url):
        return False
    path = urlparse(url).path.lower()
    return any(re.search(pattern, path, re.I) for pattern in PRODUCT_PAGE_PATTERNS)


def is_browse_page_url(url: str) -> bool:
    path = urlparse(url).path.lower()
    return any(re.search(pattern, path, re.I) for pattern in BROWSE_PAGE_PATTERNS)


def is_same_domain(seed_url: str, candidate_url: str) -> bool:
    return domain_from_url(seed_url) == domain_from_url(candidate_url)


def log_stage(message: str) -> None:
    print(message, flush=True)
