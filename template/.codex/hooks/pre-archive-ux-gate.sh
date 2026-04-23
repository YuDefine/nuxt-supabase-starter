#!/usr/bin/env bash
# spectra-ux: AI Agent thin wrapper around archive-gate.sh
# Triggers on Skill PreToolUse when skill == spectra-archive.
#
# This is a SUPPLEMENTARY gate — it runs alongside any existing
# pre-archive-review-check.sh (e.g. spectra's own design gate). Both
# must pass for archive to proceed.

set -uo pipefail

INPUT=$(cat)
SKILL=$(echo "$INPUT" | jq -r '.tool_input.skill // ""' 2>/dev/null || echo "")

if [ "$SKILL" != "spectra-archive" ] && [ "$SKILL" != "spectra:archive" ]; then
  exit 0
fi

ROOT="${PROJECT_DIR:-$(pwd)}"
GATE="$ROOT/scripts/spectra-ux/archive-gate.sh"

if [ ! -x "$GATE" ]; then
  exit 0
fi

CHANGE=$(echo "$INPUT" | jq -r '.tool_input.args // ""' 2>/dev/null | awk '{print $1}')

cd "$ROOT" && "$GATE" "$CHANGE"
exit $?
