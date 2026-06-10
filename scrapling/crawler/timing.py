"""Stage timing helpers for crawl and extract pipelines."""

from __future__ import annotations

import time
from collections import defaultdict
from contextlib import contextmanager
from typing import Any, Iterator


def round_seconds(value: float | None) -> float:
    if value is None:
        return 0.0
    return round(value, 3)


def stamp_request_meta(meta: dict[str, Any] | None = None) -> dict[str, Any]:
    meta = dict(meta or {})
    meta.setdefault("_queued_at", time.perf_counter())
    return meta


def page_wait_seconds(meta: dict[str, Any]) -> float | None:
    queued_at = meta.get("_queued_at")
    if queued_at is None:
        return None
    return round_seconds(time.perf_counter() - queued_at)


class StageTimer:
    """Record named stage durations in seconds."""

    def __init__(self) -> None:
        self.stages: dict[str, float] = {}

    @contextmanager
    def stage(self, name: str) -> Iterator[None]:
        start = time.perf_counter()
        try:
            yield
        finally:
            self.stages[name] = round_seconds(time.perf_counter() - start)

    def add(self, name: str, seconds: float | None) -> None:
        if seconds is not None:
            self.stages[name] = round_seconds(seconds)

    def set_total(self, seconds: float) -> None:
        self.stages["total_seconds"] = round_seconds(seconds)

    def as_dict(self) -> dict[str, float]:
        return dict(self.stages)


class TimingAccumulator:
    """Sum stage timings across many records (products, browse pages, etc.)."""

    def __init__(self) -> None:
        self.stage_totals: dict[str, float] = defaultdict(float)
        self.counts: dict[str, int] = defaultdict(int)

    def add(self, timings: dict[str, Any], *, item_key: str = "items") -> None:
        for key, value in timings.items():
            if not key.endswith("_seconds") or not isinstance(value, (int, float)):
                continue
            self.stage_totals[key] += float(value)
        self.counts[item_key] += 1

    def add_counts(self, **counts: int) -> None:
        for key, value in counts.items():
            self.counts[key] += value

    def summary(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            key: round_seconds(total) for key, total in self.stage_totals.items()
        }
        result.update(self.counts)
        return result


def format_stage_list(timings: dict[str, Any], *, keys: list[str]) -> str:
    parts: list[str] = []
    for key in keys:
        value = timings.get(key)
        if value is None:
            continue
        label = key.removesuffix("_seconds").replace("_", " ")
        parts.append(f"{label}={value}s")
    return ", ".join(parts)


def log_timing(prefix: str, label: str, timings: dict[str, Any], *, keys: list[str] | None = None) -> None:
    if keys is None:
        keys = [k for k in timings if k.endswith("_seconds") and k != "total_seconds"]
        keys.append("total_seconds")
    detail = format_stage_list(timings, keys=keys)
    print(f"  [timing] {prefix} {label}: {detail}")


def write_timings_json(path: Any, payload: dict[str, Any]) -> None:
    import json
    from pathlib import Path

    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
