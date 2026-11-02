#!/usr/bin/env bash
# PreToolUse:Bash hook — 擋 Bash 裸起長駐 dev server（nuxt dev／vite／wrangler dev／pnpm run dev／node .output/server），
# 導向 wt-helper dev／dev-session.ts 單一入口（block，exit 2）。
#
# 判定全在同目錄的 pre-bash-dev-server-gate.ts；本檔只做快篩與錯誤分支出口。
# 降級型：判定故障（node 不在、判定檔不在、判定行程非 0／2 退出）一律放行並以 additionalContext 告知。

set -uo pipefail

input=''
IFS= read -r -d '' input || true

# 快篩：絕大多數 Bash 不含這些字，不付 node 啟動成本
case "$input" in
  *nuxt*|*nuxi*|*vite*|*wrangler*|*dev*|*.output/server*) ;;
  *) exit 0 ;;
esac

degraded() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"dev server gate 故障未判定（%s）：長駐 dev server 仍 MUST 走 wt-helper dev／dev-session.ts，NEVER 裸起 nuxt dev／pnpm run dev。"}}\n' "$1"
  exit 0
}

command -v node >/dev/null 2>&1 || degraded 'node 不在 PATH'
here=${BASH_SOURCE[0]%/*}
judge="$here/pre-bash-dev-server-gate.ts"
[ -f "$judge" ] || degraded '判定檔不在'

err=$(node "$judge" <<<"$input" 2>&1 >/dev/null)
rc=$?
case "$rc" in
  0) exit 0 ;;
  2)
    printf '%s\n' "$err" >&2
    exit 2
    ;;
  *) degraded "判定行程 exit ${rc}" ;;
esac
