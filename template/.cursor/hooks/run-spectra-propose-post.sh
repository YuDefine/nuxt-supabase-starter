#!/usr/bin/env bash

set -euo pipefail

ROOT="${CURSOR_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-$(pwd)}}"
PAYLOAD=$(jq -nc --arg skill "spectra-propose" --arg args "$*" '{tool_input:{skill:$skill,args:$args}}')

for hook in \
  "$ROOT/.claude/hooks/post-propose-design-inject.sh" \
  "$ROOT/.claude/hooks/post-propose-journey-check.sh"
do
  [ -x "$hook" ] || continue
  printf '%s\n' "$PAYLOAD" | (cd "$ROOT" && "$hook")
done
