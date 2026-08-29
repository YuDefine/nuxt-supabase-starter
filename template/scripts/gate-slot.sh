#!/usr/bin/env bash
# 🔒 LOCKED — managed by clade · Source: vendor/scripts/gate-slot.sh · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/gate-slot.sh
# clade gate-slot — 限制同時執行的 heavy gate（typecheck / test）數量。
#
# 為什麼存在：post-edit hook 每次編輯 .ts/.vue 都跑完整 typecheck，pre-push 又跑一次。
# 多個 consumer session 並行時，尖峰可同時有 3+ 個 vue-tsc（實測 ~266% CPU / 8.5 GiB RAM），
# 把整台開發 VM 拖進 CPU wait + swap thrash。這支腳本是唯一的併發閘門 SoT。
#
# usage:
#   gate-slot.sh <try|wait> <key> -- <command> [args...]
#
# modes:
#   try   取不到 slot 立刻 exit 75（EX_TEMPFAIL），呼叫端自行決定 skip（post-edit hook 走這條）
#   wait  等到取得 slot 才執行（pre-push / 手動 pnpm typecheck 走這條，品質 gate 不可略過）
#
# env:
#   CLADE_HEAVY_GATE_SLOTS   整台機器同時執行上限（預設 2，clamp 到 1..8）
#   CLADE_GATE_LOCK_DIR      lock 檔目錄（預設 ${XDG_RUNTIME_DIR:-/tmp}/clade-gates）
#   CLADE_GATE_WAIT_TIMEOUT  wait 模式最長等待秒數（預設 1800）
#   CLADE_GATE_SLOT_HELD     外層已持有 slot；本層直接 exec，不重複上鎖（防自我死鎖）
#
# 兩層鎖：
#   1. repo lock  —— 同一個 repo 同時只跑一個 heavy gate（去重：pre-push 與 post-edit 撞在一起）
#   2. slot lock  —— 整台機器同時只跑 N 個 heavy gate（跨 repo 總量上限）
# 兩層都用 flock(1)。fd 由 exec 出去的子行程繼承，鎖隨行程結束自動釋放（含被 kill / timeout）。
#
# 降級原則：flock 不存在、lock dir 不可寫、參數異常時一律 **直接執行原命令**，
# 絕不因為閘門本身故障而擋掉品質 gate。

set -uo pipefail

BUSY=75

usage() {
  printf 'usage: gate-slot.sh <try|wait> <key> -- <command> [args...]\n' >&2
  exit 2
}

[ "$#" -ge 3 ] || usage
mode=$1
key=$2
shift 2
[ "${1:-}" = "--" ] && shift
[ "$#" -ge 1 ] || usage
case "$mode" in
  try | wait) ;;
  *) usage ;;
esac

# 外層已持有 slot（例如 post-edit hook 已上鎖，內層 pnpm typecheck 又轉呼叫 clade-gate）。
# 沒有這個 escape hatch，第二層會在同一個 repo lock 上等自己 → 死鎖。
if [ "${CLADE_GATE_SLOT_HELD:-}" = "1" ]; then
  exec "$@"
fi

command -v flock >/dev/null 2>&1 || exec "$@"

# LOCK_DIR 決定「全機 semaphore 的命名空間」。NEVER 直接退 /tmp —— cron / systemd
# service / daemon 起的 gate 沒有 XDG_RUNTIME_DIR，會落到 /tmp/clade-gates 形成**第二套
# 獨立 semaphore**，全機上限靜默變成 2N，而且兩邊各自看起來都正常運作。用 id -u 推導
# /run/user/<uid>，只有它真的不存在才退 /tmp（TD-685）。
_default_lock_dir() {
  if [ -n "${XDG_RUNTIME_DIR:-}" ] && [ -d "$XDG_RUNTIME_DIR" ]; then
    printf '%s/clade-gates' "$XDG_RUNTIME_DIR"
    return
  fi
  _uid=$(id -u 2>/dev/null || echo '')
  if [ -n "$_uid" ] && [ -d "/run/user/$_uid" ]; then
    printf '/run/user/%s/clade-gates' "$_uid"
    return
  fi
  printf '/tmp/clade-gates'
}
LOCK_DIR=${CLADE_GATE_LOCK_DIR:-$(_default_lock_dir)}
mkdir -p "$LOCK_DIR" 2>/dev/null || exec "$@"

SLOTS=${CLADE_HEAVY_GATE_SLOTS:-2}
case "$SLOTS" in
  '' | *[!0-9]*) SLOTS=2 ;;
esac
[ "$SLOTS" -lt 1 ] && SLOTS=1
[ "$SLOTS" -gt 8 ] && SLOTS=8

# slots 降到 1 的機器上佇列會變深（一套 typecheck 3–8 分鐘，3–4 個 waiter 要排得完），
# 1800s 會讓品質 gate 變成隨機 exit 75。NEVER 改成無限等 —— 逾時的 holder 診斷是唯一
# 會留下現場的東西。
WAIT_TIMEOUT=${CLADE_GATE_WAIT_TIMEOUT:-3600}
case "$WAIT_TIMEOUT" in
  '' | *[!0-9]*) WAIT_TIMEOUT=1800 ;;
esac

safe_key=$(printf '%s' "$key" | tr -c 'A-Za-z0-9._-' '-')
REPO_LOCK="$LOCK_DIR/repo-$safe_key.lock"

# lock dir 存在但不可寫（權限 / 唯讀 fs）→ 降級直接跑，不要在這裡失敗。
: >>"$REPO_LOCK" 2>/dev/null || exec "$@"

exec 9>>"$REPO_LOCK"

# 印 lock holder 診斷到 stderr（逾時出口用）。
# 用法: print_holder_diag <lock_file> <context_msg>
# NEVER 自動 kill — 低 CPU 不蘊含卡死（I/O bound 同樣低 CPU）。
print_holder_diag() {
  local lock_file=$1 context=$2
  printf '\n── gate-slot diagnostic ──\n' >&2
  printf '75 = 等不到 slot，不是 gate 失敗（inner command 從未執行）\n' >&2
  printf 'context: %s\n' "$context" >&2
  printf 'lock file: %s\n' "$lock_file" >&2
  local holder_pids
  holder_pids=$(fuser "$lock_file" 2>/dev/null) || true
  if [ -n "$holder_pids" ]; then
    printf 'holder process(es):\n' >&2
    for pid in $holder_pids; do
      printf '  pid=%s\n' "$pid" >&2
      # NEVER 印完整 command line：agent 起的 gate 其 argv 可能帶 token / API key，而這段
      # 診斷會落進 CI log 與 session transcript（TD-685）。判孤兒需要的是 etime vs CPU time
      # 的落差與 PPID，不是完整參數 —— 要看參數的人自己去 `ps -p <pid> -o args=`，那是有
      # 意識的動作，不是被動落進 log。cwd 不含祕密，且是判「這是哪個 repo 的 gate」最有用的一格。
      ps -o pid=,ppid=,etime=,time=,comm= -p "$pid" 2>/dev/null | while IFS= read -r line; do
        printf '    %s\n' "$line" >&2
      done
      printf '    cwd=%s\n' "$(readlink "/proc/$pid/cwd" 2>/dev/null || echo unknown)"
    done
  else
    printf 'holder: (no process found on lock — may have just released)\n' >&2
  fi
  printf '──────────────────────────\n' >&2
}

# ── 等待期間的訊號處置（TD-685）──────────────────────────────────────────
# 沒有 trap 時，waiter 卡在下面的 `until acquire_slot; do sleep 2; done` 輪詢迴圈裡，
# Ctrl-C **不會**讓它離開 —— 2026-08-29 實測：送 SIGINT 後 waiter 存活，等 holder 釋放
# 後照樣執行了 inner command。使用者以為自己取消了，實際上那份工作照跑。
#
# 這裡只管**等待階段**。取到 slot 之後走 exec，行程映像被換掉、trap 一併消失，
# 訊號由 inner command 自己處置 —— 那正是想要的（NEVER 讓閘門攔截 gate 自己的 Ctrl-C）。
_gate_abort() {
  printf '\ngate-slot: 收到 %s，放棄等待 slot（inner command 未執行）\n' "$1" >&2
  exit "$2"
}
trap '_gate_abort SIGINT 130' INT
trap '_gate_abort SIGTERM 143' TERM

if [ "$mode" = wait ]; then
  if ! flock -w "$WAIT_TIMEOUT" 9; then
    print_holder_diag "$REPO_LOCK" "repo lock wait timed out after ${WAIT_TIMEOUT}s (key=$safe_key)"
    exit "$BUSY"
  fi
else
  flock -n 9 || exit "$BUSY"
fi

# 掃描 slot 1..N，取到第一個空的就持有。fd 11..18 對應 slot 1..8。
acquire_slot() {
  local i fd
  for i in $(seq 1 "$SLOTS"); do
    fd=$((10 + i))
    : >>"$LOCK_DIR/heavy-$i.lock" 2>/dev/null || continue
    eval "exec $fd>>\"\$LOCK_DIR/heavy-\$i.lock\"" 2>/dev/null || continue
    if flock -n "$fd"; then
      return 0
    fi
    eval "exec $fd>&-" 2>/dev/null || true
  done
  return 1
}

if ! acquire_slot; then
  if [ "$mode" = try ]; then
    exit "$BUSY"
  fi
  deadline=$(($(date +%s) + WAIT_TIMEOUT))
  until acquire_slot; do
    if [ "$(date +%s)" -ge "$deadline" ]; then
      # 印所有 slot lock 的 holder 診斷
      for si in $(seq 1 "$SLOTS"); do
        slot_lock="$LOCK_DIR/heavy-$si.lock"
        [ -f "$slot_lock" ] && print_holder_diag "$slot_lock" "slot $si/$SLOTS holder (slot acquire timed out after ${WAIT_TIMEOUT}s, key=$safe_key)"
      done
      exit "$BUSY"
    fi
    sleep 2
  done
fi

export CLADE_GATE_SLOT_HELD=1

# ── holder 端自願上界 ──────────────────────────────────────────────────────
# slot 數降到 1 之後，孤兒 holder 的代價從「半容量」升級成「全機 heavy gate 停擺」
# （pitfall 2026-08-22：一支十小時的 nuxt typecheck 孤兒把 repo lock 佔住，PPID=1、
# CPU time 46s）。這裡給 holder 自己一個上界讓它自我釋放。
#
# 這與已否決的「從外面 kill 判定為 stale 的 holder」不是同一件事：那條被否決是因為
# 低 CPU 不蘊含卡死，會誤殺別 session 正在跑的品質 gate。本段是**同一個行程自己**帶進來的
# 上界，沒有任何判斷、不看 CPU、不猜狀態，到點就結束自己。
#
# exec 而非背景執行：保住 TTY、保住 process group（Ctrl-C 照常送達）、鎖的 fd 由
# timeout 行程持有，它結束時一併釋放。逾時回 124（`timeout` 的標準碼）—— 與 exit 75
# 同型的「這是閘門說的話，不是 gate 說的話」，語義寫在 rules/core 與本註解。
# CLADE_HEAVY_GATE_MAX_RUNTIME=0 關閉。
MAX_RUNTIME=${CLADE_HEAVY_GATE_MAX_RUNTIME:-3600}
case "$MAX_RUNTIME" in
  '' | *[!0-9]*) MAX_RUNTIME=3600 ;;
esac
if [ "$MAX_RUNTIME" -gt 0 ] && command -v timeout >/dev/null 2>&1; then
  exec timeout --signal=TERM --kill-after=30 "$MAX_RUNTIME" "$@"
fi
exec "$@"
