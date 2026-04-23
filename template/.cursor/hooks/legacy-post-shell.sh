#!/usr/bin/env bash
set -euo pipefail
ROOT="${CURSOR_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-$(pwd)}}"
export CLAUDE_PROJECT_DIR="$ROOT"
export CURSOR_PROJECT_DIR="$ROOT"
export PATH="$ROOT/.cursor/hooks/bin:$PATH"
INPUT=$(cat)
COMMAND=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // .command // ""' 2>/dev/null || echo "")
EXIT_CODE=$(printf '%s' "$INPUT" | jq -r '(.tool_output | fromjson? | .exit_code) // (.tool_output | fromjson? | .exitCode) // .tool_output.exit_code // .tool_output.exitCode // .exit_code // .exitCode // 0' 2>/dev/null || echo 0)
LEGACY_JSON=$(jq -nc --arg command "$COMMAND" --argjson exit_code "${EXIT_CODE:-0}" '{tool_input:{command:$command},tool_response:{exit_code:$exit_code}}')
HOOK="$ROOT/.claude/hooks/post-bash-error-debug.sh"
if [ ! -x "$HOOK" ]; then
  echo '{}'
  exit 0
fi
MESSAGE=$(printf '%s
' "$LEGACY_JSON" | (cd "$ROOT" && "$HOOK") 2>&1 || true)
if [ -n "$MESSAGE" ]; then
  jq -nc --arg msg "$MESSAGE" '{agent_message:$msg}'
else
  echo '{}'
fi
