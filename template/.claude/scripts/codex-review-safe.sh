#!/usr/bin/env bash
# codex-review-safe.sh — codex review wrapper that survives MCP hangs
#
# Why: `codex review --uncommitted` loads MCP servers from ~/.codex/config.toml
# at startup. If any MCP (e.g. codebase-memory-mcp) hangs on a tool call, codex
# review dies with no actionable output. `-c mcp_servers={}` does NOT clear the
# nested TOML table (codex merges instead of replacing).
#
# Workaround: temporarily move ~/.codex/config.toml aside, run codex review
# without MCP, restore config via trap EXIT (survives SIGTERM / SIGINT / 正常結束).
#
# Usage:
#   .claude/scripts/codex-review-safe.sh [reasoning_effort] [extra codex args...]
#
# Default reasoning_effort = high. Pass `xhigh` for Round 2.
#
# Exit code: passes through codex review's exit code.

set -uo pipefail

REASONING="${1:-high}"
shift || true  # tolerate no args after reasoning

CONFIG="$HOME/.codex/config.toml"
BACKUP="$CONFIG.review-wrapper-bak-$$"
RESTORED=0

# trap doesn't fire under SIGKILL, leaving *.review-wrapper-bak-<pid> behind
# and the user with no codex config. Reclaim before moving our own.
for stale in "$CONFIG".review-wrapper-bak-*; do
  [[ -e "$stale" ]] || continue
  stale_pid="${stale##*-}"
  [[ "$stale_pid" =~ ^[0-9]+$ ]] || continue
  kill -0 "$stale_pid" 2>/dev/null && continue
  if [[ ! -f "$CONFIG" ]]; then
    mv "$stale" "$CONFIG"
    echo "[codex-review-safe] ✓ recovered config from dead PID $stale_pid" >&2
  else
    rm -f "$stale"
    echo "[codex-review-safe] ✓ removed stale backup from dead PID $stale_pid" >&2
  fi
done

cleanup() {
  if [[ "$RESTORED" -eq 0 && -f "$BACKUP" ]]; then
    mv "$BACKUP" "$CONFIG"
    RESTORED=1
    echo "[codex-review-safe] ✓ config restored" >&2
  fi
}
trap cleanup EXIT INT TERM HUP

if [[ -f "$CONFIG" ]]; then
  mv "$CONFIG" "$BACKUP"
else
  echo "[codex-review-safe] no config at $CONFIG, skipping backup" >&2
fi

codex review --uncommitted \
  -c model="gpt-5.5" \
  -c model_reasoning_effort="$REASONING" \
  "$@"
