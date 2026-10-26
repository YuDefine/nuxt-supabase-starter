#!/usr/bin/env bash
# PreToolUse:Bash hook — 擋 agent-browser 用錯 profile（漏帶／換 profile、目錄路徑當 profile、
# 全新 session 不帶 --profile 開外部網址；block，exit 2）
#
# 判定全在同目錄的 pre-bash-agent-browser-profile-gate.ts；本檔只做快篩與錯誤分支出口。
# 為什麼、threat model、gate 型別、E1～E6 錯誤分支表、繞行場景，見該檔檔頭。
#
# 降級型：判定故障（node 不在、判定檔不在、判定行程非 0／2 退出）一律放行，並以 additionalContext
# 告知 agent「gate 故障未判定」——PreToolUse 不阻擋時只有這個通道送得到 agent（docs/hook-inventory.md）。

set -uo pipefail

input=''
IFS= read -r -d '' input || true

# 快篩：絕大多數 Bash 不含 agent-browser，不付 node 啟動成本
case "$input" in
  *agent-browser*) ;;
  *) exit 0 ;;
esac

degraded() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"agent-browser profile gate 故障未判定（%s）：每個 agent-browser 指令 MUST 帶同一個桌面 Chrome profile 名稱 --profile <名稱>（本機 dev server 除外），NEVER 用目錄路徑當 profile。"}}\n' "$1"
  exit 0
}

command -v node >/dev/null 2>&1 || degraded 'node 不在 PATH' # E1
here=${BASH_SOURCE[0]%/*}
judge="$here/pre-bash-agent-browser-profile-gate.ts"
[ -f "$judge" ] || degraded '判定檔不在' # E2

err=$(node "$judge" <<<"$input" 2>&1 >/dev/null)
rc=$?
case "$rc" in
  0) exit 0 ;;
  2)
    printf '%s\n' "$err" >&2
    exit 2
    ;;
  *) degraded "判定行程 exit ${rc}" ;; # E4／E5：不沿用非 0／2 退出碼
esac
