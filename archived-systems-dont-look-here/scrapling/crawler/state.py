"""Brand crawl state, failure logging, and resume helpers."""

from __future__ import annotations

import hashlib
import json
import traceback
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from schema import slugify

FailureStage = Literal["browse", "product", "extract", "request"]


def format_exception(exc: BaseException, *, include_traceback: bool = True) -> dict[str, str]:
    """Build a failure payload, unwrapping ExceptionGroup/TaskGroup to the root cause."""
    root = exc
    if isinstance(exc, BaseExceptionGroup) and exc.exceptions:
        root = exc.exceptions[0]

    payload: dict[str, str] = {
        "reason": str(root) or repr(root),
        "error_type": type(root).__name__,
    }
    if include_traceback:
        tb = root.__traceback__ or exc.__traceback__
        if tb is not None:
            payload["detail"] = "".join(
                traceback.format_exception(type(root), root, tb)
            ).strip()
    return payload


def brand_output_dir(base: Path, brand_name: str) -> Path:
    return base / slugify(brand_name)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def fs_timestamp(dt: datetime | None = None) -> str:
    if dt is None:
        dt = datetime.now(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H-%M-%SZ")


def safe_page_filename(product_key_value: str) -> str:
    digest = hashlib.sha1(product_key_value.encode("utf-8")).hexdigest()[:10]
    slug = slugify(product_key_value.replace("/", "-"))[:80] or "page"
    return f"{slug}-{digest}.html"


def llm_audit_filename(product_key_value: str) -> str:
    return safe_page_filename(product_key_value).removesuffix(".html") + ".json"


def write_llm_audit(pass_dir: Path, product_key_value: str, entries: list[dict[str, Any]]) -> Path:
    llm_dir = pass_dir / "llm"
    llm_dir.mkdir(parents=True, exist_ok=True)
    path = llm_dir / llm_audit_filename(product_key_value)
    path.write_text(json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


@dataclass
class PassInfo:
    pass_id: str
    pass_dir: Path
    raw_path: Path
    pages_dir: Path | None
    legacy: bool = False

    @property
    def has_html(self) -> bool:
        return self.pages_dir is not None and self.pages_dir.exists()


def passes_root(brand_dir: Path) -> Path:
    return brand_dir / "passes"


def legacy_raw_path(brand_dir: Path) -> Path:
    return brand_dir / "raw" / "products.raw.jsonl"


def list_pass_dirs(brand_dir: Path) -> list[Path]:
    root = passes_root(brand_dir)
    if not root.exists():
        return []
    return sorted(
        (p for p in root.iterdir() if p.is_dir()),
        key=lambda p: p.name,
        reverse=True,
    )


def list_passes(brand_dir: Path) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for pass_dir in list_pass_dirs(brand_dir):
        manifest_path = pass_dir / "manifest.json"
        if manifest_path.exists():
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                manifest = {}
        else:
            manifest = {}
        raw_path = pass_dir / "products.raw.jsonl"
        product_count = sum(1 for line in raw_path.open(encoding="utf-8") if line.strip()) if raw_path.exists() else 0
        pages_dir = pass_dir / "pages"
        html_count = len(list(pages_dir.glob("*.html"))) if pages_dir.exists() else 0
        entries.append({
            "pass_id": pass_dir.name,
            "created_at": manifest.get("created_at"),
            "sources": manifest.get("sources", []),
            "products_count": manifest.get("products_count", product_count),
            "html_count": manifest.get("html_count", html_count),
            "path": str(pass_dir),
        })
    legacy = legacy_raw_path(brand_dir)
    if legacy.exists():
        product_count = sum(1 for line in legacy.open(encoding="utf-8") if line.strip())
        entries.append({
            "pass_id": "legacy",
            "created_at": None,
            "sources": [],
            "products_count": product_count,
            "html_count": 0,
            "path": str(legacy.parent),
            "legacy": True,
        })
    return entries


def resolve_pass(brand_dir: Path, pass_id: str | None = None) -> PassInfo | None:
    if pass_id == "legacy":
        raw_path = legacy_raw_path(brand_dir)
        if raw_path.exists():
            return PassInfo("legacy", brand_dir / "raw", raw_path, None, legacy=True)
        return None

    if pass_id:
        pass_dir = passes_root(brand_dir) / pass_id
        if pass_dir.is_dir():
            raw_path = pass_dir / "products.raw.jsonl"
            if raw_path.exists():
                pages_dir = pass_dir / "pages"
                return PassInfo(pass_id, pass_dir, raw_path, pages_dir if pages_dir.exists() else None)
        return None

    for pass_dir in list_pass_dirs(brand_dir):
        raw_path = pass_dir / "products.raw.jsonl"
        if raw_path.exists():
            pages_dir = pass_dir / "pages"
            return PassInfo(pass_dir.name, pass_dir, raw_path, pages_dir if pages_dir.exists() else None)

    raw_path = legacy_raw_path(brand_dir)
    if raw_path.exists():
        return PassInfo("legacy", brand_dir / "raw", raw_path, None, legacy=True)
    return None


def write_pass_manifest(
    pass_dir: Path,
    *,
    pass_id: str,
    sources: list[str],
    products_count: int,
    html_count: int,
    crawl_timings: dict[str, Any] | None = None,
) -> None:
    manifest = {
        "pass_id": pass_id,
        "created_at": utc_now(),
        "sources": sources,
        "products_count": products_count,
        "html_count": html_count,
    }
    if crawl_timings:
        manifest["crawl_timings"] = crawl_timings
    pass_dir.mkdir(parents=True, exist_ok=True)
    (pass_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


class FailureLogger:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def log(
        self,
        *,
        url: str,
        stage: FailureStage,
        reason: str,
        brand: str | None = None,
        error_type: str | None = None,
        detail: str | None = None,
    ) -> None:
        entry: dict[str, Any] = {
            "url": url,
            "stage": stage,
            "reason": reason,
            "brand": brand,
            "ts": utc_now(),
        }
        if error_type:
            entry["error_type"] = error_type
        if detail:
            entry["detail"] = detail
        with self.path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")


class BrandState:
    def __init__(self, path: Path):
        self.path = path
        self.data: dict[str, Any] = self._load()

    def _load(self) -> dict[str, Any]:
        if self.path.exists():
            try:
                return json.loads(self.path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                pass
        return {
            "brand": None,
            "sources": {},
            "scraped_keys": [],
            "passes": [],
            "latest_pass": None,
            "completed": False,
            "updated_at": None,
        }

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.data["updated_at"] = utc_now()
        self.path.write_text(json.dumps(self.data, indent=2, ensure_ascii=False), encoding="utf-8")

    def init_brand(self, brand_name: str) -> None:
        if not self.data.get("brand"):
            self.data["brand"] = brand_name

    def source_status(self, url: str) -> str:
        return self.data.get("sources", {}).get(url, {}).get("status", "pending")

    def mark_source(self, url: str, status: str, *, pages_done: int | None = None) -> None:
        sources = self.data.setdefault("sources", {})
        entry = sources.setdefault(url, {})
        entry["status"] = status
        if pages_done is not None:
            entry["pages_done"] = pages_done
        self.save()

    def scraped_keys_set(self) -> set[str]:
        return set(self.data.get("scraped_keys", []))

    def add_scraped_key(self, key: str) -> None:
        keys = self.data.setdefault("scraped_keys", [])
        if key not in keys:
            keys.append(key)
            self.save()

    def mark_completed(self) -> None:
        self.data["completed"] = True
        self.save()

    def set_timings(self, phase: str, summary: dict[str, Any]) -> None:
        timings = self.data.setdefault("timings", {})
        timings[phase] = summary
        self.save()

    def set_source_probe(self, url: str, summary: dict[str, Any]) -> None:
        probes = self.data.setdefault("probes", {})
        probes[url] = summary
        self.save()

    def add_pass(self, pass_id: str, *, sources: list[str], products_count: int) -> None:
        passes = self.data.setdefault("passes", [])
        entry = {
            "pass_id": pass_id,
            "sources": sources,
            "products_count": products_count,
            "created_at": utc_now(),
        }
        if not any(p.get("pass_id") == pass_id for p in passes):
            passes.append(entry)
        self.data["latest_pass"] = pass_id
        self.save()

    def latest_pass_id(self) -> str | None:
        return self.data.get("latest_pass")


def load_products_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    records = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records


def compile_products_json(jsonl_path: Path, json_path: Path) -> list[dict[str, Any]]:
    records = load_products_jsonl(jsonl_path)
    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(records, indent=2, ensure_ascii=False), encoding="utf-8")
    return records


def load_failures(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    records = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records
