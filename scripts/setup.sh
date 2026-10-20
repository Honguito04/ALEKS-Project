#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
python3 -m venv .venv
PIP_CACHE_DIR=/tmp/aleks-pip-cache .venv/bin/python -m pip install -r backend/requirements.lock
npm ci --cache /tmp/aleks-npm-cache --no-audit --no-fund
if [ ! -f .env ]; then cp .env.example .env; fi
npm run build
