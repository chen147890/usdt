#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ ! -f ".env" ] && [ -f ".env.example" ]; then
  cp .env.example .env
fi

echo "Starting Universal PoW Miner on macOS..."
echo "Open: http://127.0.0.1:${PORT:-8088}"
node server.mjs
