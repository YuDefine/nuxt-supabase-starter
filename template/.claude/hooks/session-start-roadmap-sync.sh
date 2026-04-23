#!/usr/bin/env bash
# spectra-ux: Claude Code SessionStart hook — re-sync openspec/ROADMAP.md at
# the start of every session so the agent sees the latest view of in-flight
# spectra work before its first tool call. This is the last line of defense:
# if hooks fire midway (PostToolUse) were missed because /assign delegated
# work to an external runtime (Codex / Claude native subagent / other CLI),
# SessionStart catches up.
#
# v1.6+: script always does a full sync (no mtime fast path). Still fast
# (< 100ms on typical trees). MANUAL-block drift detection runs on every
# invocation and surfaces warnings to stderr so Claude sees stale claims
# (archived-as-active / td-status-mismatch / version-mismatch) at session
# start — stdout is discarded, stderr is preserved.
#
# v1.8+: additionally surfaces follow-up register status (open TD count,
# top-priority items, unregistered markers) to stderr via
# `collect-followups.mts --session-summary`. Silent when nothing to
# report. Always exits 0 — surfacing, not gating.
#
# v1.10+: also surfaces work claims so a new session immediately sees
# who currently owns each active change before it decides what to pick up.
#
# All business logic lives in scripts/spectra-ux/{roadmap-sync,claims-status,collect-followups}.mts.

set -euo pipefail

ROOT="${SPECTRA_UX_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-$(pwd)}}"
ROADMAP_SCRIPT="$ROOT/scripts/spectra-ux/roadmap-sync.mts"
CLAIMS_SCRIPT="$ROOT/scripts/spectra-ux/claims-status.mts"
FOLLOWUPS_SCRIPT="$ROOT/scripts/spectra-ux/collect-followups.mts"

if ! command -v node >/dev/null 2>&1; then
  exit 0
fi

cd "$ROOT" || exit 0

# Roadmap sync: stdout → /dev/null (normal status line is noise); stderr
# passes through so MANUAL drift warnings reach the agent.
if [ -f "$ROADMAP_SCRIPT" ]; then
  node "$ROADMAP_SCRIPT" >/dev/null || true
fi

# Claims surfacing: condensed summary to stderr so the agent sees current
# ownership / stale claims at session start. Silent if there are no claims.
if [ -f "$CLAIMS_SCRIPT" ]; then
  node "$CLAIMS_SCRIPT" --session-summary 1>&2 || true
fi

# Follow-up surfacing: condensed summary to stderr so the agent sees
# open TD and unregistered markers at session start. Silent if clean.
if [ -f "$FOLLOWUPS_SCRIPT" ]; then
  node "$FOLLOWUPS_SCRIPT" --session-summary 1>&2 || true
fi

exit 0
