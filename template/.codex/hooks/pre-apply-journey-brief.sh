#!/usr/bin/env bash
# spectra-ux: AI Agent thin wrapper around pre-apply-brief.sh
# Triggers on Skill PreToolUse when skill == spectra-apply.

set -euo pipefail

INPUT=$(cat)
SKILL=$(echo "$INPUT" | jq -r '.tool_input.skill // ""' 2>/dev/null || echo "")

if [ "$SKILL" != "spectra-apply" ] && [ "$SKILL" != "spectra:apply" ]; then
  exit 0
fi

ROOT="${PROJECT_DIR:-$(pwd)}"
GATE="$ROOT/scripts/spectra-ux/pre-apply-brief.sh"

if [ -x "$GATE" ]; then
  CHANGE=$(echo "$INPUT" | jq -r '.tool_input.args // ""' 2>/dev/null | awk '{print $1}')
  cd "$ROOT" && exec "$GATE" "$CHANGE"
fi

exit 0
