#!/usr/bin/env bash
set -euo pipefail
INPUT=$(cat)
TOOL=$(printf '%s' "$INPUT" | jq -r '.toolName // .tool_name // .name // ""' 2>/dev/null || echo "")
SERVER=$(printf '%s' "$INPUT" | jq -r '.server // .mcpServer // ""' 2>/dev/null || echo "")
FULL="$SERVER::$TOOL"
if [ -z "$TOOL" ] && [ -z "$SERVER" ]; then
  echo '{"permission":"allow"}'
  exit 0
fi
case "$FULL" in
  local-supabase::list_tables|local-supabase::list_migrations|local-supabase::execute_sql|local-supabase::search_docs|local-supabase::get_advisors|local-supabase::apply_migration)
    echo '{"permission":"allow"}' ;;
  *)
    jq -nc --arg item "$FULL" '{permission:"ask",user_message:("此 MCP 呼叫不在專案 allow-list：" + $item + "\n請確認是否允許執行。"),agent_message:("Blocked by cursor mcp permission guard: " + $item)}' ;;
esac
