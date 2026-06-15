#!/usr/bin/env python3
"""CLI entrypoint for the candle crawl4ai pipeline."""

from __future__ import annotations

import asyncio

from pipeline import main_async


if __name__ == "__main__":
    asyncio.run(main_async())
