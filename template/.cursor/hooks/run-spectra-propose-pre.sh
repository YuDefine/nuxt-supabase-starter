#!/usr/bin/env bash

set -euo pipefail

ROOT="${CURSOR_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-$(pwd)}}"
HOOK="$ROOT/.claude/hooks/pre-propose-ux-scan.sh"

if [ ! -x "$HOOK" ]; then
  exit 0
fi

PAYLOAD=$(jq -nc --arg skill "spectra-propose" --arg args "$*" '{tool_input:{skill:$skill,args:$args}}')
printf '%s\n' "$PAYLOAD" | (cd "$ROOT" && "$HOOK")
