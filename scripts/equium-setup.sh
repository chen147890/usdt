#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="${ROOT}/runtime/repos/equium"
BIN_DIR="${ROOT}/runtime/bin"
BIN_PATH="${BIN_DIR}/equium-miner"
SOURCE_URL="${EQUIUM_SOURCE_URL:-https://github.com/HannaPrints/equium.git}"
ARCHIVE_URL="${EQUIUM_ARCHIVE_URL:-https://github.com/HannaPrints/equium/archive/refs/heads/master.tar.gz}"

mkdir -p "$BIN_DIR" "$(dirname "$REPO_DIR")"

if ! command -v git >/dev/null 2>&1; then
  echo "git is required."
  exit 1
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "Rust cargo is required. Install Rust from https://rustup.rs/ first."
  exit 1
fi

clone_source() {
  echo "Cloning Equium source..."
  GIT_TERMINAL_PROMPT=0 git \
    -c http.lowSpeedLimit=1000 \
    -c http.lowSpeedTime=30 \
    clone --depth 1 "$SOURCE_URL" "$REPO_DIR"
}

download_source_archive() {
  if ! command -v curl >/dev/null 2>&1; then
    echo "curl is required when git clone is unavailable or too slow."
    exit 1
  fi

  local tmp archive
  tmp="$(mktemp -d)"
  archive="${tmp}/equium.tar.gz"
  trap 'rm -rf "$tmp"' RETURN

  echo "Downloading Equium source archive..."
  curl --fail --location --retry 3 --connect-timeout 20 --max-time 300 \
    "$ARCHIVE_URL" \
    --output "$archive"

  rm -rf "$REPO_DIR"
  mkdir -p "$REPO_DIR"
  tar -xzf "$archive" --strip-components 1 -C "$REPO_DIR"
}

if [ -d "$REPO_DIR/.git" ]; then
  echo "Updating Equium source..."
  GIT_TERMINAL_PROMPT=0 git -C "$REPO_DIR" \
    -c http.lowSpeedLimit=1000 \
    -c http.lowSpeedTime=30 \
    pull --ff-only || {
      echo "Git update failed; falling back to source archive."
      download_source_archive
    }
elif [ -f "$REPO_DIR/Cargo.toml" ]; then
  echo "Using existing Equium source: $REPO_DIR"
else
  rm -rf "$REPO_DIR"
  clone_source || {
    echo "Git clone failed or timed out; falling back to source archive."
    download_source_archive
  }
fi

echo "Building official Equium CLI miner..."
cargo build --manifest-path "$REPO_DIR/Cargo.toml" -p equium-cli-miner --release

cp "$REPO_DIR/target/release/equium-miner" "$BIN_PATH"
chmod +x "$BIN_PATH"

echo "Built: $BIN_PATH"
echo "Next: npm run equium:run"
