#!/usr/bin/env bash
# spectra-ux: AI Agent thin wrapper around post-propose-check.sh
# Triggers on Skill PostToolUse when skill == spectra-propose.
# All business logic lives in scripts/spectra-ux/post-propose-check.sh.

set -euo pipefail

INPUT=$(cat)
SKILL=$(echo "$INPUT" | jq -r '.tool_input.skill // ""' 2>/dev/null || echo "")

if [ "$SKILL" != "spectra-propose" ] && [ "$SKILL" != "spectra:propose" ]; then
  exit 0
fi

ROOT="${PROJECT_DIR:-$(pwd)}"
GATE="$ROOT/scripts/spectra-ux/post-propose-check.sh"

if [ -x "$GATE" ]; then
  cd "$ROOT" && exec "$GATE"
fi

exit 0
