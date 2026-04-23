#!/usr/bin/env bash
# spectra-ux v1.5+: Claude Code thin wrapper around followup-gate.sh
# Triggers on Skill PreToolUse when skill == spectra-archive.
#
# Supplementary gate — runs alongside design-gate and ux-gate.
# All must pass for archive to proceed.

set -uo pipefail

INPUT=$(cat)
SKILL=$(echo "$INPUT" | jq -r '.tool_input.skill // ""' 2>/dev/null || echo "")

if [ "$SKILL" != "spectra-archive" ] && [ "$SKILL" != "spectra:archive" ]; then
  exit 0
fi

ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
GATE="$ROOT/scripts/spectra-ux/followup-gate.sh"

if [ ! -x "$GATE" ]; then
  exit 0
fi

CHANGE=$(echo "$INPUT" | jq -r '.tool_input.args // ""' 2>/dev/null | awk '{print $1}')

cd "$ROOT" && "$GATE" "$CHANGE"
exit $?
