#!/usr/bin/env bash
# spectra-ux: Claude Code thin wrapper around design-inject.sh
# Triggers on Skill PostToolUse when skill == spectra-propose.

set -euo pipefail

INPUT=$(cat)
SKILL=$(echo "$INPUT" | jq -r '.tool_input.skill // ""' 2>/dev/null || echo "")

if [ "$SKILL" != "spectra-propose" ] && [ "$SKILL" != "spectra:propose" ]; then
  exit 0
fi

ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
SCRIPT="$ROOT/scripts/spectra-ux/design-inject.sh"
CHANGE=$(echo "$INPUT" | jq -r '.tool_input.args // ""' 2>/dev/null | awk '{print $1}')

if [ -x "$SCRIPT" ]; then
  cd "$ROOT" && exec "$SCRIPT" "$CHANGE"
fi

exit 0
