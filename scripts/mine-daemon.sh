#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="${ROOT}/runtime/equium-scheduler.pid"
LOG_FILE="${ROOT}/runtime/equium-scheduler.log"

mkdir -p "${ROOT}/runtime"

is_running() {
  [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" >/dev/null 2>&1
}

case "${1:-start}" in
  start)
    if is_running; then
      echo "Equium scheduler is already running. PID: $(cat "$PID_FILE")"
      exit 0
    fi
    cd "$ROOT"
    nohup node scripts/equium-scheduler.mjs >> "$LOG_FILE" 2>&1 &
    echo "$!" > "$PID_FILE"
    echo "Equium scheduler started. PID: $(cat "$PID_FILE")"
    echo "Logs: npm run mine:logs"
    ;;
  stop)
    if is_running; then
      kill "$(cat "$PID_FILE")"
      rm -f "$PID_FILE"
      echo "Equium scheduler stopped."
    else
      rm -f "$PID_FILE"
      echo "Equium scheduler is not running."
    fi
    ;;
  status)
    if is_running; then
      echo "Equium scheduler is running. PID: $(cat "$PID_FILE")"
    else
      echo "Equium scheduler is not running."
      exit 1
    fi
    ;;
  logs)
    touch "$LOG_FILE"
    tail -f "$LOG_FILE"
    ;;
  *)
    echo "Usage: $0 start|stop|status|logs"
    exit 2
    ;;
esac
