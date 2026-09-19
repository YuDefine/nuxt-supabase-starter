#!/usr/bin/env bash
# clade — 寫完一段 always-load 措辭的當下，就地報「本次淨增 N bytes、剩餘 headroom M」。
#
# 為什麼是 PostToolUse 而不是只有 publish gate：判定器（audit-always-load-budget.ts）早就
# 存在，但它只在 publish 跑。2026-08-29 同一天兩個 lane 各推爆一次 budget，兩人都是
# publish 被擋才知道，而修法（壓縮措辭 / 走 raise-log 例外）需要的判斷跟寫規約當下是同一個。
# 形狀抄 post-edit-shell-safety.sh —— 那支正是為了同一個理由存在（TD-788）。
#
# warn-only：印到 stderr、一律 exit 0。NEVER 改成 exit 2 擋下 Edit —— 寫到一半本來就會超標，
# 擋住編輯是錯的施力點。
#
# 判準 SoT 在 scripts/always-load-budget-delta.ts（clade home only）。consumer 端沒有
# rules/core/ 源檔，路徑不可能命中，找不到 script 時直接靜默退出。

set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_response.filePath // ""' 2>/dev/null || echo "")

[ -z "$FILE_PATH" ] && exit 0
case "$FILE_PATH" in
  *.md) ;;
  *) exit 0 ;;
esac
case "$FILE_PATH" in
  */rules/core/*|*/rules/modules/*|*/claude-md/core-snippets/*) ;;
  rules/core/*|rules/modules/*|claude-md/core-snippets/*) ;;
  *) exit 0 ;;
esac

ROOT="${CLADE_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-$(pwd)}}"
CHECK="$ROOT/scripts/always-load-budget-delta.ts"
[ -f "$CHECK" ] || exit 0

node "$CHECK" "$FILE_PATH" >&2 || true
exit 0
