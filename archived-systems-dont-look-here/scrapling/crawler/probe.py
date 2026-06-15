"""Lightweight site fingerprinting: detect platform + protection before crawling.

A cheap HTTP probe is sent before the heavy crawl so the orchestrator can branch
technique per site (Shopify JSON API vs browser) and toggle expensive browser
features (Cloudflare solving, network-idle waits) only when they're actually needed.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

import httpx

PROBE_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

# Markers that indicate an *active* Cloudflare challenge/interstitial (not just
# a site served through the Cloudflare CDN, which is harmless and very common).
_CF_CHALLENGE_MARKERS = (
    "just a moment",
    "challenges.cloudflare.com",
    "__cf_chl",
    "_cf_chl_opt",
    "cf-browser-verification",
    "cf_chl_",
)

_SHOPIFY_BODY_MARKERS = (
    "cdn.shopify.com",
    "/cdn/shop/",
    "shopify-section",
    "window.shopify",
    "shopify.theme",
)

# Markers for non-Cloudflare bot management (PerimeterX, DataDome, Akamai, etc.)
_BOT_WALL_MARKERS = (
    ("perimeterx", ("_pxappid", "perimeterx", "px-captcha", "window._px")),
    ("datadome", ("datadome", "dd.js", "dd-cid")),
    ("akamai", ("akamai", "akam/13", "_abck", "akamai bot manager")),
)


@dataclass
class SiteProbe:
    url: str
    origin: str
    reachable: bool = False
    status_code: int | None = None
    is_shopify: bool = False
    is_cloudflare: bool = False  # served via the Cloudflare CDN (benign)
    is_cloudflare_protected: bool = False  # active challenge that needs solving
    bot_protection: str | None = None  # e.g. perimeterx, datadome, akamai
    currency: str | None = None
    myshopify_domain: str | None = None
    products_endpoint: str | None = None
    detail: dict[str, Any] = field(default_factory=dict)

    def summary(self) -> dict[str, Any]:
        return {
            "url": self.url,
            "origin": self.origin,
            "reachable": self.reachable,
            "status_code": self.status_code,
            "is_shopify": self.is_shopify,
            "is_cloudflare": self.is_cloudflare,
            "is_cloudflare_protected": self.is_cloudflare_protected,
            "bot_protection": self.bot_protection,
            "currency": self.currency,
            "myshopify_domain": self.myshopify_domain,
            "products_endpoint": self.products_endpoint,
            "detail": self.detail,
        }

    @property
    def technique(self) -> str:
        if self.is_shopify and not self.is_cloudflare_protected:
            return "shopify_api"
        return "browser"


def site_origin(url: str) -> str:
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}"


def _detect_cloudflare_challenge(headers: httpx.Headers, status_code: int, body_lower: str) -> bool:
    if headers.get("cf-mitigated", "").lower() == "challenge":
        return True
    if any(marker in body_lower for marker in _CF_CHALLENGE_MARKERS):
        # On a 200 these markers can appear inside benign analytics bundles, so
        # only trust them on challenge-style status codes or the explicit title.
        if status_code in (401, 403, 429, 503) or "just a moment" in body_lower:
            return True
    return False


def _detect_shopify(headers: httpx.Headers, body_lower: str) -> bool:
    if "shopify" in headers.get("powered-by", "").lower():
        return True
    if "x-shopify-stage" in headers or "x-sorting-hat-shopid" in headers or "x-shopid" in headers:
        return True
    if "_shopify_" in headers.get("set-cookie", "").lower():
        return True
    return any(marker in body_lower for marker in _SHOPIFY_BODY_MARKERS)


def _detect_bot_protection(status_code: int, body_lower: str) -> str | None:
    for vendor, markers in _BOT_WALL_MARKERS:
        if any(marker in body_lower for marker in markers):
            if status_code in (401, 403, 429, 503):
                return vendor
            if vendor == "perimeterx" and ("px-captcha" in body_lower or "access to this page has been denied" in body_lower):
                return vendor
            if vendor == "datadome" and "datadome" in body_lower and status_code != 200:
                return vendor
    return None


def probe_site(url: str, *, timeout: float = 15.0) -> SiteProbe:
    """Fetch a site once over plain HTTP and fingerprint platform + protection."""
    origin = site_origin(url)
    probe = SiteProbe(url=url, origin=origin)
    request_headers = {
        "User-Agent": PROBE_USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }

    try:
        with httpx.Client(
            follow_redirects=True,
            timeout=timeout,
            headers=request_headers,
        ) as client:
            response = client.get(url)
            probe.reachable = True
            probe.status_code = response.status_code

            headers = response.headers
            body_lower = (response.text or "")[:20_000].lower()

            probe.is_cloudflare = "cf-ray" in headers or headers.get("server", "").lower() == "cloudflare"
            probe.is_cloudflare_protected = _detect_cloudflare_challenge(
                headers, response.status_code, body_lower
            )
            probe.bot_protection = _detect_bot_protection(response.status_code, body_lower)
            if probe.bot_protection:
                probe.detail["bot_protection_reason"] = (
                    f"bot protection suspected ({probe.bot_protection})"
                )

            shopify_hint = _detect_shopify(headers, body_lower)
            if shopify_hint and not probe.is_cloudflare_protected:
                _confirm_shopify(client, probe)
            elif shopify_hint:
                # Behind a challenge: trust the hint but we can't confirm cheaply.
                probe.is_shopify = True
    except Exception as exc:  # noqa: BLE001 - probe must never raise into the crawl
        probe.detail["error"] = f"{type(exc).__name__}: {exc}"
        # A hard failure on a plain request often means bot protection; let the
        # browser path try with Cloudflare solving enabled.
        probe.is_cloudflare_protected = True

    return probe


def _confirm_shopify(client: httpx.Client, probe: SiteProbe) -> None:
    """Confirm a Shopify storefront and capture currency via public endpoints."""
    products_url = f"{probe.origin}/products.json?limit=1"
    try:
        products = client.get(products_url)
        if products.status_code == 200 and isinstance(products.json().get("products"), list):
            probe.is_shopify = True
            probe.products_endpoint = f"{probe.origin}/products.json"
    except Exception as exc:  # noqa: BLE001
        probe.detail["products_json_error"] = f"{type(exc).__name__}: {exc}"

    if not probe.is_shopify:
        return

    try:
        meta = client.get(f"{probe.origin}/meta.json")
        if meta.status_code == 200:
            data = meta.json()
            probe.currency = data.get("currency")
            probe.myshopify_domain = data.get("myshopify_domain")
    except Exception as exc:  # noqa: BLE001
        probe.detail["meta_json_error"] = f"{type(exc).__name__}: {exc}"
