#!/usr/bin/env bash
# spectra-ux: AI Agent thin wrapper around pre-propose-scan.sh
# Triggers on Skill PreToolUse when skill == spectra-propose.
# All business logic lives in scripts/spectra-ux/pre-propose-scan.sh.

set -euo pipefail

INPUT=$(cat)
SKILL=$(echo "$INPUT" | jq -r '.tool_input.skill // ""' 2>/dev/null || echo "")

if [ "$SKILL" != "spectra-propose" ] && [ "$SKILL" != "spectra:propose" ]; then
  exit 0
fi

ROOT="${PROJECT_DIR:-$(pwd)}"
GATE="$ROOT/scripts/spectra-ux/pre-propose-scan.sh"

if [ -x "$GATE" ]; then
  exec "$GATE"
fi

exit 0
