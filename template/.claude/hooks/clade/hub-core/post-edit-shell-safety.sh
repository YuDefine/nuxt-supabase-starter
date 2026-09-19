#!/usr/bin/env bash
# clade — 寫完一支 shell script 的當下，就地判「自己會 sudo 但缺 EUID guard」。
#
# 為什麼是 PostToolUse 而不是只有 fleet 掃描：義務的發作時刻是「有人剛寫完一支 .sh」，
# 而 fleet 掃描的執行時刻是「某人想到要跑健康稽核」。兩者可以差好幾天，中間那支腳本
# 已經被 sudo 跑過一次了。判準 SoT 在 scripts/shell-safety-check.ts（clade 端為
# vendor/scripts/shell-safety-check.ts），與 clade 的 fleet audit 共用同一份。
#
# warn-only：印到 stderr、一律 exit 0。NEVER 改成 exit 2 擋下 Edit —— 命中的多半是
# 既有腳本被順手改了一行，擋下編輯治不了它，只會逼人繞過 hook。

set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_response.filePath // ""' 2>/dev/null || echo "")

[ -z "$FILE_PATH" ] && exit 0
case "$FILE_PATH" in
  *.sh) ;;
  *) exit 0 ;;   # 無副檔名的 shell script 由 fleet 掃描接住；hook 只認明確的 .sh
esac
[ -f "$FILE_PATH" ] || exit 0

ROOT="${CLADE_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-$(pwd)}}"
# clade home 用源檔，consumer 用投影檔；兩者是同一份內容
for CHECK in "$ROOT/vendor/scripts/shell-safety-check.ts" "$ROOT/scripts/shell-safety-check.ts"; do
  if [ -f "$CHECK" ]; then
    node "$CHECK" "$FILE_PATH" >&2 || true
    exit 0
  fi
done

exit 0
