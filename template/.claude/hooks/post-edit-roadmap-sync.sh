#!/usr/bin/env bash
# spectra-ux: Claude Code PostToolUse hook (Edit|Write) — keep claims and
# openspec/ROADMAP.md in sync.
#
# Behaviour:
#   1. Try to heartbeat any existing claim owned by the current session.
#   2. Re-sync openspec/ROADMAP.md if either:
#      - the edited path is under openspec/changes/, or
#      - a claim heartbeat was refreshed.
#
# Note: external runtimes (Codex CLI, Copilot CLI) won't trigger it — that's
# what SessionStart and the manual `pnpm spectra:roadmap` /
# `pnpm spectra:claims` calls after /assign are for.
#
# All business logic lives in scripts/spectra-ux/{claim-work,roadmap-sync}.mts.

set -euo pipefail

INPUT=$(cat)
PATH_ARG=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""' 2>/dev/null || echo "")

if [ -z "$PATH_ARG" ]; then
  exit 0
fi

ROOT="${SPECTRA_UX_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-$(pwd)}}"
CLAIM_SCRIPT="$ROOT/scripts/spectra-ux/claim-work.mts"
SCRIPT="$ROOT/scripts/spectra-ux/roadmap-sync.mts"

if ! command -v node >/dev/null 2>&1; then
  exit 0
fi

CLAIM_UPDATED=0
if [ -f "$CLAIM_SCRIPT" ]; then
  HEARTBEAT_OUTPUT=$(cd "$ROOT" && SPECTRA_UX_CLAIM_ALLOW_FALLBACK=0 node "$CLAIM_SCRIPT" --heartbeat-from-path "$PATH_ARG" 2>/dev/null || true)
  if [ "$HEARTBEAT_OUTPUT" = "updated" ]; then
    CLAIM_UPDATED=1
  fi
fi

case "$PATH_ARG" in
  */openspec/changes/*|openspec/changes/*) SHOULD_SYNC=1 ;;
  *) SHOULD_SYNC=$CLAIM_UPDATED ;;
esac

if [ "${SHOULD_SYNC:-0}" -ne 1 ]; then
  exit 0
fi

if [ ! -f "$SCRIPT" ]; then
  exit 0
fi

# stdout → /dev/null (status line is noise); stderr passes through so roadmap
# drift warnings reach the agent immediately after relevant edits / heartbeats.
cd "$ROOT" && node "$SCRIPT" >/dev/null || true

exit 0
