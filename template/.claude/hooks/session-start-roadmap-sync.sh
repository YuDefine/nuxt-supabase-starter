#!/usr/bin/env bash
# spectra-ux: Claude Code SessionStart hook — re-sync openspec/ROADMAP.md at
# the start of every session so the agent sees the latest view of in-flight
# spectra work before its first tool call. This is the last line of defense:
# if hooks fire midway (PostToolUse) were missed because /assign delegated
# work to an external runtime (Codex / Claude native subagent / other CLI),
# SessionStart catches up.
#
# Cheap: runs roadmap-sync.mts with its mtime fast path, so this is ~10ms
# on a clean tree.
#
# All business logic lives in scripts/spectra-ux/roadmap-sync.mts.

set -euo pipefail

ROOT="${SPECTRA_UX_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-$(pwd)}}"
SCRIPT="$ROOT/scripts/spectra-ux/roadmap-sync.mts"

if [ ! -f "$SCRIPT" ]; then
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  exit 0
fi

cd "$ROOT" && node "$SCRIPT" >/dev/null 2>&1 || true

exit 0
