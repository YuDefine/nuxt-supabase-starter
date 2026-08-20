#!/usr/bin/env bash
# work-loop runner —— 每一輪跑在全新的 claude process 裡，context 不累積。
#
# 為什麼存在：in-session 的 `/loop /work-loop` 有一個天花板 —— 主線 context 單調成長，
# 跑幾輪就進入 TD-378 定義的重 session 區間（>200k peak，實測這類 session 吞掉 95.5% 的
# 加權配額），然後只能走 decay gate 收工。那讓 loop 的價值上限被 context 綁死。
#
# 本 runner 把「一輪」的邊界從 turn 提升到 process：每輪 `claude -p` 是全新 session，
# 讀 .clade/work-loop/state.json 重建狀態、做事、寫回、退出。context 每輪歸零，
# 連續性由 state 檔承擔（durable execution：能 resume 的只有落檔的那份）。
#
# 用法：
#   ./runner.sh                    # 跑到停止條件成立，最多 20 輪
#   ./runner.sh --max-rounds 5
#   ./runner.sh --dry-run          # 只印每輪會下的指令，不真的跑
#   ./runner.sh --skip-preflight   # 探針誤判過嚴時的 override（不略過互斥鎖門檻）
#   ./runner.sh --min-ready 0      # 關掉待辦源健康門檻
#
# 起跑前先跑 quarantine、互斥鎖門檻、preflight 與待辦源健康門檻：任一不過就
# **完全不啟動**，理由落在 $LOG_DIR/preflight.log。preflight 省的不是第 4 輪起的
# 重複失敗，是全部那幾十輪 —— 2026-08-10 <consumer-b> 因 headless 權限閘門連續拒絕，空轉
# 99 輪、零待辦被修改。互斥鎖命中（exit 6）是「已有 runner 在跑」，不是故障。
#
# 停止：state 檔出現 stoppedReason，或達 --max-rounds，或連續 2 輪 exit≠0，
#       或 state 連續 2 輪未前進，或起跑前 exit 3/4/5/6。
# 中斷：Ctrl-C；lock 的 heartbeat 逾窗（45min）且本 runner 的 pid 不再存活時自動失效。
#
# 從外面要求它停（人或別的 session）：**寫 sentinel 檔，NEVER 改 state.stoppedReason**——
#   echo '停止理由' > "$(git rev-parse --show-toplevel)/.clade/work-loop/stop"
# runner 在每輪開始前檢查它，所以語義是「當前這輪跑完就停」，不會腰斬 in-flight 的一輪。
# 命中後 sentinel 會被消費掉，下一次起 runner 不受影響。

set -uo pipefail

# 每輪的 agent 在 Step 0 跑 `work-loop-lock.ts acquire`，該 script 讀這個變數當 pid 補強欄。
# 這裡的 `$$` 是 runner 自己 —— 跨整個 loop 存活，是三種模式中唯一真的長命的那個。
# 讀 env 而非讓 agent 現算：sandbox 靜態分析會在執行前擋掉 agent 側的 `$$` 與 `$(…)`。
export WORK_LOOP_RUNNER_PID=$$

REPO="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "error: 不在 git repo 內" >&2
  exit 2
}
STATE="$REPO/.clade/work-loop/state.json"
LOG_DIR="$REPO/.clade/work-loop/logs"
# 外部停止請求的 sentinel。**NEVER 把它併回 $STATE** —— 那正是本檔案存在的理由：
# child 在 Step 1 讀 state、Step 7 把自己那份物件**整份**寫回，兩點之間任何外部寫入
# 都會被 whole-document last-writer-wins 覆蓋掉。2026-08-11 實證：外部在 round 49 寫入
# state.stoppedReason 要求「下一輪做完就停」，round 50 的 child 收尾時把它蓋掉，runner
# 毫無所覺地照跑 51、52。
#
# child 自己寫的 state.stoppedReason 仍然有效且保留支援 —— 那條路徑沒有 clobber 風險，
# 因為寫它的 child 就是最後一個寫入者、寫完立刻退出。壞掉的只有**外部**要求停止這條。
STOP_FILE="$REPO/.clade/work-loop/stop"

# 解析 JSON 用的 node —— **MUST 走這個變數，NEVER 直接 `node -e`**。
#
# 這些 node -e 的 stdout 被下面的 `case "$x" in ''|*[!0-9]*)` 當數字判讀，而 `console.log(<number>)`
# 走 util.inspect：`FORCE_COLOR` 有值時它會把 `0` 印成 `\033[33m0\033[39m`，於是「讀得到而且是 0」
# 被判成「讀不出來」→ runner 在 startup 就 exit 5，還寫下 quarantine marker 說 preexisting-inflight
# —— 訊息與真實成因完全無關，看到的人會去查根本不存在的 in-flight job。
#
# 2026-08-18 實測：`FORCE_COLOR=3`（Claude Code 的 Bash 工具環境即為此值）下 runner 一輪都跑不起來，
# `test/work-loop-runner.test.ts` 10 個 case 全紅。字串輸出（"invalid" / "NaN" / stoppedReason）
# 不受影響，所以只有印數字的那幾處會發作 —— 這是它能潛伏到現在的原因。
#
# NEVER 改成在 runner 頂層 export FORCE_COLOR=0：那會一併關掉 child `claude --print` 的顏色。
NODE_PLAIN="env FORCE_COLOR=0 NO_COLOR=1 node"

# ── headless child 的發起點路由 ──────────────────────────────────────────────
# child 跟起 runner 的那條入口走同一條帳號，不是永遠剝成官方 CC。
#
#   cc  / ccw → 官方 CC（剝 gateway 變數，與 ~/.zshrc 的 cc / ccw wrapper 對齊）
#   ccg / ccx → claudeg / claudex（wrapper 會釘 --model ccg-opus / ccx-opus 並設 500K / 272K）
#
# 2026-08-19 曾一律剝成官方 CC：當時 child 繼承 CCG env 卻呼叫裸 `claude --print`
# （沒有 --model ccg-opus），gateway 把預設 opus 路由到 Codex channel 的 `claude-opus-5`，
# 429 被 preflight 報成「權限閘門拒絕」。真因是 launcher 不對，不是「CCG 起源不該走 gateway」。
# 2026-08-20 從 CCG 起 runner、剝成官方 CC 後撞 `You've hit your session limit · resets 5am`：
# 官方額度與 gateway 額度不是同一池。修法是「起源是 ccg 就用 claudeg」，不是永遠剝掉。
#
# NEVER 改用 `env -i`：child 需要 HOME / PATH / TERM / CLAUDE_CONFIG_DIR。
# NEVER 對 ccg/ccx 起源改回裸 `claude --print` 還留著 gateway env —— 那就是 08-19 的 429。
# NEVER 拿 `--skip-preflight` 當本問題的修法。
CHILD_ENV=(
  env
  -u ANTHROPIC_BASE_URL
  -u ANTHROPIC_AUTH_TOKEN
  -u ANTHROPIC_DEFAULT_OPUS_MODEL
  -u ANTHROPIC_DEFAULT_SONNET_MODEL
  -u ANTHROPIC_DEFAULT_HAIKU_MODEL
  -u CLAUDE_CODE_MAX_CONTEXT_TOKENS
  -u CLAUDE_CODE_AUTO_COMPACT_WINDOW
  -u CLAUDE_CODE_DISABLE_1M_CONTEXT
  -u CLIENT_API_KEY
  -u CPA_MANAGEMENT_KEY
  -u CPAMP_ADMIN_KEY
  -u KEEPER_PASSWORD
)

detect_origin_launcher() {
  case "${ANTHROPIC_DEFAULT_OPUS_MODEL:-}" in
    ccg-*) echo ccg; return ;;
    ccx-*) echo ccx; return ;;
  esac
  if [ "${CLAUDE_CONFIG_DIR:-}" = "$HOME/.claude-work" ]; then
    echo ccw
    return
  fi
  echo cc
}

ORIGIN="$(detect_origin_launcher)"
case "$ORIGIN" in
  ccg) CHILD_BIN="$HOME/.local/bin/claudeg" ;;
  ccx) CHILD_BIN="$HOME/.local/bin/claudex" ;;
  *)   CHILD_BIN="claude" ;;
esac
QUARANTINE_FILE="$REPO/.clade/work-loop/orphan-quarantine.json"
LOCK_HELPER="$HOME/offline/clade/vendor/scripts/work-loop-lock.ts"
READY_HELPER="$HOME/offline/clade/vendor/scripts/work-loop-ready-count.ts"
SCAN_HELPER="$HOME/offline/clade/vendor/scripts/work-loop-scan.ts"
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
SKIP_PREFLIGHT=0
# 待辦源健康門檻：起跑前數得出的 ready item 少於這個數就不啟動（0 = 關掉本門檻）。
# 3 是下限側的保守值 —— 低於它時一輪的固定成本（冷載 + scan + 分類）多半換不到一個 item。
MIN_READY=3
# `ScheduleWakeup` / `Monitor` 的 interval 下限（秒）。CLAUDE.md 已有長等待規約，但 2026-08-12
# 量測到 197 次呼叫（<consumer-b> 2.10 次/輪）證明無人值守下遵守不穩，所以在 runner 層把數字下沉進
# 每輪的 prompt —— 它出現在 user turn，比冷載一次的規約大聲。
MIN_WAKEUP=1200
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
# Step 2 的 scan、驗證與 rotate 全收進單一 helper；headless process 沒有人能回答
# mktemp / cp / mv 的分段 approval。只批准這一條完整 invocation，NEVER 擴成 bare `Bash`。
SCAN_HELPER_CMD='node "$HOME/offline/clade/vendor/scripts/work-loop-scan.ts"'
SCAN_HELPER_RULE="Bash($SCAN_HELPER_CMD)"
SCAN_PREFLIGHT_CMD="$SCAN_HELPER_CMD --preflight"
SCAN_PREFLIGHT_RULE="Bash($SCAN_PREFLIGHT_CMD)"

while [ $# -gt 0 ]; do
  case "$1" in
    --max-rounds) MAX_ROUNDS="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --permission-mode) PERM_MODE="$2"; shift 2 ;;
    --skip-preflight) SKIP_PREFLIGHT=1; shift ;;
    --min-ready) MIN_READY="$2"; shift 2 ;;
    --min-wakeup) MIN_WAKEUP="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# TD-459 落點遷移（`.spectra/work-loop-*` → `.clade/work-loop/*`）。**MUST 排在 mkdir 之前**：
# migrate 只在目標不存在時搬，先建好 $LOG_DIR 會讓舊 log 目錄永遠搬不過來。
# helper 缺席或版本較舊（沒有 migrate 子命令）都不擋 runner —— 那時最壞是 state 從頭起算。
if [ -f "$LOCK_HELPER" ]; then
  (cd "$REPO" && node "$LOCK_HELPER" migrate) >/dev/null 2>&1 || true
fi

mkdir -p "$LOG_DIR"
# 目錄自帶 `.gitignore`（`*` 連自己一起 ignore）—— 多數 consumer 的 .gitignore 只涵蓋
# `.clade/vendor/ledger/*.jsonl`，不涵蓋 `.clade/`。helper 已做一次，這裡是 helper 缺席時的
# 補強：少了它，runtime state 會在那些 repo 變成 untracked 噪音。
[ -f "$REPO/.clade/work-loop/.gitignore" ] || printf '*\n' > "$REPO/.clade/work-loop/.gitignore"

# --add-dir 對不存在的路徑會拒絕啟動，而 `<repo>-wt/` 在所有 worktree 都 merge-back 之後
# 是空的、也可能整個被清掉 —— 先建起來，否則 runner 會在「剛好沒有進行中 worktree」時掛掉。
mkdir -p "$WT_PARENT"

# 兩個來源，**順序有意義**：先看外部 sentinel，再看 state。
#
# 外部停止請求 MUST 走 $STOP_FILE，NEVER 走 state.stoppedReason —— 後者會被 child 的
# Step 7 整份寫回覆蓋掉（見 $STOP_FILE 宣告處的實證）。sentinel 是獨立檔案，不在任何
# child 的讀寫路徑上，所以沒有 clobber 窗口。
#
# 命中 sentinel 時**消費掉它**（一次性）：留著的話下一個 runner 會在第一輪就停，而那個
# 「怎麼都跑不起來」的長相跟真正的故障無法區分。停止原因已印進 stdout，紀錄不會消失。
stopped_reason() {
  if [ -f "$STOP_FILE" ]; then
    local reason
    reason="$(head -c 500 "$STOP_FILE" 2>/dev/null | head -1)"
    rm -f "$STOP_FILE"
    echo "${reason:-外部停止請求（${STOP_FILE}，內容為空）}"
    return 0
  fi
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
  $NODE_PLAIN -e '
    try {
      const r = require(process.argv[1]).round ?? 0
      console.log(Number.isInteger(r) && r >= 0 ? r : "invalid")
    } catch { console.log("invalid") }
  ' "$STATE" 2>/dev/null || echo invalid
}

round_is_uint() {
  case "$1" in
    ''|*[!0-9]*) return 1 ;;
    *) return 0 ;;
  esac
}

next_round_label() {
  round_is_uint "$1" && echo $((1 + $1)) || echo "?"
}

# 異常停止只釋放「helper 回報 pid == 本 runner」的鎖。status 與 release 都經 helper，
# 中間若被別輪接手，session id guard 會讓 release 回 not-owner，NEVER 誤刪別人的鎖。
release_runner_lock() {
  [ -f "$LOCK_HELPER" ] || { echo "   ⚠ 找不到 lock helper，無法釋放本 runner 鎖"; return; }
  local status session
  status="$(cd "$REPO" && node "$LOCK_HELPER" status --json 2>/dev/null)" || return
  session="$(node -e '
    try {
      const s = JSON.parse(process.argv[1])
      if (s.pid === Number(process.argv[2]) && typeof s.sessionId === "string") console.log(s.sessionId)
    } catch {}
  ' "$status" "$$")"
  [ -n "$session" ] || return
  (cd "$REPO" && node "$LOCK_HELPER" release --session "$session") >/dev/null 2>&1 \
    || echo "   ⚠ 本 runner 鎖已被別輪接手，未釋放"
}

# 待答決策佇列的長度。**只印不擋** —— 打這個腳本的人正要離開座位，擋住等於什麼都不做。
# 無人值守輪次只排除佇列裡那幾條 item，其餘照推；清算由下一次 attended /work-loop 的
# Step 2.7 承擔（Charles 2026-08-06 拍板）。NEVER 改成 exit≠0。
awaiting_count() {
  [ -f "$STATE" ] || { echo 0; return; }
  $NODE_PLAIN -e 'try{const a=require(process.argv[1]).awaiting;console.log(Array.isArray(a)?a.length:0)}catch{console.log(0)}' "$STATE" 2>/dev/null || echo 0
}

# child process 已退出後，background task 的 harness ownership 也跟著消失。runner 必須在
# 起下一個 child 前 fail closed；只看 round 是否前進會把「已寫 bookkeeping、未收割 task」
# 誤判成成功輪。
in_flight_count() {
  [ -f "$STATE" ] || { echo 0; return; }
  $NODE_PLAIN -e '
    try {
      const a = require(process.argv[1]).inFlight
      if (a === undefined) console.log(0)
      else if (Array.isArray(a)) console.log(a.length)
      else console.log("invalid")
    } catch { console.log("invalid") }
  ' "$STATE" 2>/dev/null || echo invalid
}

# The lock is a persistent JSON file, but its heartbeat/pid lease can expire after this
# process exits. The quarantine marker is therefore the mechanical startup gate; the lock
# file is retained for attended diagnosis and is released only by attended reconciliation.
write_quarantine_marker() {
  local reason="$1" count="$2" phase="$3"
  node -e '
    const fs = require("node:fs")
    const [path, reason, count, phase] = process.argv.slice(1)
    const parsedCount = /^\d+$/.test(count) ? Number(count) : null
    fs.writeFileSync(path, `${JSON.stringify({
      reason,
      phase,
      inFlightCount: parsedCount,
      inFlightStatus: parsedCount === null ? count : "present",
      detectedAt: new Date().toISOString(),
      intervention: "Run attended /work-loop; reconcile every inFlight owner to terminal/cancelled, then remove this marker and release the lock.",
    }, null, 2)}\n`)
  ' "$QUARANTINE_FILE" "$reason" "$count" "$phase"
}

guard_runner_quarantine() {
  local phase="$1" count
  if [ -f "$QUARANTINE_FILE" ]; then
    runner_stop_reason="orphan-quarantine-awaiting-attended-reconciliation"
    echo "== stop: ${runner_stop_reason}（marker=${QUARANTINE_FILE}；禁止自動 retry）"
    return 1
  fi

  count="$(in_flight_count)"
  case "$count" in
    ''|*[!0-9]*)
      runner_stop_reason="$([ "$phase" = child-exit ] && echo child-exited-inflight-unreadable || echo preexisting-inflight-unreadable)"
      ;;
    0) return 0 ;;
    *)
      runner_stop_reason="$([ "$phase" = child-exit ] && echo child-exited-with-inflight || echo preexisting-inflight-quarantine)"
      ;;
  esac

  write_quarantine_marker "$runner_stop_reason" "$count" "$phase"
  echo "== stop: ${runner_stop_reason} count=${count}（保留 lock 檔與 quarantine marker；需 attended reconciliation，禁止自動 retry）"
  return 1
}

print_runner_summary() {
  echo
  echo "runner 結束 —— 最終 round=$(round_of)"
  if [ -n "$runner_stop_reason" ]; then echo "runnerStopReason: $runner_stop_reason"; fi
  if reason="$(stopped_reason)"; then echo "stoppedReason: $reason"; fi
  echo "logs: $LOG_DIR"
}

# ── Preflight ─────────────────────────────────────────────────────────────────
# 起跑前把「這個 runner 跑得起來嗎」問完。不過就 exit≠0 且**一輪都不跑**。
#
# 為什麼是前置探針而不是斷路器：斷路器要先燒掉 N 輪才會跳，而失敗模式是**起跑當下就已經
# 確定**的（權限閘門不會在第 4 輪改變主意）。2026-08-10 <consumer-b> 空轉 99 輪的成本，前置探針能
# 全額省下，斷路器只省得到後面那 96 輪。
#
# 探針誤判過嚴時走 `--skip-preflight`，NEVER 靠拿掉探針本身解決。
preflight_fail() {
  local reason="$1"
  echo "== preflight 未通過：$reason"
  echo "   一輪都不跑。確認過探針誤判可用 --skip-preflight 覆寫。"
  printf '%s\tpreflight-fail\t%s\n' "$(TZ=Asia/Taipei date +'%Y-%m-%dT%H:%M:%S%z')" "$reason" \
    >> "$LOG_DIR/preflight.log" 2>/dev/null || true
  exit 3
}

# GNU `timeout` 在 macOS 預設不存在。探針必須有上限，否則權限對話卡住會讓 runner 永遠停在 preflight。
# 沒有 GNU/BSD timeout 時用 perl fork + alarm（exec 會清掉 alarm，所以不能 perl -e 'alarm; exec'）。
with_timeout() {
  local secs="$1"
  shift
  if command -v timeout >/dev/null 2>&1; then
    command timeout "$secs" "$@"
    return $?
  fi
  if command -v gtimeout >/dev/null 2>&1; then
    command gtimeout "$secs" "$@"
    return $?
  fi
  command -v perl >/dev/null 2>&1 || {
    echo "error: PATH 上找不到 timeout / gtimeout / perl，無法為 headless 探針設上限" >&2
    return 127
  }
  perl -e '
    my $secs = shift;
    my $pid = fork();
    die "fork: $!\n" unless defined $pid;
    if ($pid == 0) { exec { $ARGV[0] } @ARGV; exit 127; }
    $SIG{ALRM} = sub { kill "TERM", $pid; waitpid $pid, 0; exit 124; };
    alarm $secs;
    waitpid $pid, 0;
    alarm 0;
    my $rc = $? == -1 ? 127 : ($? & 127) ? 128 + ($? & 127) : $? >> 8;
    exit $rc;
  ' "$secs" "$@"
}

# 探針 D：headless child 到底能不能跑一個 Bash tool call。
# 這是唯一驗得到 harness 權限閘門的探針，也是唯一要付一次 API 呼叫的 —— 一次小呼叫換掉
# 一整天的空轉。**MUST 同時驗 token 與 mktemp 產出的路徑**：只驗 token 的話，模型不呼叫
# 工具、直接把 token 回給你也會通過，而那正是本探針要抓的失敗。
preflight_headless_probe() {
  local out rc nonce proof_file proof
  nonce="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(16).toString("hex"))')" \
    || preflight_fail "無法產生 headless proof nonce"
  proof_file="$REPO/.clade/work-loop/preflight-proof-$nonce"
  rm -f "$proof_file"
  out="$(cd "$REPO" && with_timeout 300 "${CHILD_ENV[@]}" WORK_LOOP_RUNNER_CHILD=1 WORK_LOOP_SCAN_PREFLIGHT_NONCE="$nonce" "$CHILD_BIN" --print \
    --allowedTools "$SCAN_PREFLIGHT_RULE" --permission-mode "$PERM_MODE" \
    "Run exactly this command with the Bash tool: $SCAN_PREFLIGHT_CMD
Do not claim success unless the command completed. No other tool calls." 2>&1)"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    rm -f "$proof_file"
    preflight_fail "headless child exit=${rc}（權限閘門拒絕或 claude 不可用）—— 尾巴：$(printf '%s' "$out" | tail -3 | tr '\n' ' ')"
  fi
  proof="$(head -1 "$proof_file" 2>/dev/null || true)"
  rm -f "$proof_file"
  [ "$proof" = "$nonce" ] \
    || preflight_fail "headless child 未產生 runner-verifiable proof（模型文字不採信）—— 尾巴：$(printf '%s' "$out" | tail -3 | tr '\n' ' ')"
}

run_preflight() {
  if [ "$ORIGIN" = ccg ] || [ "$ORIGIN" = ccx ]; then
    [ -x "$CHILD_BIN" ] || preflight_fail "起源是 $ORIGIN 但找不到可執行的 $CHILD_BIN"
  else
    command -v claude >/dev/null 2>&1 || preflight_fail "PATH 上找不到 claude"
  fi
  command -v node >/dev/null 2>&1 || preflight_fail "PATH 上找不到 node"

  local probe="$REPO/.clade/work-loop/.preflight-probe"
  ( : > "$probe" ) 2>/dev/null || preflight_fail "repo 不可寫（${probe}）"
  rm -f "$probe"

  # 待辦源一個都讀不到 = 這輪 scan 必然空手而回。spectra repo 才有 openspec/，缺它屬正常。
  local has_source=0
  for f in "$REPO/HANDOFF.md" "$REPO/docs/tech-debt.md" "$REPO/openspec/changes"; do
    [ -r "$f" ] && has_source=1
  done
  [ "$has_source" = 1 ] || preflight_fail "HANDOFF.md / docs/tech-debt.md / openspec/changes 一個都讀不到"

  preflight_headless_probe
  echo "preflight ok（claude / node / repo 可寫 / 待辦源可讀 / headless Bash 可用）"
}

# ── 待辦源健康門檻 ────────────────────────────────────────────────────────────
# 「跑得起來」與「有事可做」是兩件事，所以是兩道門。ready 少於門檻時輸出的是**待辦枯竭**，
# NEVER 是故障 —— 這種收尾要人補彈藥，不是查 log。
#
# helper 缺席或回非數字時**放行**：門檻是省成本的優化，NEVER 讓它變成起不了 runner 的新故障。
run_ready_gate() {
  [ "$MIN_READY" -gt 0 ] 2>/dev/null || return 0
  [ -f "$READY_HELPER" ] || { echo "⚠ 找不到 ready-count helper，略過待辦源健康門檻"; return 0; }

  local json ready
  json="$(cd "$REPO" && node "$READY_HELPER" --repo "$REPO" --json 2>/dev/null)" || {
    echo "⚠ ready-count 執行失敗，略過待辦源健康門檻"
    return 0
  }
  ready="$($NODE_PLAIN -e 'try{const r=JSON.parse(process.argv[1]).ready;console.log(Number.isInteger(r)?r:"NaN")}catch{console.log("NaN")}' "$json" 2>/dev/null)"
  case "$ready" in
    ''|*[!0-9]*) echo "⚠ ready-count 輸出無法解析，略過待辦源健康門檻"; return 0 ;;
  esac

  if [ "$ready" -lt "$MIN_READY" ]; then
    echo "== 待辦枯竭：ready=$ready < ${MIN_READY}，需 attended 補彈藥（跑 attended /work-loop 清算 awaiting[]，或補 HANDOFF / tech-debt 條目）"
    printf '%s\tready-gate\tready=%s min=%s\n' "$(TZ=Asia/Taipei date +'%Y-%m-%dT%H:%M:%S%z')" "$ready" "$MIN_READY" \
      >> "$LOG_DIR/preflight.log" 2>/dev/null || true
    exit 4
  fi
  echo "待辦源健康：ready=${ready}（門檻 ${MIN_READY}）"
}

# ── 互斥鎖門檻 ────────────────────────────────────────────────────────────────
# 「已有 runner 在跑」不是故障。status 的析取判準在 work-loop-lock.ts，NEVER 在
# bash 重寫 heartbeat 窗口或 pid 存活。helper 缺席或輸出無法解析時放行：門是優化，
# NEVER 讓它變成起不了 runner 的新故障。
#
# --dry-run 略過（只印指令，不該拒絕）。--skip-preflight 不略過——鎖被持有不是
# 探針誤判，兩者是不同 failure class。
run_lock_gate() {
  [ "$DRY_RUN" = 1 ] && return 0
  [ -f "$LOCK_HELPER" ] || { echo "⚠ 找不到 lock helper，略過互斥鎖門檻"; return 0; }

  local json held session pid age
  json="$(cd "$REPO" && node "$LOCK_HELPER" status --json 2>/dev/null)" || {
    echo "⚠ lock status 執行失敗，略過互斥鎖門檻"
    return 0
  }
  held="$($NODE_PLAIN -e 'try{const s=JSON.parse(process.argv[1]);console.log(s.held===true?"true":s.held===false?"false":"NaN")}catch{console.log("NaN")}' "$json" 2>/dev/null)"
  case "$held" in
    false) return 0 ;;
    true) ;;
    *) echo "⚠ lock status 輸出無法解析，略過互斥鎖門檻"; return 0 ;;
  esac

  session="$($NODE_PLAIN -e 'try{const s=JSON.parse(process.argv[1]);console.log(typeof s.sessionId==="string"?s.sessionId:"?") }catch{console.log("?")}' "$json" 2>/dev/null)"
  pid="$($NODE_PLAIN -e 'try{const p=JSON.parse(process.argv[1]).pid;console.log(p==null?"?":String(p))}catch{console.log("?")}' "$json" 2>/dev/null)"
  age="$($NODE_PLAIN -e 'try{const a=JSON.parse(process.argv[1]).heartbeatAgeMin;console.log(typeof a==="number"?a:"?")}catch{console.log("?")}' "$json" 2>/dev/null)"

  echo "== 已有 runner 在跑：sessionId=$session pid=$pid heartbeatAgeMin=$age"
  printf '%s\tlock-gate\tsessionId=%s pid=%s heartbeatAgeMin=%s\n' \
    "$(TZ=Asia/Taipei date +'%Y-%m-%dT%H:%M:%S%z')" "$session" "$pid" "$age" \
    >> "$LOG_DIR/preflight.log" 2>/dev/null || true
  exit 6
}

runner_stop_reason=""
runner_exit_code=0
if ! guard_runner_quarantine startup; then
  runner_exit_code=5
  print_runner_summary
  exit "$runner_exit_code"
fi

run_lock_gate

if [ "$DRY_RUN" = 1 ] || [ "$SKIP_PREFLIGHT" = 1 ]; then
  echo "preflight 略過（$([ "$DRY_RUN" = 1 ] && echo --dry-run || echo --skip-preflight)）"
else
  run_preflight
  run_ready_gate
fi

exit_fail_streak=0
no_progress_streak=0
start_round="$(round_of)"
echo "work-loop runner: repo=$REPO  起始 round=$start_round  max=$MAX_ROUNDS  perm=$PERM_MODE  origin=$ORIGIN  launcher=$CHILD_BIN"

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

  if ! guard_runner_quarantine prelaunch; then
    runner_exit_code=5
    break
  fi

  before="$(round_of)"
  # 兩個格式一次取，避免跨秒導致 log 檔名與畫面時間對不起來。
  # ts = 檔名用（無空白 / 冒號）；ts_human = 畫面用。兩者同為 UTC+8（Asia/Taipei），方便對照 log 檔。
  IFS='|' read -r ts ts_human <<<"$(TZ=Asia/Taipei date +'%Y%m%dT%H%M%S|%Y-%m-%d %H:%M:%S')"
  log="$LOG_DIR/round-$ts.log"

  # 每輪都是新 process = 新 context。--print 跑完就退出。
  # 參數順序有意義，NEVER 重排：`--add-dir` 與 `--allowedTools` 都是**變參**選項，會一路吃到
  # 下一個 flag 為止。把任一者排在最後、prompt 前面，prompt 就會被當成 option value 吞掉，
  # claude 回 `Input must be provided either through stdin or as a prompt argument when using --print`
  # ——錯誤訊息完全沒提是哪個 variadic option，2026-08-05 曾因此連兩輪 exit=1。
  # 所以兩個 variadic option 後面都 MUST 接另一個 flag 當終止符。
  # `--runner-child` 是模型可見的身分 marker；env 是機械補強。Step 0 命中任一者都只跑單輪，
  # NEVER 再 route 回 runner，否則 child 會遞迴啟動下一層 runner。
  #
  # **prompt cache 的前綴順序不在本檔管轄範圍內。** 前綴由 harness 組（CLAUDE.md → rules →
  # skill），runner 能給的只有 CLI flag 與最後那個 prompt 字串；HANDOFF.md / tech-debt.md 這些
  # 易變內容是 child 在回合中用工具讀進來的，本來就排在穩定前綴之後。所以這裡**沒有**可以重排
  # 的東西，NEVER 為了「把穩定內容排前面」在本檔加參數 —— 那會做出一個不影響 cache 的假改動。
  if round_is_uint "$before"; then
    origin_id="wl-r$((before + 1))"
  else
    origin_id="wl-run-$i"
  fi
  # dispatcher 讀這兩個 env 當 telemetry attribution 的機械 fallback；模型顯式帶 CLI 時 CLI 優先。
  # 每輪一個 origin-id，讓 round summary 不必用時間窗猜哪筆 dispatch 屬於哪輪。
  cmd=("${CHILD_ENV[@]}" WORK_LOOP_RUNNER_CHILD=1 "WORK_LOOP_MIN_WAKEUP_SECONDS=$MIN_WAKEUP" CLADE_DISPATCH_ORIGIN=work-loop "CLADE_DISPATCH_ORIGIN_ID=$origin_id" "$CHILD_BIN" --print --add-dir "$WT_PARENT" --allowedTools "$SCAN_HELPER_RULE" --permission-mode "$PERM_MODE" "/work-loop --unattended --runner-child --linked-dispatch-mode foreground --min-wakeup-seconds $MIN_WAKEUP --scan-helper-command '$SCAN_HELPER_CMD'")

  if [ "$DRY_RUN" = 1 ]; then
    echo "[dry-run] round $(next_round_label "$before"): ${cmd[*]}"
    continue
  fi

  echo "== round $(next_round_label "$before") 起跑 ($ts_human) → $log"
  ( cd "$REPO" && "${cmd[@]}" ) >"$log" 2>&1
  rc=$?

  after="$(round_of)"

  # Mechanical ownership guard：不論 child exit code、round 是否前進、item cap 是否已滿，
  # process 一旦退出而 ledger 仍有 ownership，就不能用下一個 child 冒充原 owner 收割。
  if ! guard_runner_quarantine child-exit; then
    runner_exit_code=5
    break
  fi

  # 只有合法整數且 after > before 才是真前進，也是唯一會重設兩個 streak 的事件。
  # child 若已寫入進展但收尾 exit≠0，保留診斷但不把成功 round 累積成 exit failure。
  if round_is_uint "$before" && round_is_uint "$after" && [ "$after" -gt "$before" ]; then
    exit_fail_streak=0
    no_progress_streak=0
    if [ "$rc" -ne 0 ]; then
      echo "   ⚠ round $after 已前進，但 child exit=${rc}—— log 尾巴："
      tail -5 "$log" | sed 's/^/     /'
    else
      echo "   ✓ round $after 完成"
    fi
    continue
  fi

  if [ "$rc" -ne 0 ]; then
    exit_fail_streak=$((exit_fail_streak + 1))
    echo "   exit=${rc}（連續 exit 失敗 ${exit_fail_streak}）—— log 尾巴："
    tail -5 "$log" | sed 's/^/     /'
    # 鎖由 work-loop-lock.ts 管理；同一 runner pid 的下一輪會安全接手殘鎖。
    if [ "$exit_fail_streak" -ge 2 ]; then
      echo "== stop: 連續 2 輪 exit≠0，可能是系統性問題（log 在 ${LOG_DIR}）"
      release_runner_lock
      break
    fi
    continue
  fi

  # exit=0 但 state 相等、倒退、型別錯誤或損壞都算 no-progress。
  no_progress_streak=$((no_progress_streak + 1))
  echo "   ⚠ round 未前進或無效（$before → ${after}；連續未前進 ${no_progress_streak}）"
  if [ "$no_progress_streak" -ge 2 ]; then
    echo "== stop: state 連續 2 輪未前進"
    release_runner_lock
    break
  fi
done

print_runner_summary
exit "$runner_exit_code"
