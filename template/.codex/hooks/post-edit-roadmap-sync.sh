#!/usr/bin/env bash
# spectra-ux: AI Agent PostToolUse hook (Edit|Write) — re-sync
# openspec/ROADMAP.md whenever a file under openspec/changes/ was touched.
# Narrowly scoped to avoid noise on every single edit.
#
# Note: this only fires for in-session AI Agent edits. External runtimes
# outside Claude's native hook loop won't trigger it — that's what SessionStart is
# for, and what the manual `pnpm spectra:roadmap` call after /assign
# is for.
#
# All business logic lives in scripts/spectra-ux/roadmap-sync.mts.

set -euo pipefail

INPUT=$(cat)
PATH_ARG=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""' 2>/dev/null || echo "")

if [ -z "$PATH_ARG" ]; then
  exit 0
fi

# Only fire for edits inside openspec/changes/
case "$PATH_ARG" in
  */openspec/changes/*) ;;
  openspec/changes/*) ;;
  *) exit 0 ;;
esac

ROOT="${SPECTRA_UX_PROJECT_DIR:-${PROJECT_DIR:-$(pwd)}}"
SCRIPT="$ROOT/scripts/spectra-ux/roadmap-sync.mts"

if [ ! -f "$SCRIPT" ]; then
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  exit 0
fi

cd "$ROOT" && node "$SCRIPT" >/dev/null 2>&1 || true

exit 0
