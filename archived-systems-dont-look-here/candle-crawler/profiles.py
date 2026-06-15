"""Managed browser profiles for manual Cloudflare/CAPTCHA solving."""

from __future__ import annotations

import asyncio
from pathlib import Path

from crawl4ai import BrowserConfig, BrowserProfiler

from utils import domain_from_url, ensure_dir, slugify


PROFILES_ROOT = Path.home() / ".crawl4ai" / "profiles"


def profile_name_for_domain(domain: str) -> str:
    return f"candle-{slugify(domain)}"


def profile_path_for_url(url: str) -> Path:
    domain = domain_from_url(url)
    return PROFILES_ROOT / profile_name_for_domain(domain)


def profile_browser_config(profile_path: str | Path, *, headless: bool = True) -> BrowserConfig:
    return BrowserConfig(
        headless=headless,
        use_managed_browser=True,
        user_data_dir=str(profile_path),
        browser_type="chromium",
        verbose=False,
    )


async def create_profile_for_url(url: str, *, profile_name: str | None = None) -> Path:
    domain = domain_from_url(url)
    name = profile_name or profile_name_for_domain(domain)
    profiler = BrowserProfiler()
    path = await profiler.create_profile(profile_name=name)
    return Path(path)


async def solve_for_site(url: str) -> Path:
    print(f"Opening browser profile for {domain_from_url(url)}")
    print("Log in / solve Cloudflare or CAPTCHA in the opened browser.")
    print("When finished, return here and press Enter to save the profile.")
    path = await create_profile_for_url(url)
    await asyncio.to_thread(input, "Press Enter when done... ")
    return path


def resolve_profile_path(url: str, explicit: str | None = None) -> Path | None:
    if explicit:
        path = Path(explicit)
        return path if path.exists() else None
    path = profile_path_for_url(url)
    return path if path.exists() else None


def list_profiles() -> list[dict]:
    profiler = BrowserProfiler()
    return profiler.list_profiles()


def ensure_profiles_root() -> Path:
    return ensure_dir(PROFILES_ROOT)
