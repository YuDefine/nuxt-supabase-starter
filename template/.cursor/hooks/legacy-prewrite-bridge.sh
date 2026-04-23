#!/usr/bin/env bash
set -euo pipefail
ROOT="${CURSOR_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-$(pwd)}}"
export CLAUDE_PROJECT_DIR="$ROOT"
export CURSOR_PROJECT_DIR="$ROOT"
export PATH="$ROOT/.cursor/hooks/bin:$PATH"
INPUT=$(cat)
FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // .file_path // ""' 2>/dev/null || echo "")
LEGACY_JSON=$(jq -nc --arg file_path "$FILE_PATH" '{"tool_input":{"file_path":$file_path}}')
KNOWLEDGE_HOOK="$ROOT/.claude/hooks/knowledge-search-reminder.sh"
GUARD_SCRIPT="$ROOT/.claude/scripts/guard-check.mjs"
REMINDER=""
if [ -x "$KNOWLEDGE_HOOK" ]; then
  REMINDER=$(printf '%s
' "$LEGACY_JSON" | (cd "$ROOT" && "$KNOWLEDGE_HOOK") 2>&1 || true)
fi
if [ -f "$GUARD_SCRIPT" ]; then
  GUARD_OUTPUT=$(printf '%s
' "$LEGACY_JSON" | (cd "$ROOT" && node "$GUARD_SCRIPT") 2>&1) || GUARD_STATUS=$?
  GUARD_STATUS=${GUARD_STATUS:-0}
  if [ "$GUARD_STATUS" -eq 2 ]; then
    MESSAGE=$(printf '%s
' "$GUARD_OUTPUT" | jq -r '.error // .user_message // .message // empty' 2>/dev/null || true)
    [ -z "$MESSAGE" ] && MESSAGE="$GUARD_OUTPUT"
    jq -nc --arg msg "$MESSAGE" '{continue:true,permission:"deny",user_message:$msg,agent_message:$msg}'
    exit 2
  fi
fi
if [ -n "$REMINDER" ]; then
  jq -nc --arg msg "$REMINDER" '{continue:true,permission:"allow",agent_message:$msg}'
else
  echo '{}'
fi
