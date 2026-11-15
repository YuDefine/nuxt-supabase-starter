#!/usr/bin/env bash
# SubagentStop(haiku-implementer) hook — 收尾機械重跑 brief 的 test-command。
#
# 判定與 threat model 全在同目錄的 haiku-implementer-test-gate.ts；本檔只做 fail-closed 外殼。
# 安全型：判不出來倒向 failed，不沿用判定行程的非預期退出碼（harness 視非 0／2 為放行）。
#   E1 node 不在／E2 判定檔不在／E3 stdin 非 JSON（回 3）／E4 判定丟例外（回 3）／E5 非 0／2 退出
#     → 寫 broken latch（主線被擋到 --release 為止），exit 2 要 Haiku 第一行寫 FAILED
#     例外：stdin 認不出 session_id 就沒有 session 可綁、不寫 latch（寫了會鎖到別的 session），只剩 exit 2 這一道
#   E6 逾時：判定內測試逾時算紅；harness 砍 hook 屬已知限制，timeout 留比測試逾時長
# 同一輪已被擋過（stop_hook_active）還判不出來 → 照寫 broken latch 再 exit 0，避免 Haiku 永遠停不下來；
#   旗標可能是別支 stop hook 設的、本 gate 上次判綠，所以不能假設 latch 已在。latch 以 session＋agent 固定命名，重寫不會多一把。

set -uo pipefail

input=$(cat)

fail_closed() {
  local reason=$1 root sid aid
  umask 077
  root="${CLADE_HAIKU_GATE_STATE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/clade/haiku-implementer-gate}"
  sid=$(printf '%s' "$input" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1 | tr -c 'A-Za-z0-9_.\n-' '_')
  aid=$(printf '%s' "$input" | sed -n 's/.*"agent_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1 | tr -c 'A-Za-z0-9_.\n-' '_')
  if [ -n "$sid" ]; then
    mkdir -p "$root/latched" 2>/dev/null
    printf 'broken: %s\n' "$reason" >"$root/latched/${sid}__broken-${aid:-unknown}.json" 2>/dev/null
  fi
  case "$input" in
    *'"stop_hook_active":true'* | *'"stop_hook_active": true'*) exit 0 ;;
  esac
  printf 'haiku-implementer 機械複驗故障（%s），無法證明測試綠。最終輸出第一行 MUST 是 FAILED，主線會轉交。\n' "$reason" >&2
  exit 2
}

# 只管 haiku-implementer：判定本身放行其他 agent，外殼故障時也不可叫 reviewer／接手的 sonnet 印 FAILED、替主線多上 latch。
# 認不出 agent_type（缺欄位、stdin 壞）照 fail-closed，與判定的「判不出來倒向 failed」同向。
atype=$(printf '%s' "$input" | sed -n 's/.*"agent_type"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
# 用 bash 內建 [[ =~ ]]，不靠 grep：grep 不在 PATH 時 `! grep` 會變真、整個 gate 無聲放行。
haiku_re='^([A-Za-z0-9_-]+:)?haiku-implementer$'
if [ -n "$atype" ] && ! [[ $atype =~ $haiku_re ]]; then
  exit 0
fi

command -v node >/dev/null 2>&1 || fail_closed 'node 不在 PATH'
judge="$(dirname "$0")/haiku-implementer-test-gate.ts"
[ -f "$judge" ] || fail_closed "判定檔不在：$judge"

printf '%s' "$input" | node "$judge" subagent-stop
status=$?
case "$status" in
  0 | 2) exit "$status" ;;
  *) fail_closed "判定非預期退出 $status" ;;
esac
