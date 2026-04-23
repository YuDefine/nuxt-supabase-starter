#!/usr/bin/env bash
set -euo pipefail
ROOT="${CURSOR_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-$(pwd)}}"
export CLAUDE_PROJECT_DIR="$ROOT"
export CURSOR_PROJECT_DIR="$ROOT"
export PATH="$ROOT/.cursor/hooks/bin:$PATH"
INPUT=$(cat)
FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.file_path // .tool_input.file_path // ""' 2>/dev/null || echo "")
LEGACY_JSON=$(jq -nc --arg file_path "$FILE_PATH" '{tool_input:{file_path:$file_path},tool_response:{filePath:$file_path}}')
MESSAGES=()
run_legacy_hook() {
  local hook_path="$1"
  [ -x "$hook_path" ] || return 0
  local output
  output=$(printf '%s
' "$LEGACY_JSON" | (cd "$ROOT" && "$hook_path") 2>&1 || true)
  if [ -n "$output" ]; then
    MESSAGES+=("$output")
  fi
}
run_legacy_hook "$ROOT/.claude/hooks/post-edit-typecheck.sh"
run_legacy_hook "$ROOT/.claude/hooks/post-edit-ui-qa.sh"
run_legacy_hook "$ROOT/.claude/hooks/post-edit-roadmap-sync.sh"
if [ "${#MESSAGES[@]}" -gt 0 ]; then
  MESSAGE=$(printf '%s

' "${MESSAGES[@]}")
  jq -nc --arg msg "$MESSAGE" '{agent_message:$msg}'
else
  echo '{}'
fi
