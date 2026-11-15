#!/usr/bin/env bash
# PreToolUse(*)／PostToolUse(Agent)／Stop hook — haiku-implementer 複驗 failed 後鎖住主線，只放行轉交 sonnet-implementer。
# 用法：haiku-implementer-handoff-gate.sh pre-tool|post-tool|stop
#
# 判定與 threat model 全在同目錄的 haiku-implementer-test-gate.ts；本檔只做快篩與 fail-closed 外殼。
# 快篩：本 session 沒有 latch 就不付 node 啟動成本（每次工具呼叫都會經過這裡）；別的 session 留下的 latch 不算。
#   payload 的 session_id 可能不止一處（tool_input 也可能有同名欄位），所以任一處中 latch 就交判定，寧可多跑不可漏擋。
# 安全型：本 session 有 latch（或 payload 認不出 session）但判不出來 → 擋；subagent 自己的工具呼叫不受 latch 管，放行。
#   E1 node 不在／E2 判定檔不在／E3–E5 判定回非 0／2 → exit 2，訊息指向人工清 latch。
# E6 逾時：判定不跑外部指令，只讀 latch 檔，不列入。

set -uo pipefail

mode=${1:-pre-tool}
root="${CLADE_HAIKU_GATE_STATE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/clade/haiku-implementer-gate}"
compgen -G "$root/latched/*.json" >/dev/null 2>&1 || exit 0

input=$(cat)

# subagent 自己的工具呼叫不受主線 latch 管（判定檔對 agent_id 回 0）：轉交的 sonnet-implementer 跑的期間 latch 還在，
# 先在 shell 放行，省掉每次工具呼叫的 node 啟動。只用在 pre-tool：它的 payload 在 "tool_input" 之前只有頂層純量欄位；
# Stop 沒有 tool_input、PostToolUse 帶 tool_response，可能夾自由文字，交判定檔解析。要求非空字串值的鍵值形狀。
if [ "$mode" = pre-tool ]; then
  input_head=${input%%'"tool_input"'*}
  if [ "$input_head" != "$input" ] && [[ $input_head =~ \"agent_id\"[[:space:]]*:[[:space:]]*\"[^\"]+\" ]]; then
    exit 0
  fi
fi

sids=$(printf '%s' "$input" | grep -oE '"session_id"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*:[[:space:]]*"\(.*\)"$/\1/' | tr -c 'A-Za-z0-9_.\n-' '_')
if [ -n "$sids" ]; then
  owned=
  while IFS= read -r sid; do
    compgen -G "$root/latched/${sid}__*.json" >/dev/null 2>&1 && owned=1
  done <<<"$sids"
  [ -n "$owned" ] || exit 0
fi

fail_closed() {
  # 身分欄位只在第一個 "tool_input" 之前找：tool_input 內同名 key 不可讓主線冒充 subagent（同 session-context-budget-warn.sh）
  local head=${input%%'"tool_input"'*}
  case "$head" in
    *'"agent_id"'*) exit 0 ;;
  esac
  # Stop 已被擋過一次還判不出來就放行收工，避免無人值守 session Stop→block 迴圈；latch 留著，下一個工具呼叫照擋
  if [ "$mode" = stop ]; then
    case "$head" in
      *'"stop_hook_active":true'* | *'"stop_hook_active": true'*) exit 0 ;;
    esac
  fi
  printf 'haiku-implementer gate 故障（%s）且有未解 latch：查 %s/latched/ 屬於本 session 的檔，確認後人工刪除。\n' "$1" "$root" >&2
  exit 2
}

command -v node >/dev/null 2>&1 || fail_closed 'node 不在 PATH'
judge="$(dirname "$0")/haiku-implementer-test-gate.ts"
[ -f "$judge" ] || fail_closed "判定檔不在：$judge"

printf '%s' "$input" | node "$judge" "$mode"
status=$?
case "$status" in
  0 | 2) exit "$status" ;;
  *) fail_closed "判定非預期退出 $status" ;;
esac
