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
# 中斷：Ctrl-C；lock 的 heartbeat 逾窗（45min）且本 runner 的 pid 不再存活時自動失效，
#       或手動 rm .spectra/work-loop.lock。

set -uo pipefail

# 每輪的 agent 在 Step 0 跑 `work-loop-lock.ts acquire`，該 script 讀這個變數當 pid 補強欄。
# 這裡的 `$$` 是 runner 自己 —— 跨整個 loop 存活，是三種模式中唯一真的長命的那個。
# 讀 env 而非讓 agent 現算：sandbox 靜態分析會在執行前擋掉 agent 側的 `$$` 與 `$(…)`。
export WORK_LOOP_RUNNER_PID=$$

REPO="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "error: 不在 git repo 內" >&2
  exit 2
}
STATE="$REPO/.spectra/work-loop-state.json"
LOCK="$REPO/.spectra/work-loop.lock"
LOG_DIR="$REPO/.spectra/work-loop-logs"
# worktree 母目錄，與 vendor/scripts/wt-helper.ts:779 的 `<repo>-wt` 慣例對齊（推導不寫死）。
# 它必須進 --add-dir —— 見下方 PERM_MODE 註解。
#
# NEVER 從 `$REPO`（`--show-toplevel`）推：在 linked worktree 內跑時它回的是 worktree 自己，
# 推出來的是 `<repo>-wt/<slug>-wt` 這種不存在的路徑，而 `mkdir -p` 會**把它建出來**，於是
# 錯誤不報錯、只是 --add-dir 放行了一個空目錄（2026-08-05 首版 dry-run 當場踩到）。
# `--git-common-dir` 不論從哪個 worktree 跑都指向主 worktree 的 `.git`。
MAIN_WT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
WT_PARENT="$(dirname "$MAIN_WT")/$(basename "$MAIN_WT")-wt"

MAX_ROUNDS=20
DRY_RUN=0
# acceptEdits 是刻意的預設：runner 要能無人值守跑，但 bypassPermissions 會連
# 破壞性指令一起放行。要更寬鬆 MUST 由使用者顯式指定，NEVER 在腳本裡預設。
#
# `--print` 把可寫目錄 pin 在 repo root，於是主線寫不進 `<repo>-wt/`，而
# `.claude/rules/local/clade-home-worktree.md` 要求「≥2 檔」或「最後要 publish」的工作
# MUST 走 worktree（`sync-rules.ts` 從 **working tree** 讀源檔 —— main 上未 commit 的內容
# 等同已發佈）。兩者相撞的結果是 loop 推不動任何散播資產，只剩 `docs/` 能動：2026-08-05
# round 10 因此把 TD-387 的 27 處替換與 handoff SKILL.md 拆檔兩項都判 blocked（[[TD-393]]）。
#
# 修法是**只放行 worktree 母目錄這一個路徑**，permission mode 維持 acceptEdits。
# NEVER 改用 `--dangerously-skip-permissions` 來解這件事 —— 那是把整個權限面開到最大去換
# 一個目錄的寫入權，兩者成本差一個量級（Charles 2026-08-05 拍板 1a 而非 1b）。
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
# --add-dir 對不存在的路徑會拒絕啟動，而 `<repo>-wt/` 在所有 worktree 都 merge-back 之後
# 是空的、也可能整個被清掉 —— 先建起來，否則 runner 會在「剛好沒有進行中 worktree」時掛掉。
mkdir -p "$WT_PARENT"

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

# 待答決策佇列的長度。**只印不擋** —— 打這個腳本的人正要離開座位，擋住等於什麼都不做。
# 無人值守輪次只排除佇列裡那幾條 item，其餘照推；清算由下一次 attended /work-loop 的
# Step 2.7 承擔（Charles 2026-08-06 拍板）。NEVER 改成 exit≠0。
awaiting_count() {
  [ -f "$STATE" ] || { echo 0; return; }
  node -e 'try{const a=require(process.argv[1]).awaiting;console.log(Array.isArray(a)?a.length:0)}catch{console.log(0)}' "$STATE" 2>/dev/null || echo 0
}

fail_streak=0
start_round="$(round_of)"
echo "work-loop runner: repo=$REPO  起始 round=$start_round  max=$MAX_ROUNDS  perm=$PERM_MODE"

awaiting="$(awaiting_count)"
if [ "$awaiting" -gt 0 ] 2>/dev/null; then
  echo "⏳ $awaiting 條待答決策（跑 attended /work-loop 可清算）；本次只推進不受影響的項目"
fi

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
  # 參數順序有意義，NEVER 重排：`--add-dir <directories...>` 是**變參**選項，會一路吃到下一個
  # flag 為止。把它排在最後、prompt 前面，prompt 就會被當成第二個目錄吞掉，claude 回
  # `Input must be provided either through stdin or as a prompt argument when using --print`
  # ——錯誤訊息完全沒提 --add-dir，2026-08-05 實測連兩輪 exit=1 才查到。
  # 所以 `--add-dir` MUST 後面接另一個 flag（此處 --permission-mode）當終止符。
  cmd=(claude --print --add-dir "$WT_PARENT" --permission-mode "$PERM_MODE" "/work-loop --unattended")

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
