#!/usr/bin/env bash
# spectra-ux: Claude Code thin wrapper around design-gate.sh
# Triggers on Skill PreToolUse when skill == spectra-archive.

set -uo pipefail

INPUT=$(cat)
SKILL=$(echo "$INPUT" | jq -r '.tool_input.skill // ""' 2>/dev/null || echo "")

if [ "$SKILL" != "spectra-archive" ] && [ "$SKILL" != "spectra:archive" ]; then
  exit 0
fi

ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
SCRIPT="$ROOT/scripts/spectra-ux/design-gate.sh"

if [ ! -x "$SCRIPT" ]; then
  exit 0
fi

CHANGE=$(echo "$INPUT" | jq -r '.tool_input.args // ""' 2>/dev/null | awk '{print $1}')

cd "$ROOT" && "$SCRIPT" "$CHANGE"
exit $?
