#!/usr/bin/env bash
# PreToolUse:Bash hook — `gh pr create` 的 body 必須帶 `Work:` 行（block，exit 2）
#
# 判定全在同目錄的 gh-pr-create-work.ts（clade home 的 clade-home-guard.ts import 同一份）；
# 本檔只做快篩與 fail-open 外殼。為什麼、判不出時怎麼辦、逃生門，見該檔檔頭。
#
# fail-open：沒有 node、判定檔不在 → 靜默 exit 0。hook 壞掉不該擋住工作。

set -uo pipefail

input=$(cat)

# 快篩：絕大多數命令不是 gh pr create，不付 node 啟動成本
case "$input" in
  *gh*pr*create*) ;;
  *) exit 0 ;;
esac

command -v node >/dev/null 2>&1 || exit 0
judge="$(dirname "$0")/gh-pr-create-work.ts"
[ -f "$judge" ] || exit 0

printf '%s' "$input" | node "$judge"
