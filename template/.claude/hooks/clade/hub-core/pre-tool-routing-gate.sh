#!/usr/bin/env bash
# UserPromptSubmit / PreToolUse bridge to the canonical clade routing gate.
# Missing central clade is deployment skew, so bootstrap fails open; once the helper runs,
# its state/receipt failures retain their authoritative exit status.

set -uo pipefail

MODE=${1:-}
case "$MODE" in
  user-prompt | pre-tool) ;;
  *) exit 0 ;;
esac

# Cursor loads this Claude Code plugin hook, but Cursor routing is User Rules + optional
# Pi dispatch — not this latch. Predicate MUST match vendor/scripts/lib/cursor-session.ts
# (CURSOR_AGENT / CONVERSATION / SESSION / TRACE). Cursor shells do not export
# CLAUDE_CODE_SESSION_ID, so minting a pending decision deadlocks the session.
# Tests that spawn this wrapper MUST unset every Cursor probe to exercise the helper path.
#
# Contract (SoT for the Cursor half; rules/core/agent-routing.md § Cursor 環境的 browser 載體
# points here). Clade routing gate / Pi handshake NEVER blocks a Cursor main thread from
# calling cursor-ide-browser:
#   1. On a Cursor session, mint no Claude-Code decision at all (the early exit above).
#   2. The browser_* and CallDynamicTool namespaces are always exempt from the Pi
#      read-heavy-scan latch, Cursor or not.
#   3. waive / dispatch --decision-id / fallback MUST run to completion with no
#      CLAUDE_CODE_SESSION_ID in the environment.
# Pinned by test/pi-routing-gate.test.ts and test/cursor-session.test.ts.
is_cursor_session() {
  [[ "${CURSOR_AGENT:-}" == "1" ]] && return 0
  [[ -n "${CLAUDE_CODE_SESSION_ID:-}" ]] && return 1
  [[ -n "${CURSOR_CONVERSATION_ID:-}" || -n "${CURSOR_SESSION_ID:-}" || -n "${CURSOR_TRACE_ID:-}" ]]
}
if is_cursor_session; then
  cat >/dev/null
  exit 0
fi

INPUT=$(cat)

find_clade_root() {
  if [[ -n "${CLADE_HOME:-}" && -f "$CLADE_HOME/registry/consumers.json" ]]; then
    printf '%s\n' "$CLADE_HOME"
    return 0
  fi
  for candidate in "$HOME/clade" "$HOME/offline/clade"; do
    if [[ -f "$candidate/registry/consumers.json" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

CLADE_ROOT=$(find_clade_root) || {
  printf 'routing gate: central clade not found; fail-open\n' >&2
  exit 0
}
HELPER="$CLADE_ROOT/vendor/scripts/pi-routing-gate.ts"
if [[ ! -f "$HELPER" ]]; then
  printf 'routing gate: helper not installed; fail-open\n' >&2
  exit 0
fi

printf '%s' "$INPUT" | node "$HELPER" "$MODE"
