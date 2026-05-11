#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="${ROOT}/runtime/repos/equium"
BIN_DIR="${ROOT}/runtime/bin"
BIN_PATH="${BIN_DIR}/equium-miner"

mkdir -p "$BIN_DIR" "$(dirname "$REPO_DIR")"

if ! command -v git >/dev/null 2>&1; then
  echo "git is required."
  exit 1
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "Rust cargo is required. Install Rust from https://rustup.rs/ first."
  exit 1
fi

if [ ! -d "$REPO_DIR/.git" ]; then
  echo "Cloning Equium source..."
  git clone https://github.com/HannaPrints/equium.git "$REPO_DIR"
else
  echo "Updating Equium source..."
  git -C "$REPO_DIR" pull --ff-only
fi

echo "Building official Equium CLI miner..."
cargo build --manifest-path "$REPO_DIR/Cargo.toml" -p equium-cli-miner --release

cp "$REPO_DIR/target/release/equium-miner" "$BIN_PATH"
chmod +x "$BIN_PATH"

echo "Built: $BIN_PATH"
echo "Next: npm run equium:run"
