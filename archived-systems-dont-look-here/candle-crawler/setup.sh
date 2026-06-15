#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
python3 -m venv .venv
source .venv/bin/activate
pip install -U pip
pip install -r requirements.txt
crawl4ai-setup
echo "Done. Activate with: source .venv/bin/activate"
