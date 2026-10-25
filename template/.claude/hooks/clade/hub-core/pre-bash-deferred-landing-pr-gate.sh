#!/usr/bin/env bash
# PreToolUse:Bash hook — 延後落地分支上擋 `gh pr create`／`gh pr ready`（block，exit 2）
#
# 判定全在同目錄的 deferred-landing-pr.ts（clade home 的 clade-home-guard.ts import 同一份）；
# 本檔只做快篩與 fail-open 外殼。為什麼、判不出時怎麼辦、恢復路徑，見該檔檔頭。
#
# fail-open：沒有 node、判定檔不在 → 靜默 exit 0。漏網的由 PR 分診的事後偵測（deferred-pr-violation）抓。

set -uo pipefail

input=$(cat)

# 快篩：絕大多數命令不是 gh pr create／ready，不付 node 啟動成本
case "$input" in
  *gh*pr*create* | *gh*pr*ready*) ;;
  *) exit 0 ;;
esac

command -v node >/dev/null 2>&1 || exit 0
judge="$(dirname "$0")/deferred-landing-pr.ts"
[ -f "$judge" ] || exit 0

printf '%s' "$input" | node "$judge"
