"""Environment bootstrap for local crawler runs."""

from __future__ import annotations

import os
from pathlib import Path


def ensure_playwright_browsers_path() -> None:
    configured = os.environ.get("PLAYWRIGHT_BROWSERS_PATH")
    if configured:
        chromium_dirs = list(Path(configured).glob("chromium-*"))
        if chromium_dirs:
            return

    for candidate in (
        Path.home() / "Library/Caches/ms-playwright",
        Path.home() / ".cache/ms-playwright",
    ):
        if list(candidate.glob("chromium-*")):
            os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(candidate)
            return
