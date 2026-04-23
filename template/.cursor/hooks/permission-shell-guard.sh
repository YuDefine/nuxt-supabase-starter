#!/usr/bin/env bash
set -euo pipefail
INPUT=$(cat)
COMMAND=$(printf '%s' "$INPUT" | jq -r '.command // .tool_input.command // ""' 2>/dev/null || echo "")
if [ -z "$COMMAND" ]; then
  echo '{"permission":"allow"}'
  exit 0
fi
ALLOW_RE='^(ls|wc|node|head|grep|cat|find|tree|echo|sort|jq|curl|test|supabase|pnpm|npx|claude|git|gh)([[:space:]]|$)'
if printf '%s' "$COMMAND" | grep -Eq "$ALLOW_RE"; then
  echo '{"permission":"allow"}'
  exit 0
fi
jq -nc --arg cmd "$COMMAND" '{permission:"ask",user_message:("此 shell 指令不在專案 allow-list：" + $cmd + "\n請確認是否允許執行。"),agent_message:("Blocked by cursor shell permission guard: " + $cmd)}'
