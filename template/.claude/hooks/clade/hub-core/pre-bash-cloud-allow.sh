#!/usr/bin/env bash
# PreToolUse:Bash hook — cloud session 專用的 Bash 放行清單（permissionDecision: allow）
#
# 判定全在同目錄的 cloud-bash-allow.ts；本檔只做 cloud 判定與錯誤分支出口。
# 為什麼、清單出處、threat model、禁區、E1～E6 錯誤分支表，見該檔檔頭。
#
# 只在 cloud VM 動作：`CLAUDE_CODE_REMOTE` 空／`0`／`false` 一律 exit 0、無輸出——本機 session 的權限
# 完全由 settings 決定，本檔不增不減。
# 放行型：任何故障（node 不在、判定檔不在、判定行程非 0 退出）都 exit 0 無輸出＝回到原本的權限框，
# NEVER 在故障時印 allow。

set -uo pipefail

case "${CLAUDE_CODE_REMOTE:-}" in '' | 0 | false) exit 0 ;; esac
[ "${CLADE_CLOUD_BASH_ALLOW_OFF:-}" = 1 ] && exit 0

input=''
IFS= read -r -d '' input || true

command -v node >/dev/null 2>&1 || exit 0 # E1
here=${BASH_SOURCE[0]%/*}
judge="$here/cloud-bash-allow.ts"
[ -f "$judge" ] || exit 0 # E2

out=$(node "$judge" <<<"$input" 2>/dev/null)
rc=$?
# E6：只在判定行程正常結束時轉印；輸出必須是放行 JSON 本身
[ "$rc" -eq 0 ] || exit 0
case "$out" in
  '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow",'*) printf '%s\n' "$out" ;;
esac
exit 0
