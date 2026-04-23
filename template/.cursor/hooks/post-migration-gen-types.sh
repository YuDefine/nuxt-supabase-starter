#!/usr/bin/env bash

set -euo pipefail

ROOT="${CURSOR_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-$(pwd)}}"
HOOK="$ROOT/.claude/hooks/post-migration-gen-types.sh"

if [ ! -x "$HOOK" ]; then
  echo '{}'
  exit 0
fi

MESSAGE=$(cd "$ROOT" && "$HOOK" 2>&1 || true)
if [ -n "$MESSAGE" ]; then
  jq -nc --arg msg "$MESSAGE" '{agent_message: $msg}'
else
  echo '{}'
fi
