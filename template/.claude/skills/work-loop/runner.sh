#!/usr/bin/env bash
# work-loop runner —— 每一輪跑在全新的 claude process 裡，context 不累積。
#
# 為什麼存在：in-session 的 `/loop /work-loop` 有一個天花板 —— 主線 context 單調成長，
# 跑幾輪就進入 TD-378 定義的重 session 區間（>200k peak，實測這類 session 吞掉 95.5% 的
# 加權配額），然後只能走 decay gate 收工。那讓 loop 的價值上限被 context 綁死。
#
# 本 runner 把「一輪」的邊界從 turn 提升到 process：每輪 `claude -p` 是全新 session，
# 讀 .spectra/work-loop-state.json 重建狀態、做事、寫回、退出。context 每輪歸零，
# 連續性由 state 檔承擔（durable execution：能 resume 的只有落檔的那份）。
#
# 用法：
#   ./runner.sh                    # 跑到停止條件成立，最多 20 輪
#   ./runner.sh --max-rounds 5
#   ./runner.sh --dry-run          # 只印每輪會下的指令，不真的跑
#
# 停止：state 檔出現 stoppedReason，或達 --max-rounds，或連續 2 輪 exit≠0。
# 中斷：Ctrl-C；lock 會在下一輪的 6h TTL 後自動失效，或手動 rm .spectra/work-loop.lock。

set -uo pipefail

REPO="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "error: 不在 git repo 內" >&2
  exit 2
}
STATE="$REPO/.spectra/work-loop-state.json"
LOCK="$REPO/.spectra/work-loop.lock"
LOG_DIR="$REPO/.spectra/work-loop-logs"

MAX_ROUNDS=20
DRY_RUN=0
# acceptEdits 是刻意的預設：runner 要能無人值守跑，但 bypassPermissions 會連
# 破壞性指令一起放行。要更寬鬆 MUST 由使用者顯式指定，NEVER 在腳本裡預設。
PERM_MODE="acceptEdits"

while [ $# -gt 0 ]; do
  case "$1" in
    --max-rounds) MAX_ROUNDS="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --permission-mode) PERM_MODE="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

mkdir -p "$LOG_DIR"

stopped_reason() {
  [ -f "$STATE" ] || return 1
  node -e '
    try {
      const s = require(process.argv[1])
      if (s.stoppedReason) { console.log(s.stoppedReason); process.exit(0) }
    } catch {}
    process.exit(1)
  ' "$STATE" 2>/dev/null
}

round_of() {
  [ -f "$STATE" ] || { echo 0; return; }
  node -e 'try{console.log(require(process.argv[1]).round ?? 0)}catch{console.log(0)}' "$STATE" 2>/dev/null || echo 0
}

fail_streak=0
start_round="$(round_of)"
echo "work-loop runner: repo=$REPO  起始 round=$start_round  max=$MAX_ROUNDS  perm=$PERM_MODE"

for i in $(seq 1 "$MAX_ROUNDS"); do
  # 只有 stoppedReason 才停 runner；roundEndReason（context 到頂 / item cap）是「換個 process 繼續」。
  if reason="$(stopped_reason)"; then
    echo "== stop: $reason"
    break
  fi

  before="$(round_of)"
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  log="$LOG_DIR/round-$ts.log"

  # 每輪都是新 process = 新 context。--print 跑完就退出。
  cmd=(claude --print --permission-mode "$PERM_MODE" "/work-loop --unattended")

  if [ "$DRY_RUN" = 1 ]; then
    echo "[dry-run] round $((before + 1)): ${cmd[*]}"
    continue
  fi

  echo "== round $((before + 1)) 起跑 ($ts) → $log"
  ( cd "$REPO" && "${cmd[@]}" ) >"$log" 2>&1
  rc=$?

  after="$(round_of)"

  if [ "$rc" -ne 0 ]; then
    fail_streak=$((fail_streak + 1))
    echo "   exit=$rc（連續失敗 $fail_streak）—— log 尾巴："
    tail -5 "$log" | sed 's/^/     /'
    # 死掉的 process 不會自己釋放 lock，下一輪會被自己的 lock 擋住。
    rm -f "$LOCK"
    if [ "$fail_streak" -ge 2 ]; then
      echo "== stop: 連續 2 輪 exit≠0，可能是系統性問題（log 在 $LOG_DIR）"
      break
    fi
    continue
  fi

  fail_streak=0

  # round 沒前進代表那一輪沒寫 state —— 通常是被 lock 擋掉或中途夭折。
  if [ "$after" = "$before" ]; then
    echo "   ⚠ round 未前進（$before → $after）；state 沒被更新，視為一次失敗"
    fail_streak=$((fail_streak + 1))
    rm -f "$LOCK"
    [ "$fail_streak" -ge 2 ] && { echo "== stop: state 連續 2 輪未前進"; break; }
    continue
  fi

  echo "   ✓ round $after 完成"
done

echo
echo "runner 結束 —— 最終 round=$(round_of)"
if reason="$(stopped_reason)"; then echo "stoppedReason: $reason"; fi
echo "logs: $LOG_DIR"
