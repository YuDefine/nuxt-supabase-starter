#!/usr/bin/env bash
# codex-review-safe.sh — codex review wrapper that survives MCP hangs
#
# Why: `codex review --uncommitted` loads MCP servers from ~/.codex/config.toml
# at startup. If any MCP (e.g. codebase-memory-mcp) hangs on a tool call, codex
# review dies with no actionable output. `-c mcp_servers={}` does NOT clear the
# nested TOML table (codex merges instead of replacing).
#
# Strategy: build a shadow CODEX_HOME via symlinks so codex review still sees
# auth / plugins / memories / cache / sessions / hooks shared with ~/.codex,
# but write a sanitized `config.toml` copy that drops every [mcp_servers.*]
# section. The real ~/.codex/config.toml is never moved or rewritten, so
# user-managed keys (e.g. [features].goals = true) survive even if this
# wrapper dies under SIGKILL or system reboot.
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

REAL_HOME="$HOME/.codex"
REAL_CONFIG="$REAL_HOME/config.toml"

if [[ ! -d "$REAL_HOME" ]]; then
  echo "[codex-review-safe] $REAL_HOME does not exist" >&2
  exit 1
fi

# Reclaim leftover shadow dirs from dead PIDs (defensive — mktemp dirs are
# normally cleaned up by trap, but SIGKILL / reboot can leave them behind).
for stale in "${TMPDIR:-/tmp}"/codex-review-shadow.*; do
  [[ -d "$stale" ]] || continue
  stale_pid="${stale##*.}"
  [[ "$stale_pid" =~ ^[0-9]+$ ]] || { rm -rf "$stale" 2>/dev/null; continue; }
  kill -0 "$stale_pid" 2>/dev/null && continue
  rm -rf "$stale" 2>/dev/null
done

SHADOW=$(mktemp -d -t "codex-review-shadow.$$.XXXXXX")
trap 'rm -rf "$SHADOW"' EXIT INT TERM HUP

# Mirror every entry from ~/.codex into the shadow via symlinks (visible files
# + dotfiles, but never `.` / `..`). codex_review still reads/writes through
# these into the real ~/.codex, so sessions / cache / memories are preserved.
# config.toml is the only file we materialize as a real (sanitized) copy.
shopt -s nullglob
for entry in "$REAL_HOME"/* "$REAL_HOME"/.[!.]* "$REAL_HOME"/..?*; do
  [[ -e "$entry" ]] || continue
  name=$(basename "$entry")
  [[ "$name" == "config.toml" ]] && continue
  ln -s "$entry" "$SHADOW/$name"
done
shopt -u nullglob

# Sanitized config: drop every [mcp_servers] / [mcp_servers.*] section, keep
# everything else (model, personality, [features], [plugins.*], [projects.*],
# [tui], [marketplaces.*], etc.). codex writes table headers at column 0, so
# matching `^[mcp_servers]` / `^[mcp_servers.` is sufficient.
if [[ -f "$REAL_CONFIG" ]]; then
  awk '
    /^\[mcp_servers[].]/ { in_mcp = 1; next }
    /^\[/ { in_mcp = 0 }
    !in_mcp { print }
  ' "$REAL_CONFIG" > "$SHADOW/config.toml"
else
  echo "[codex-review-safe] no config at $REAL_CONFIG, running with empty config" >&2
  : > "$SHADOW/config.toml"
fi

CODEX_HOME="$SHADOW" codex review --uncommitted \
  -c model="gpt-5.5" \
  -c model_reasoning_effort="$REASONING" \
  "$@"
