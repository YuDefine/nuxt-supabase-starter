#!/usr/bin/env bash
# Stop hook — 有在飛的背景 subagent／Herdr non-blocking 派工卻沒排 keepalive 時擋一次。
# 判定、threat model 與錯誤分支表全在 vendor/scripts/async-keepalive-stop-gate.ts；
# 本檔只負責定位與 fail-open。stdin MUST 原樣轉給 gate（它要讀 stop_hook_active）。
#
# fail-open：node 缺 / 找不到中央 clade / gate 缺 → silent exit 0。

set -uo pipefail

payload=$(cat)

command -v node >/dev/null 2>&1 || exit 0

find_clade_root() {
  if [[ -n "${CLADE_HOME:-}" && -f "$CLADE_HOME/registry/consumers.json" ]]; then
    printf '%s\n' "$CLADE_HOME"
    return 0
  fi
  for candidate in "$HOME/clade" "$HOME/offline/clade"; do
    if [[ -f "$candidate/registry/consumers.json" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

CLADE_ROOT=$(find_clade_root) || exit 0
GATE="$CLADE_ROOT/vendor/scripts/async-keepalive-stop-gate.ts"
[ -f "$GATE" ] || exit 0

printf '%s' "$payload" | node "$GATE"
