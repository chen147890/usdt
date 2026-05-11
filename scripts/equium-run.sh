#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT}/.env"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

BIN="${EQUIUM_MINER_BIN:-${ROOT}/runtime/bin/equium-miner}"
RPC_URL="${SOLANA_RPC_URL:-https://api.mainnet-beta.solana.com}"
KEYPAIR="${SOLANA_KEYPAIR:-${HOME}/.config/solana/id.json}"
MAX_BLOCKS="${EQUIUM_MAX_BLOCKS:-0}"
MAX_NONCES="${EQUIUM_MAX_NONCES_PER_ROUND:-4096}"

logical_cores() {
  if command -v nproc >/dev/null 2>&1; then
    nproc
  elif command -v sysctl >/dev/null 2>&1; then
    sysctl -n hw.logicalcpu
  else
    echo 1
  fi
}

total_mem_mb() {
  if command -v getconf >/dev/null 2>&1; then
    local pages page_size
    pages="$(getconf _PHYS_PAGES 2>/dev/null || echo 0)"
    page_size="$(getconf PAGE_SIZE 2>/dev/null || echo 0)"
    if [ "$pages" != "0" ] && [ "$page_size" != "0" ]; then
      echo $(( pages * page_size / 1024 / 1024 ))
      return
    fi
  fi
  if command -v sysctl >/dev/null 2>&1; then
    echo $(( $(sysctl -n hw.memsize) / 1024 / 1024 ))
    return
  fi
  echo 1024
}

auto_threads() {
  local cores mem by_mem
  cores="$(logical_cores)"
  mem="$(total_mem_mb)"
  by_mem="$(( mem * 70 / 100 / 64 ))"
  if [ "$by_mem" -lt 1 ]; then by_mem=1; fi
  if [ "$cores" -lt "$by_mem" ]; then
    echo "$cores"
  else
    echo "$by_mem"
  fi
}

THREADS="${EQUIUM_THREADS:-auto}"
if [ "$THREADS" = "auto" ]; then
  THREADS="$(auto_threads)"
fi

if [ ! -x "$BIN" ]; then
  echo "Missing Equium miner binary: $BIN"
  echo "Run first: npm run equium:setup"
  exit 1
fi

if [ ! -f "$KEYPAIR" ]; then
  echo "Missing Solana keypair: $KEYPAIR"
  echo "Create one with: solana-keygen new -o \"$KEYPAIR\""
  exit 1
fi

echo "Equium miner"
echo "  RPC:      $RPC_URL"
echo "  Keypair:  $KEYPAIR"
echo "  Threads:  $THREADS"
echo "  Nonces:   $MAX_NONCES per thread per round"

ARGS=(
  --rpc-url "$RPC_URL"
  --keypair "$KEYPAIR"
  --threads "$THREADS"
  --max-nonces-per-round "$MAX_NONCES"
)

if [ "$MAX_BLOCKS" != "0" ]; then
  ARGS+=(--max-blocks "$MAX_BLOCKS")
fi

exec "$BIN" "${ARGS[@]}"
