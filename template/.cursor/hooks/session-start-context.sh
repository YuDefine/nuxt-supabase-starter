#!/usr/bin/env bash

set -euo pipefail

ROOT="${CURSOR_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-$(pwd)}}"
HOOK="$ROOT/.claude/hooks/session-start-roadmap-sync.sh"

if [ ! -x "$HOOK" ]; then
  echo '{}'
  exit 0
fi

OUTPUT=$(cd "$ROOT" && "$HOOK" 2>&1 || true)
if [ -n "$OUTPUT" ]; then
  jq -nc --arg ctx "$OUTPUT" '{additional_context: $ctx}'
else
  echo '{}'
fi
