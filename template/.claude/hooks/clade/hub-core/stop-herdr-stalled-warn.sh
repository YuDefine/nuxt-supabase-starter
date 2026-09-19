#!/usr/bin/env bash
# Stop hook — 收工那一刻處理 Herdr 殘留。分兩級，判定與文字全在
# vendor/scripts/herdr-stop-gate.ts（可單元測試；本檔只負責定位與 fail-open）。
#
#   exit 2（block）：本 pane 自己持有、已回報 outcome、現在就收得掉的 dispatch。
#                   patrol 的 owes-resume 沒有 grace，所以「剛做完」在這裡就看得見——
#                   而 flow 的 unharvested 套 60 分鐘 grace，那一批對 SessionStart 是隱形的。
#   exit 0（warn）： abandoned record、orphan process、stale gate、別人持有的 dispatch。
#                   它們的 action 不是本 session 一個 turn 做得完的，擋下來只會製造死路。
#
# 為什麼從 warn-only 升級：Stop 的 exit 0 只把 stderr 寫進正在關掉那個 session 的
# scrollback——沒有讀者。2026-08-27 實測：收割指令每次都正確產生、每次都沒人執行。
# exit 2 是唯一會把文字送回模型手上、並換到一個 turn 去執行它的通道。
# harness 的 loop breaker（payload 的 stop_hook_active）由 gate 自己處理：擋過一次就降級，
# 所以 stdin **MUST** 原樣轉給它，NEVER 再改回 `cat > /dev/null`。
#
# fail-open：node 缺 / 找不到中央 clade / helper 缺 → silent exit 0。

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
GATE="$CLADE_ROOT/vendor/scripts/herdr-stop-gate.ts"
[ -f "$GATE" ] || exit 0

printf '%s' "$payload" | node "$GATE" "$CLADE_ROOT"
