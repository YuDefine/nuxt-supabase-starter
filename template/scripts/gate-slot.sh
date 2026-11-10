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
#   gate-slot.sh status
#
# modes:
#   try   取不到 slot 立刻 exit 75（EX_TEMPFAIL），呼叫端自行決定 skip（post-edit hook 走這條）
#   wait  等到取得 slot 才執行（pre-push / 手動 pnpm typecheck 走這條，品質 gate 不可略過）
#   status  唯讀：逐行印出 lock dir 內每個 lock 的持有者（TD-1072，見下方 print_status）
#
# env:
#   CLADE_HEAVY_GATE_SLOTS   整台機器同時執行上限（預設 2，clamp 到 1..8）
#   CLADE_GATE_LOCK_DIR      lock 檔目錄（預設 ${XDG_RUNTIME_DIR:-/tmp}/clade-gates）
#   CLADE_GATE_WAIT_TIMEOUT  wait 模式最長等待秒數（預設 1800）
#   CLADE_GATE_SLOT_HELD     外層已持有 heavy slot＋repo lock；本層直接 exec，不重複上鎖（防自我死鎖）。
#                            只有 heavy 路徑會 export 它——light 沒持有 heavy 資源，NEVER 替巢狀 gate 宣稱已持有
#   CLADE_GATE_LIGHT_HELD    外層已持有 light slot；只讓巢狀的 light 直接 exec，巢狀 heavy 照常取鎖
#   CLADE_GATE_SLOT_METRICS  設為檔案路徑時，取到 slot 後 append 一行 JSON
#                            {key,mode,class,lane,slots,slot_wait_ms}（lane＝general|expedite）（opt-in，未設不寫；寫失敗不影響 gate）
#   CLADE_GATE_CLASS         heavy（預設）| light。由 clade-gate 判定後設定，本層讀完即 unset（W-2026-09-24-gate-slot-light-lane）
#   CLADE_LIGHT_GATE_SLOTS   light 類整台機器同時執行上限（預設 2，clamp 到 1..8）
#   CLADE_GATE_URGENT        1＝這趟 heavy 指令屬 flow 判定的急件（由 clade-gate 設定，本層讀完即 unset；
#                            light 類忽略）。急件可取 expedite 保留名額、CPU 權重高於一般重指令（§ expedite lane）
#   CLADE_HEAVY_GATE_EXPEDITE_SLOTS  保留名額數（機器層設定；預設 0＝不啟用，行為與沒有保留名額時完全相同；clamp 0..4）
#   CLADE_HEAVY_GATE_STARVE_S        一般重指令的等待上限秒數（預設 900）；等滿後急件不得再插隊
#   CLADE_HEAVY_GATE_URGENT_CPU_WEIGHT  急件 scope 的 CPUWeight（預設 50，clamp 1..10000）
#   CLADE_HEAVY_GATE_SLICE   重指令 scope 優先掛的 slice（預設 cladeheavy.slice；unit 沒載入就退回 agent-workloads.slice）
#   CLADE_GATE_WORKTREE      本趟所屬 worktree（預設 git toplevel，取不到用 pwd -P）；寫進 holder sidecar 第 2 行（診斷用）
#   CLADE_GATE_HANG_WINDOW   卡死判定窗秒數（預設 300，0 關閉；見 § 卡死偵測）
#   CLADE_GATE_HANG_INTERVAL 卡死取樣間隔秒數（預設 15）
#   CLADE_GATE_HANG_GRACE    判定卡死後 SIGTERM 到 SIGKILL 的寬限秒數（預設 10）
#   CLADE_GATE_HANG_WATCH    額外要看的輸出檔（`:` 分隔，例：不在行程樹裡的 dev server log）
#   CLADE_GATE_OUTPUT_HEARTBEAT  clade-gate 每收到 inner 輸出就 touch 的檔；本層讀完即 unset
#   CLADE_GATE_HANG_REPORT   卡死原因改寫到這個檔（clade-gate 結束時印出）；本層讀完即 unset
#
# 兩層鎖：
#   1. repo lock  —— 同一個 repo 同時只跑一個 heavy gate（去重：pre-push 與 post-edit 撞在一起）
#   2. slot lock  —— 整台機器同時只跑 N 個 heavy gate（跨 repo 總量上限）
#
# light 類（W-2026-09-24-gate-slot-light-lane）：少數檔的定點測試不取上面兩層，改取獨立的 light-<i>.lock semaphore。
# 動機：heavy slot 降到 1 之後（TD-685），重跑 5 個小測試檔要排在別 repo 的整套 suite 後面，
# agent 於是自己繞過閘門直跑——那才是真正沒有上限的路徑。light 類仍有全機上限、仍進記憶體
# scope 與 MAX_RUNTIME，**NEVER** 讓它完全免閘。判定「算不算 light」只在 clade-gate，本檔只認 env。
# 兩層都用 flock(1)。fd 由 exec 出去的子行程繼承，鎖隨行程結束自動釋放（含被 kill / timeout）。
#
# 降級原則：flock 不存在、lock dir 不可寫、參數異常時一律 **直接執行原命令**，
# 絕不因為閘門本身故障而擋掉品質 gate。

set -uo pipefail

BUSY=75

usage() {
  printf 'usage: gate-slot.sh <try|wait> <key> -- <command> [args...] | gate-slot.sh status\n' >&2
  exit 2
}

if [ "${1:-}" = status ]; then
  [ "$#" -eq 1 ] || usage
  mode=status
else
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
fi

# 只作用於這一層：讀完就 unset，被包的命令裡再進 gate-slot 時回到 heavy（同 CLADE_GATE_MODE）。
# MUST 在任何「降級直接 exec」之前：flock 不存在、lock dir 建不起來、SLOT_HELD 等路徑都會
# 直接 exec inner command，放在後面它就帶著 light 外洩進去。
GATE_CLASS=heavy
[ "${CLADE_GATE_CLASS:-}" = light ] && GATE_CLASS=light
unset CLADE_GATE_CLASS
# 急件旗標同 CLADE_GATE_CLASS：只作用於這一層，讀完就 unset（巢狀 gate 不繼承身分）。
GATE_URGENT=0
[ "${CLADE_GATE_URGENT:-}" = 1 ] && GATE_URGENT=1
unset CLADE_GATE_URGENT
OUTPUT_HEARTBEAT=${CLADE_GATE_OUTPUT_HEARTBEAT:-}
HANG_REPORT=${CLADE_GATE_HANG_REPORT:-}
unset CLADE_GATE_OUTPUT_HEARTBEAT CLADE_GATE_HANG_REPORT

# 外層已持有 slot（例如 post-edit hook 已上鎖，內層 pnpm typecheck 又轉呼叫 clade-gate）。
# 沒有這個 escape hatch，第二層會在同一個 repo lock 上等自己 → 死鎖。
if [ "$mode" != status ] && [ "${CLADE_GATE_SLOT_HELD:-}" = "1" ]; then
  exec "$@"
fi
# light 裡再進 light：已經佔著一格 light，再排一格在 CLADE_LIGHT_GATE_SLOTS=1 時會等自己。
# 巢狀 heavy 不走這裡——它要的 repo lock／heavy slot 外層 light 並沒有持有。
if [ "$mode" != status ] && [ "$GATE_CLASS" = light ] && [ "${CLADE_GATE_LIGHT_HELD:-}" = "1" ]; then
  exec "$@"
fi

[ "$mode" = status ] || command -v flock >/dev/null 2>&1 || exec "$@"

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
[ "$mode" = status ] || mkdir -p "$LOCK_DIR" 2>/dev/null || exec "$@"

# 上限 clamp（heavy 20、light 8）與 CI 併發設定的 SoT：scripts/test-lanes/lane-capacity.json
# runner.heavyGateSlotsMax／lightGateSlotsMax——改這裡的 clamp 時同步那個檔（test/lane-capacity-sot.test.ts 擋漂移）。
# heavy clamp 要涵蓋該主機的 host-cap（容量比例判準 Rule 4）；只改 .env 而 clamp 沒放寬，值會被靜默壓回 clamp。
SLOTS=${CLADE_HEAVY_GATE_SLOTS:-2}
case "$SLOTS" in
  '' | *[!0-9]*) SLOTS=2 ;;
esac
[ "$SLOTS" -lt 1 ] && SLOTS=1
[ "$SLOTS" -gt 20 ] && SLOTS=20

LIGHT_SLOTS=${CLADE_LIGHT_GATE_SLOTS:-2}
case "$LIGHT_SLOTS" in
  '' | *[!0-9]*) LIGHT_SLOTS=2 ;;
esac
[ "$LIGHT_SLOTS" -lt 1 ] && LIGHT_SLOTS=1
[ "$LIGHT_SLOTS" -gt 8 ] && LIGHT_SLOTS=8

# ── expedite lane（W-2026-10-23-canary-psi-heavy-gate-urgent-expedite-lane 決策 7）──────────────────
# 保留名額是另一組 expedite-<i>.lock，只有 flow 判定的急件（CLADE_GATE_URGENT=1）能取，不借給一般重指令（FR-021）。
# 數量走機器層設定（預設 0＝關閉，FR-017 不把初值寫死在 script）；關閉時 GATE_URGENT 一律當一般工作。
EXPEDITE_SLOTS=${CLADE_HEAVY_GATE_EXPEDITE_SLOTS:-0}
case "$EXPEDITE_SLOTS" in
  '' | *[!0-9]*) EXPEDITE_SLOTS=0 ;;
esac
[ "$EXPEDITE_SLOTS" -gt 4 ] && EXPEDITE_SLOTS=4
STARVE_S=${CLADE_HEAVY_GATE_STARVE_S:-900}
case "$STARVE_S" in
  '' | *[!0-9]*) STARVE_S=900 ;;
esac
URGENT_CPU_WEIGHT=${CLADE_HEAVY_GATE_URGENT_CPU_WEIGHT:-50}
case "$URGENT_CPU_WEIGHT" in
  '' | *[!0-9]*) URGENT_CPU_WEIGHT=50 ;;
esac
[ "$URGENT_CPU_WEIGHT" -lt 1 ] && URGENT_CPU_WEIGHT=1
[ "$URGENT_CPU_WEIGHT" -gt 10000 ] && URGENT_CPU_WEIGHT=10000
LANE_URGENT=0
if [ "$GATE_CLASS" = heavy ] && [ "$GATE_URGENT" = 1 ] && [ "$EXPEDITE_SLOTS" -gt 0 ]; then
  LANE_URGENT=1
fi
# 保留名額啟用時，一般重指令與急件才需要登記等候、互相讓位；關閉時整段不產生任何檔案。
EXPEDITE_ON=0
[ "$GATE_CLASS" = heavy ] && [ "$EXPEDITE_SLOTS" -gt 0 ] && EXPEDITE_ON=1
WAIT_DIR="$LOCK_DIR/waiting"

if [ "$GATE_CLASS" = light ]; then
  SLOT_PREFIX=light
  ACTIVE_SLOTS=$LIGHT_SLOTS
else
  SLOT_PREFIX=heavy
  ACTIVE_SLOTS=$SLOTS
fi

# ── status：唯讀的持有者清單（TD-1072）────────────────────────────────────
# 呼叫端（propagate 的 push 逾時判讀）要回答「我排隊時是誰佔著 slot」。證據 MUST 由
# gate-slot 自己給 —— lock dir 的推導、slot 數的 clamp 都只在本檔，NEVER 在呼叫端
# 另寫一份會漂移的路徑邏輯。
#
# 輸出：每個持有者一行 tab 分隔的 key=value，cwd 放最後；沒有持有者的 lock 印 `state=free`。
# 判不出來一律 `state=unknown` 帶 `reason=`，NEVER 把判不出印成 free。
# NEVER 用 `flock -n` 探測：那會短暫搶到 slot，讓正在輪詢的 waiter 錯過一輪。
# 同 print_holder_diag：只印 comm 不印 argv（argv 可能帶 token，TD-685）。
#
# NEVER 把 `fuser <lock>` 的清單報成持有者：它列的是「開著 lock 檔的行程」，排隊者也開著——
# repo lock 是先 `exec 9>>` 才 `flock -w`，acquire_slot 取不到 slot 前也短暫開檔。
# 持有者由下面三層判定，依序：
#   1. sidecar `<lock>.holder`：取到鎖的 gate-slot 自己寫的 $$（之後 exec timeout／
#      systemd-run --scope 都不換 pid、fd 一路繼承），且該 pid 此刻真的開著這個 lock 檔
#   2. /proc/locks：kernel 說這個 inode 有沒有被 FLOCK 佔（排隊者不會出現在裡面）。它的 pid
#      欄是取鎖那支 `flock` 子行程、通常已結束，所以只判 held／free，不拿來認人
#   3. 兩者都沒有（macOS 等）：有開檔者就 unknown 並列出 openers（含排隊者），否則 free
print_status() {
  local i lock
  printf 'lock_dir=%s\tslots=%s\n' "$LOCK_DIR" "$SLOTS"
  for i in $(seq 1 "$SLOTS"); do
    print_lock_status "$LOCK_DIR/heavy-$i.lock" "slot=$i/$SLOTS"
  done
  # 保留名額只印有持有者的（同 light；heavy 行的 free/held 語義不變）。
  for i in $(seq 1 "$EXPEDITE_SLOTS"); do
    [ -f "$LOCK_DIR/expedite-$i.lock" ] &&
      print_lock_status "$LOCK_DIR/expedite-$i.lock" "slot=expedite-$i/$EXPEDITE_SLOTS" held-only
  done
  # light 類只印有持有者的：呼叫端（push-timeout-phase）讀 heavy 行判「誰佔著 slot」，
  # free 的 light 行對它是雜訊。
  for i in $(seq 1 "$LIGHT_SLOTS"); do
    [ -f "$LOCK_DIR/light-$i.lock" ] &&
      print_lock_status "$LOCK_DIR/light-$i.lock" "slot=light-$i/$LIGHT_SLOTS" held-only
  done
  for lock in "$LOCK_DIR"/repo-*.lock; do
    # repo lock 一個 repo 一支、只增不刪；free 的全印出來是雜訊，只印有持有者的。
    [ -f "$lock" ] && print_lock_status "$lock" 'slot=repo' held-only
  done
}

# sidecar 的 pid 還活著、而且真的開著這個 lock 檔才算數；否則是上一任留下的 stale 檔。
valid_holder_pid() {
  local lock=$1 pid real fd
  [ -r "$lock.holder" ] || return 1
  pid=$(head -n 1 "$lock.holder" 2>/dev/null)
  case "$pid" in '' | *[!0-9]*) return 1 ;; esac
  [ -d "/proc/$pid/fd" ] || return 1
  real=$(readlink -f "$lock" 2>/dev/null) || return 1
  for fd in /proc/"$pid"/fd/*; do
    if [ "$(readlink "$fd" 2>/dev/null)" = "$real" ]; then
      printf '%s' "$pid"
      return 0
    fi
  done
  return 1
}

# 0 = held，1 = free，2 = 判不出（沒有 /proc/locks 或 stat 不是 GNU 形式）。
kernel_lock_state() {
  local lock=$1 dev ino key
  [ -r /proc/locks ] || return 2
  dev=$(stat -c '%d' "$lock" 2>/dev/null) || return 2
  ino=$(stat -c '%i' "$lock" 2>/dev/null) || return 2
  case "$dev$ino" in '' | *[!0-9]*) return 2 ;; esac
  # glibc dev_t 解碼；/proc/locks 以 `%02x:%02x:%lu` 印 major:minor:inode。
  key=$(printf '%02x:%02x:%s' "$(((dev >> 8) & 0xfff))" "$(((dev & 0xff) | ((dev >> 12) & 0xfff00)))" "$ino")
  grep -q "FLOCK .* $key " /proc/locks && return 0
  return 1
}

print_lock_status() {
  local lock=$1 label=$2 filter=${3:-} name pid line state openers
  name=$(basename "$lock")
  if [ ! -f "$lock" ]; then
    [ "$filter" = held-only ] || printf 'lock=%s\t%s\tstate=free\n' "$name" "$label"
    return
  fi
  if pid=$(valid_holder_pid "$lock"); then
    line=$(ps -o etime=,comm= -p "$pid" 2>/dev/null | awk '{$1=$1; print}')
    if [ -n "$line" ]; then
      printf 'lock=%s\t%s\tstate=held\tpid=%s\tetime=%s\tcomm=%s\tcwd=%s\n' \
        "$name" "$label" "$pid" "${line%% *}" "${line#* }" \
        "$(readlink "/proc/$pid/cwd" 2>/dev/null || echo unknown)"
      return
    fi
  fi
  kernel_lock_state "$lock"
  state=$?
  if [ "$state" -eq 0 ]; then
    # 被佔但 sidecar 無效：持有者是沒寫 sidecar 的舊版 gate-slot，或非 gate-slot 的 flock。
    printf 'lock=%s\t%s\tstate=held\tholder=unknown\n' "$name" "$label"
    return
  fi
  if [ "$state" -eq 1 ]; then
    [ "$filter" = held-only ] || printf 'lock=%s\t%s\tstate=free\n' "$name" "$label"
    return
  fi
  if ! command -v fuser >/dev/null 2>&1; then
    printf 'lock=%s\t%s\tstate=unknown\treason=no-fuser\n' "$name" "$label"
    return
  fi
  openers=$(fuser "$lock" 2>/dev/null | awk '{$1=$1; gsub(/ /, ","); print}')
  if [ -z "$openers" ]; then
    [ "$filter" = held-only ] || printf 'lock=%s\t%s\tstate=free\n' "$name" "$label"
    return
  fi
  printf 'lock=%s\t%s\tstate=unknown\treason=no-proc-locks\topeners=%s\n' "$name" "$label" "$openers"
}

if [ "$mode" = status ]; then
  print_status
  exit 0
fi

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

# ── 不能自己等自己 ─────────────────────────────────────────────────────────────
# 持有鎖的 gate 是本行程的祖先時，等下去永遠等不到：祖先要等本行程（它的子孫）結束才會放鎖。
# 典型是巢狀 gate 被剝掉 CLADE_GATE_SLOT_HELD 後又進 wait。這種情況立刻 exit 75 並說明，NEVER 排隊。
# 同一棵 worktree 的其他 gate（平行的 light 重跑、post-edit 的短 `try` typecheck、pre-push）不是祖先，
# 會自己跑完放鎖，照常排隊；卡住的持有者由下面 § 卡死偵測自己收掉，不靠這裡判。
# 只認 sidecar（valid_holder_pid 驗過 pid 真的開著該鎖）；沒有 sidecar 的持有者判不出是誰，照舊排隊。
# try 模式本來就立刻 75，不經這裡。
GATE_WORKTREE=${CLADE_GATE_WORKTREE:-}
if [ -z "$GATE_WORKTREE" ]; then
  GATE_WORKTREE=$(git rev-parse --show-toplevel 2>/dev/null) || GATE_WORKTREE=
  [ -n "$GATE_WORKTREE" ] || GATE_WORKTREE=$(pwd -P 2>/dev/null || pwd)
fi

# 本行程的祖先 pid（ppid 鏈，最多 64 層），一行一個。
_ancestor_pids() {
  local p=$$ i
  for i in $(seq 1 64); do
    p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d '[:space:]')
    case "$p" in '' | *[!0-9]* | 0 | 1) return 0 ;; esac
    printf '%s\n' "$p"
  done
}

# 印第一個「持有者是本行程祖先」的 `<lock> <pid>`；沒有就回 1。
ancestor_holder() {
  local lock pid ancestors=
  for lock in "$@"; do
    pid=$(valid_holder_pid "$lock") || continue
    [ -n "$ancestors" ] || ancestors=$(_ancestor_pids)
    if printf '%s\n' "$ancestors" | grep -qx "$pid"; then
      printf '%s %s' "$lock" "$pid"
      return 0
    fi
  done
  return 1
}

refuse_self_wait() {
  local lock=$1 pid=$2 line
  line=$(ps -o etime=,comm= -p "$pid" 2>/dev/null | awk '{$1=$1; print}')
  printf '\ngate-slot: 拒絕排隊——持有這個鎖的 gate 是本行程的祖先，排下去是自己等自己（inner command 未執行）\n' >&2
  printf '  worktree: %s\n' "$GATE_WORKTREE" >&2
  printf '  lock: %s\n' "$lock" >&2
  printf '  holder: pid=%s etime=%s comm=%s\n' "$pid" "${line%% *}" "${line#* }" >&2
  printf '  處置：等那支 gate 跑完再重跑；它若已卡住，kill 它的行程樹（kill -- -<pgid> 或 kill %s）後重跑。\n' "$pid" >&2
  exit "$BUSY"
}

# 取到鎖的那一刻由本行程寫下自己是持有者（status 的第 1 層證據，見 print_status 上方）。
# 原子寫；寫失敗不影響 gate。stale 檔 NEVER 主動刪：會和剛取到鎖、正要覆寫的新持有者競態。
# 第 2 行是本趟的 worktree（供診斷）；status 只讀第 1 行，舊版 sidecar 沒有第 2 行照樣有效。
record_holder() {
  local tmp="$1.holder.$$"
  if ! { printf '%s\n%s\n' "$$" "$GATE_WORKTREE" >"$tmp" && mv -f "$tmp" "$1.holder"; } 2>/dev/null; then
    rm -f "$tmp" 2>/dev/null
  fi
  return 0
}

# 印 lock holder 診斷到 stderr（逾時出口用）。
# 用法: print_holder_diag <lock_file> <context_msg>
# 本函式只印不殺——低 CPU 單獨不蘊含卡死（I/O bound 同樣低 CPU）。holder 自己帶的卡死偵測見 § 卡死偵測。
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
      # cgroup 節流三格（TD-909）：2026-09-03 那次的 holder 不是 I/O bound 也不是 CPU
      # bound —— 它卡在 `__mem_cgroup_handle_over_high`，因為它繼承了呼叫端 session 的
      # scope（`memory.high` 6 GiB）而不是自己的。當時要靠一輪人工鑑識才問出「scope 是誰的」，
      # 而那三格全都在 /proc 裡、印出來零成本。**印、不判、不殺** —— 判定仍歸讀的人。
      local holder_wchan holder_scope holder_high
      holder_wchan=$(cat "/proc/$pid/wchan" 2>/dev/null || echo unknown)
      holder_scope=$(awk -F/ '{print $NF}' "/proc/$pid/cgroup" 2>/dev/null | tail -1)
      printf '    wchan=%s\n' "${holder_wchan:-unknown}" >&2
      printf '    cgroup-scope=%s\n' "${holder_scope:-unknown}" >&2
      holder_high=$(awk '/^high /{print $2}' \
        "/sys/fs/cgroup$(awk -F: '{print $3}' "/proc/$pid/cgroup" 2>/dev/null | tail -1)/memory.events" \
        2>/dev/null)
      [ -n "$holder_high" ] && printf '    memory.events high=%s\n' "$holder_high" >&2
      if [ "$holder_wchan" = "__mem_cgroup_handle_over_high" ]; then
        printf '    ⚠ 此刻正被 cgroup memory.high 節流。這是瞬時狀態，單次取樣命中\n' >&2
        printf '      NEVER 讀成「卡死了、可以放掉它的 slot」——每個吃記憶體的行程都會經過\n' >&2
        printf '      這個 path（上面的 high 計數就是進出次數）。要判的是 scope 對不對。\n' >&2
      fi
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
  # Reap this helper's background lock waiter before closing its inherited fd.
  # These are our wait commands, not another job holding the lock.
  #
  # 逐 pid `wait "$pid"`，NEVER 裸 `wait`（TD-1110）：process-group SIGTERM 同時打到
  # 背景 flock 與本 shell 時，flock 可能先死、並已被 `wait "$!"` 的 wait4 reap 掉，
  # trap 卻在 bash 更新 job 狀態之前觸發 —— job table 仍記它 running。此時裸 `wait`
  # 會進入 wait4→ECHILD→重試 的自旋（100% CPU、永不返回，WAIT_TIMEOUT 也救不了，
  # 因為計時的 flock 已經死了）；`wait "$pid"` 對同一個過期 pid 則是回 127 立即返回。
  # bash 5.3.9 實測：裸 wait 無負載 11/150、24 CPU burner 下 46/100 卡死；逐 pid 0/250。
  for _gate_wait_pid in $(jobs -pr); do
    # 同一張過期 job table 還有第二個效應：列出的 pid 可能已被 reap 並被 kernel 配給
    # 不相干的行程，kill 會誤殺。送訊號前確認 PPID 仍為本 shell；ps 不可用或 pid 已
    # 消失時（回傳空）退回既有行為——ESRCH 本來就無害，而活著的 flock 是 $$ 的子行程。
    _gate_ppid=$(ps -o ppid= -p "$_gate_wait_pid" 2>/dev/null | tr -d '[:space:]')
    if [ -z "$_gate_ppid" ] || [ "$_gate_ppid" = "$$" ]; then
      kill -TERM "$_gate_wait_pid" 2>/dev/null || true
    fi
    wait "$_gate_wait_pid" 2>/dev/null || true
  done
  printf '\ngate-slot: 收到 %s，放棄等待 slot（inner command 未執行）\n' "$1" >&2
  exit "$2"
}
trap '_gate_abort SIGINT 130' INT
trap '_gate_abort SIGTERM 143' TERM

# 毫秒時鐘用 bash 5 的 EPOCHREALTIME，NEVER 用 `date +%s%3N`：BSD date 原樣印 `…3N`，
# uutils date（2026-09-17 本機實測）把 %3N 印成完整 9 位奈秒，兩者都讓算術靜默錯位。
# 取不到（bash 3.2 無此變數）就當量不到、不寫。
_now_ms() {
  local v=${EPOCHREALTIME:-}
  v=${v/[.,]/}
  case "$v" in '' | *[!0-9]*) return 0 ;; esac
  printf '%s' "$((v / 1000))"
}
_wait_started_ms=$(_now_ms)

# light 類不取 repo lock：repo lock 防的是同一 repo 兩套 heavy gate 重複跑，而定點重跑
# 幾個檔正是在同 repo 的 heavy gate 旁邊做的事——排在它後面就回到 W-2026-09-24-gate-slot-light-lane 的原狀。
if [ "$GATE_CLASS" = heavy ]; then
  exec 9>>"$REPO_LOCK"
  if [ "$mode" = wait ]; then
    if ! flock -n 9; then
      _self=$(ancestor_holder "$REPO_LOCK") && refuse_self_wait "${_self% *}" "${_self##* }"
      # Bash defers traps while a foreground flock blocks; its wait builtin is
      # interruptible, so PID-only cancellation can abort a same-repo wait too.
      flock -w "$WAIT_TIMEOUT" 9 &
      if ! wait "$!"; then
        print_holder_diag "$REPO_LOCK" "repo lock wait timed out after ${WAIT_TIMEOUT}s (key=$safe_key)"
        exit "$BUSY"
      fi
    fi
  else
    flock -n 9 || exit "$BUSY"
  fi
  record_holder "$REPO_LOCK"
fi

# 掃描 <prefix>-1..<n>，取到第一個空的就持有。fd 11..30 對應 slot 1..20。
# 失敗時 fd 已全部關閉，所以同一次嘗試接著掃另一組名額池（expedite → heavy）時 fd 編號不會撞。
_scan_pool() {
  local prefix=$1 n=$2 i fd
  for i in $(seq 1 "$n"); do
    fd=$((10 + i))
    : >>"$LOCK_DIR/$prefix-$i.lock" 2>/dev/null || continue
    eval "exec $fd>>\"\$LOCK_DIR/\$prefix-\$i.lock\"" 2>/dev/null || continue
    if flock -n "$fd"; then
      record_holder "$LOCK_DIR/$prefix-$i.lock"
      return 0
    fi
    eval "exec $fd>&-" 2>/dev/null || true
  done
  return 1
}

# ── expedite lane：等候登記與雙向讓位（決策 7）──────────────────────────────────
# 登記檔 $WAIT_DIR/{urgent,general}-<pid>：第 1 行是開始等候的 epoch 秒，第 2 行是 pid 的啟動時間戳（身分）。
# 活著＝pid 存活、身分（啟動時間戳）相符、且登記沒老過 WAIT_TIMEOUT：waiter 被 SIGKILL（agent timeout、OOM）時
# EXIT trap 不會跑，登記檔會殘留；pid 之後被不相干的行程重用時，單看 kill -0 會把它當成還在等，
# 所以身分不符或超齡的登記一律視為死登記並順手刪掉（waiting/ 不會無限長大）。
# 沒有常駐仲裁者：排隊順序全靠輪詢者自律，控制器或 flow 掛掉時所有重指令仍照常執行（NFR-007／NFR-008）。
# 登記與讀取失敗一律當「沒有人在等」，NEVER 因此卡住或擋住任何重指令。

# pid 的啟動時間戳：Linux 讀 /proc/<pid>/stat 第 22 欄（starttime），沒有 /proc 就用 ps lstart。
# 取不到印空字串；兩端都空則退回只看 kill -0 + 超齡判定。
_pid_ident() {
  local pid=$1 stat rest
  if [ -r "/proc/$pid/stat" ]; then
    stat=$(cat "/proc/$pid/stat" 2>/dev/null) || stat=
    # comm 欄可含空白與括號：從最後一個 ")" 之後數，starttime 是之後的第 20 個欄位。
    rest=${stat##*) }
    # shellcheck disable=SC2086
    set -- $rest
    if [ "$#" -ge 20 ]; then
      printf '%s' "${20}"
      return 0
    fi
  fi
  ps -o lstart= -p "$pid" 2>/dev/null | tr -s ' ' | sed 's/^ //'
  return 0
}
_wait_register() {
  [ "$EXPEDITE_ON" = 1 ] || return 0
  [ -n "${_wait_reg:-}" ] && return 0
  local kind=general
  [ "$LANE_URGENT" = 1 ] && kind=urgent
  mkdir -p "$WAIT_DIR" 2>/dev/null || return 0
  _wait_reg="$WAIT_DIR/$kind-$$"
  # 原子寫入：先在變數組好內容、寫到暫存檔再 mv。直接 `>` 會先截斷成空檔、等 _pid_ident 子行程跑完才有內容，
  # 這段空檔裡別的 waiter 的 _reg_alive 讀到空的第 1 行會把登記當死登記刪掉（雙向讓位就漏掉這個 waiter）。
  local _wait_content _wait_tmp="$WAIT_DIR/.tmp-$kind-$$"
  _wait_content="$(date +%s)
$(_pid_ident "$$")
"
  if printf '%s' "$_wait_content" >"$_wait_tmp" 2>/dev/null && mv -f "$_wait_tmp" "$_wait_reg" 2>/dev/null; then
    :
  else
    rm -f "$_wait_tmp" 2>/dev/null
    _wait_reg=
  fi
  return 0
}
_wait_unregister() {
  [ -n "${_wait_reg:-}" ] && rm -f "$_wait_reg" 2>/dev/null
  _wait_reg=
  return 0
}
# 自己的登記是否已等滿上限：和急件一側讀的是同一個檔（單一來源，兩邊判定不會分歧）。try 模式沒有登記＝永遠沒等滿。
_self_starved() {
  local started
  [ -n "${_wait_reg:-}" ] || return 1
  started=$(head -n 1 "$_wait_reg" 2>/dev/null)
  case "$started" in '' | *[!0-9]*) return 1 ;; esac
  [ $(($(date +%s) - started)) -ge "$STARVE_S" ]
}
# 登記檔是否仍代表一個活著的 waiter；死登記（pid 不在、身分不符、超齡）順手刪掉。
# 回 0＝活著；$_reg_started 帶出開始等候的 epoch 秒。
_reg_alive() {
  local f=$1 pid=${1##*-} started ident now_ident stat rest
  case "$pid" in '' | *[!0-9]*) return 1 ;; esac
  started=$(sed -n 1p "$f" 2>/dev/null)
  ident=$(sed -n 2p "$f" 2>/dev/null)
  case "$started" in
    '' | *[!0-9]*) rm -f "$f" 2>/dev/null; return 1 ;;
  esac
  if ! kill -0 "$pid" 2>/dev/null; then
    rm -f "$f" 2>/dev/null
    return 1
  fi
  # 殭屍（已死、尚未被收屍；pid 1 不收屍的容器裡會一直留著）kill -0 仍成功，但已不可能是在輪詢的 waiter。
  if [ -r "/proc/$pid/stat" ]; then
    stat=$(cat "/proc/$pid/stat" 2>/dev/null) || stat=
    rest=${stat##*) }
    case "${rest%% *}" in
      Z | X)
        rm -f "$f" 2>/dev/null
        return 1
        ;;
    esac
  fi
  # waiter 最久只會等 WAIT_TIMEOUT（之後 exit BUSY）；比這更老的登記不可能是活的 waiter。
  if [ $(($(date +%s) - started)) -gt $((WAIT_TIMEOUT + 60)) ]; then
    rm -f "$f" 2>/dev/null
    return 1
  fi
  if [ -n "$ident" ]; then
    now_ident=$(_pid_ident "$pid")
    if [ -n "$now_ident" ] && [ "$now_ident" != "$ident" ]; then
      rm -f "$f" 2>/dev/null
      return 1
    fi
  fi
  _reg_started=$started
  return 0
}
# 有沒有活著的 <kind> 登記（不含自己）；kind=general 時可要求「已等滿 STARVE_S」。
_live_waiter() {
  local kind=$1 only_starved=${2:-0} f pid now
  [ -d "$WAIT_DIR" ] || return 1
  now=$(date +%s)
  for f in "$WAIT_DIR/$kind"-*; do
    [ -e "$f" ] || continue
    pid=${f##*-}
    case "$pid" in '' | *[!0-9]*) continue ;; esac
    [ "$pid" = "$$" ] && continue
    _reg_alive "$f" || continue
    if [ "$only_starved" = 1 ]; then
      [ $((now - _reg_started)) -ge "$STARVE_S" ] || continue
    fi
    return 0
  done
  return 1
}

# 一次取名額的嘗試；成功回 0（GOT_LANE=expedite|general）。
acquire_slot() {
  GOT_LANE=general
  if [ "$EXPEDITE_ON" = 1 ] && [ "$LANE_URGENT" = 1 ]; then
    # 急件先看保留名額；滿了才看一般名額，而且有等滿上限的一般登記時不取一般名額（FR-019，雙向讓位的急件一側）。
    if _scan_pool expedite "$EXPEDITE_SLOTS"; then
      GOT_LANE=expedite
      return 0
    fi
    _live_waiter general 1 && return 1
    _scan_pool "$SLOT_PREFIX" "$ACTIVE_SLOTS"
    return
  fi
  if [ "$EXPEDITE_ON" = 1 ]; then
    # 一般重指令：有活著的急件在等、而且自己還沒等滿上限就讓出這一輪（雙向讓位的一般一側）。
    # try 模式沒有登記、永遠沒等滿，所以也會讓位（BUSY）；急件不會被 post-edit 的短 try 搶走名額。
    if _live_waiter urgent && ! _self_starved; then
      return 1
    fi
  fi
  _scan_pool "$SLOT_PREFIX" "$ACTIVE_SLOTS"
}

if [ "$EXPEDITE_ON" = 1 ]; then
  trap '_wait_unregister' EXIT
fi
if ! acquire_slot; then
  if [ "$mode" = try ]; then
    exit "$BUSY"
  fi
  # 只有「每個 slot 都是祖先持有」才是死局；其餘 slot 是別的 gate 持有，自己會放。
  _slot_locks=()
  for si in $(seq 1 "$ACTIVE_SLOTS"); do _slot_locks+=("$LOCK_DIR/$SLOT_PREFIX-$si.lock"); done
  _self_held=0
  for _slot_lock in "${_slot_locks[@]}"; do
    _self=$(ancestor_holder "$_slot_lock") && _self_held=$((_self_held + 1)) && _self_last=$_self
  done
  if [ "$_self_held" -ge "$ACTIVE_SLOTS" ]; then refuse_self_wait "${_self_last% *}" "${_self_last##* }"; fi
  _wait_register
  deadline=$(($(date +%s) + WAIT_TIMEOUT))
  until acquire_slot; do
    if [ "$(date +%s)" -ge "$deadline" ]; then
      # 印所有 slot lock 的 holder 診斷
      for si in $(seq 1 "$ACTIVE_SLOTS"); do
        slot_lock="$LOCK_DIR/$SLOT_PREFIX-$si.lock"
        [ -f "$slot_lock" ] && print_holder_diag "$slot_lock" "$SLOT_PREFIX slot $si/$ACTIVE_SLOTS holder (slot acquire timed out after ${WAIT_TIMEOUT}s, key=$safe_key)"
      done
      exit "$BUSY"
    fi
    sleep "${CLADE_GATE_POLL_S:-2}"
  done
fi
# 取到名額：登記先刪（exec 之後 EXIT trap 不會跑）。
_wait_unregister
if [ "$EXPEDITE_ON" = 1 ]; then trap - EXIT; fi

# 只替巢狀 gate 宣稱「本層真的持有的資源」：heavy 持有 repo lock＋heavy slot，巢狀任何 gate 直接 exec；
# light 只持有 light slot，巢狀 heavy MUST 照常取 repo lock 與 heavy slot（檔頭「NEVER 讓它完全免閘」）。
if [ "$GATE_CLASS" = heavy ]; then
  export CLADE_GATE_SLOT_HELD=1
else
  export CLADE_GATE_LIGHT_HELD=1
fi

# 等待量測（W-2026-09-16-delivery-throughput H2）：push_ms 裡有多少是排 slot、多少是 gate 實跑，
# 過去無從分辨。只記「取到 slot 為止」的等待；實跑時間由呼叫端以總時長相減——exec 之後
# 本行程已不存在，NEVER 為了量 run time 改成背景執行（會丟掉 TTY 與 process group）。
if [ -n "${CLADE_GATE_SLOT_METRICS:-}" ] && [ -n "$_wait_started_ms" ]; then
  _waited_ms=$(($(_now_ms) - _wait_started_ms))
  printf '{"key":"%s","mode":"%s","class":"%s","lane":"%s","slots":%s,"slot_wait_ms":%s}\n' \
    "$safe_key" "$mode" "$GATE_CLASS" "${GOT_LANE:-general}" "$ACTIVE_SLOTS" "$_waited_ms" >>"$CLADE_GATE_SLOT_METRICS" 2>/dev/null || true
fi

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

# ── 記憶體天花板：自己的 cgroup，不繼承呼叫端的（TD-909）────────────────────
# 併發天花板（上面的 slot semaphore）與記憶體天花板是同一個不變式的兩半：
# 「一個 heavy gate 該吃多少這台機器」。拆到兩個檔就會出現「有些路徑有上限、
# 有些沒有」的靜默半套 —— 2026-09-03 的事故正是那個形狀：clade 的 propagate 對
# consumer push，consumer 的 pre-push typecheck 於是跑在 **clade session 的** scope
# 裡（memory.high 6 GiB），撞線後被 kernel 節流成 livelock。
#
# `MemoryMax` 是這一段的重點，不是 `MemoryHigh`。事故當下 memory.max 是 8 GiB 而
# 用量停在 6.66 GiB —— **永遠不會 OOM kill**，只會無限節流，最壞情況是「不終止」。
# 給了 Max 之後最壞情況降級成「被 kernel 殺掉，有明確 exit signal」。
# **NEVER 只給 MemoryHigh** —— 那只是把同一個 livelock 搬進私有 cgroup，症狀一模一樣。
# MemorySwapMax=0：允許 swap 等於把節流換成慢一千倍地跑，同樣不會終止。
#
# `--scope`（不是 service）是刻意的：實測 scope 下 pgid 與 sid 都不變、命令是呼叫端的
# 直接子行程，所以呼叫端的 `process.kill(-pid)` 群組殺照樣送達。**NEVER 改成 service
# 模式** —— 那會 reparent 到 user manager，真的斬斷群組殺。
#
# systemd --user 不可用時（容器 / 非 systemd）無聲降級成裸 exec：少了天花板，
# 併發閘門仍在。predicate 逐字沿用 cbm-index.sh 已驗證過的那一條，NEVER 另發明第二套。
GATE_MEM_HIGH=${CLADE_HEAVY_GATE_MEM_HIGH:-6G}
GATE_MEM_MAX=${CLADE_HEAVY_GATE_MEM_MAX:-7G}

# scope 可用時把整棵 holder tree 包進去。**NEVER 改成 exec 回 "$0"** —— 那會走上面
# 第 51 行的 CLADE_GATE_SLOT_HELD short-circuit，那條路徑直接 exec 不帶 timeout，
# MAX_RUNTIME 會靜默消失，而外觀與正常執行完全相同。
mem_scope_available() {
  [ "${CLADE_HEAVY_GATE_MEM_SCOPE:-1}" = '1' ] || return 1
  command -v systemd-run >/dev/null 2>&1 || return 1
  case "$(systemctl --user is-system-running 2>/dev/null)" in
    running | degraded) return 0 ;;
    *) return 1 ;;
  esac
}

# ── 卡死偵測 ──────────────────────────────────────────────────────────────────
# 卡死的 gate（CPU 近 0、log 不再寫）若只靠 MAX_RUNTIME 收，slot 要被佔到上界滿。
# 這裡讓 holder 自己帶一支 watchdog：整棵行程樹連續
# CLADE_GATE_HANG_WINDOW 秒（預設 300）**同時**滿足下面全部，才判卡死——
#   - 每個取樣間隔的 CPU（utime+stime+cutime+cstime 總和）都 < 1%
#   - 行程集合沒變（沒有新起或結束的行程）
#   - 輸出沒更新：樹內行程開著的一般檔／tty、CLADE_GATE_HANG_WATCH、clade-gate 的輸出 heartbeat
#     的 mtime 都沒動；沒有 heartbeat 而 stdout／stderr 是 pipe 時（anonymous pipe 寫入不更新 mtime），改看整棵樹的 wchar 有沒有增加
#     沒有 /proc/<pid>/io（WSL2 核心）就看不到 pipe 輸出，此時不判卡死、watchdog 直接退出
# 判定後先把原因寫到 holder 的 stderr（node 的 stdio 'pipe' 是 socketpair，/proc/<pid>/fd/2 開不起來，
# 所以 clade-gate 給 CLADE_GATE_HANG_REPORT 檔、結束時自己印），SIGTERM 整棵樹，寬限 CLADE_GATE_HANG_GRACE 秒後 SIGKILL
# 還活著的；鎖的 fd 隨行程結束釋放，slot 就放出來了。
#
# 與上面 print_holder_diag「只印不殺」、下面「已否決從外面 kill stale holder」不衝突：那兩條擋的是
# 「別人只看 CPU 就殺」。這支是 holder 自己帶進來的，而且要 CPU、行程集合、輸出三者同時靜止整整一窗；
# 任何一項有動靜就重新起算——仍在輸出的行程 NEVER 被殺。判不出（沒有 /proc）就不起 watchdog。
#
# watchdog 用 `( … & )` 脫離本行程樹，stdio 接 /dev/null 並關掉所有鎖 fd：它 NEVER 持有 slot，
# 也不讓讀 pipe 的呼叫端等它結束才收到 EOF。holder 結束（pid 消失或 starttime 變了）它就自己退出。
HANG_WINDOW=${CLADE_GATE_HANG_WINDOW:-300}
case "$HANG_WINDOW" in '' | *[!0-9]*) HANG_WINDOW=300 ;; esac
HANG_INTERVAL=${CLADE_GATE_HANG_INTERVAL:-15}
case "$HANG_INTERVAL" in '' | *[!0-9]* | 0) HANG_INTERVAL=15 ;; esac
HANG_GRACE=${CLADE_GATE_HANG_GRACE:-10}
case "$HANG_GRACE" in '' | *[!0-9]*) HANG_GRACE=10 ;; esac

_hang_starttime() {
  local s
  read -r s <"/proc/$1/stat" 2>/dev/null || return 1
  s=${s##*) }
  # shellcheck disable=SC2086
  set -- $s
  printf '%s' "${20}"
}

# root 與其所有後代（ppid 樹）；root 被 systemd-run 搬進自己的 scope 後，再併上該 cgroup 的全部行程
# （reparent 到 pid 1 的孫行程也在裡面）。只在 root 的 cgroup 與 watchdog 不同時讀 cgroup.procs——
# 相同表示沒有私有 scope，那個 cgroup 裡還有別人的行程。
_hang_tree() {
  local root=$1 my_cg=$2 root_cg
  {
    ps -e -o pid=,ppid= 2>/dev/null | awk -v r="$root" '
      { kids[$2] = kids[$2] " " $1 }
      END {
        q[1] = r; n = 1; seen[r] = 1
        for (i = 1; i <= n; i++) {
          print q[i]
          c = split(kids[q[i]], a, " ")
          for (j = 1; j <= c; j++) if (!(a[j] in seen)) { seen[a[j]] = 1; q[++n] = a[j] }
        }
      }'
    root_cg=$(awk -F: '$1 == "0" { print $3 }' "/proc/$root/cgroup" 2>/dev/null)
    if [ -n "$root_cg" ] && [ "$root_cg" != "$my_cg" ] && [ -r "/sys/fs/cgroup$root_cg/cgroup.procs" ]; then
      cat "/sys/fs/cgroup$root_cg/cgroup.procs" 2>/dev/null
    fi
  } | sort -un
}

# 一次取樣：印 `<pid 集合> <cpu ticks> <最大 mtime> <wchar 總和>`（集合以逗號串起）。
# 每輪只 fork 固定幾支（ps、sort、stat）；/proc 檔一律用 read builtin，NEVER 逐 fd fork readlink——
# 一棵 node 樹動輒上百個 fd。stat 掃全部 fd：pipe／socket 的 mtime 不隨寫入變，唯讀開著的原始碼
# 被改過只會讓判定更保守（重新起算），不會誤殺。
_hang_sample() {
  local root=$1 my_cg=$2 use_wchar=$3 pids p s k v ticks=0 wchar=0 mt=0
  local -a files=()
  pids=$(_hang_tree "$root" "$my_cg")
  for p in $pids; do
    read -r s <"/proc/$p/stat" 2>/dev/null || continue
    s=${s##*) }
    # shellcheck disable=SC2086
    set -- $s
    ticks=$((ticks + ${12:-0} + ${13:-0} + ${14:-0} + ${15:-0}))
    files+=(/proc/"$p"/fd/*)
    if [ "$use_wchar" = 1 ]; then
      while read -r k v; do
        if [ "$k" = wchar: ]; then
          case "$v" in '' | *[!0-9]*) ;; *) wchar=$((wchar + v)) ;; esac
          break
        fi
      done <"/proc/$p/io" 2>/dev/null
    fi
  done
  [ -n "$OUTPUT_HEARTBEAT" ] && files+=("$OUTPUT_HEARTBEAT")
  if [ -n "${CLADE_GATE_HANG_WATCH:-}" ]; then
    local IFS=:
    # shellcheck disable=SC2206
    files+=($CLADE_GATE_HANG_WATCH)
    unset IFS
  fi
  if [ "${#files[@]}" -gt 0 ]; then
    mt=$(stat -L -c '%Y' "${files[@]}" 2>/dev/null | sort -n | tail -n 1)
    case "$mt" in '' | *[!0-9]*) mt=0 ;; esac
  fi
  printf '%s %s %s %s' "$(printf '%s' "$pids" | tr '\n' ',')" "$ticks" "$mt" "$wchar"
}

# root 在 <grace> 秒內結束（pid 消失或 starttime 變了）回 0。
_hang_wait_gone() {
  local i
  for i in $(seq 1 $(($3 * 5))); do
    [ "$(_hang_starttime "$1")" = "$2" ] || return 0
    sleep 0.2
  done
  [ "$(_hang_starttime "$1")" = "$2" ] || return 0
  return 1
}

_hang_watchdog() {
  local root=$1 window=$2 interval=$3 grace=$4 my_cg start clk use_wchar=0 fd
  local prev cur p_set p_ticks p_mt p_wc c_set c_ticks c_mt c_wc quiet_since now dt last pids p alive
  for fd in 9 $(seq 11 30); do eval "exec $fd>&-" 2>/dev/null; done
  start=$(_hang_starttime "$root") || return 0
  my_cg=$(awk -F: '$1 == "0" { print $3 }' "/proc/$BASHPID/cgroup" 2>/dev/null)
  clk=$(getconf CLK_TCK 2>/dev/null)
  case "$clk" in '' | *[!0-9]* | 0) clk=100 ;; esac
  if [ -z "$OUTPUT_HEARTBEAT" ]; then
    case "$(readlink "/proc/$root/fd/1" 2>/dev/null)$(readlink "/proc/$root/fd/2" 2>/dev/null)" in
      *pipe:* | *socket:*) use_wchar=1 ;;
    esac
  fi
  # pipe 輸出只能靠 /proc/<pid>/io 的 wchar 觀察；核心沒編 task io accounting（WSL2 的 microsoft 核心就沒有）時
  # wchar 永遠是 0，持續輸出的 holder 會被當成「輸出沒動靜」誤殺。看不到就不判卡死（MAX_RUNTIME 仍是上界）。
  # CLADE_GATE_HANG_NO_PROC_IO=1 是測試接縫：在有 io accounting 的主機上模擬這個情境。
  if [ "$use_wchar" = 1 ]; then
    [ "${CLADE_GATE_HANG_NO_PROC_IO:-}" = 1 ] && return 0
    read -r _ <"/proc/$root/io" 2>/dev/null || return 0
  fi
  prev=$(_hang_sample "$root" "$my_cg" "$use_wchar")
  last=$(date +%s)
  quiet_since=$last
  while sleep "$interval"; do
    [ "$(_hang_starttime "$root")" = "$start" ] || return 0
    cur=$(_hang_sample "$root" "$my_cg" "$use_wchar")
    now=$(date +%s)
    dt=$((now - last))
    [ "$dt" -lt 1 ] && dt=1
    # 取樣間隔遠大於 interval（VM 暫停、時鐘跳變、watchdog 被餓死）：這一段沒人看著，
    # 不能算進安靜窗，也會把 1% CPU 門檻墊高；視為重新起算。
    [ "$dt" -gt $((interval * 3)) ] && quiet_since=$now
    read -r p_set p_ticks p_mt p_wc <<<"$prev"
    read -r c_set c_ticks c_mt c_wc <<<"$cur"
    # 1% 門檻：ticks / clk / dt >= 0.01  ⇔  ticks*100 >= clk*dt
    if [ "$c_set" != "$p_set" ] || [ "$c_mt" != "$p_mt" ] || [ "$c_wc" != "$p_wc" ] ||
      [ $(((c_ticks - p_ticks) * 100)) -ge $((clk * dt)) ]; then
      quiet_since=$now
    fi
    prev=$cur
    last=$now
    if [ $((now - quiet_since)) -ge "$window" ]; then
      pids=${c_set//,/ }
      local -A born=()
      for p in $pids; do born[$p]=$(_hang_starttime "$p"); done
      {
        printf '\ngate-slot: 判定卡死，收掉行程樹並放出 slot（key=%s）\n' "$safe_key"
        printf '  原因：連續 %ss 內 CPU < 1%%、行程集合沒變、輸出（樹內開著的檔／tty、heartbeat、CLADE_GATE_HANG_WATCH%s）沒有更新\n' \
          "$window" "$([ "$use_wchar" = 1 ] && printf '、pipe 輸出 wchar')"
        printf '  行程：%s\n' "$pids"
        printf '  門檻可調：CLADE_GATE_HANG_WINDOW（0 關閉）／CLADE_GATE_HANG_WATCH（要看的 log）\n'
      } >>"${HANG_REPORT:-/proc/$root/fd/2}" 2>/dev/null
      # 先 TERM root 以外的後代，root（通常是 timeout(1)）見子行程結束就自己退出。NEVER 先打 root：
      # uutils timeout 收到 TERM 會轉送給整個 process group，連呼叫端 pipeline
      # 裡讀輸出的 cat 都一起殺掉，原因訊息也就沒人收。root 寬限內沒退（root 就是 inner command
      # 本身、或 timeout 沒反應）才 TERM root；再寬限後 SIGKILL 仍活著且 starttime 沒變的。
      for p in $pids; do [ "$p" = "$root" ] || kill -TERM "$p" 2>/dev/null; done
      _hang_wait_gone "$root" "$start" "$grace" || {
        kill -TERM "$root" 2>/dev/null
        _hang_wait_gone "$root" "$start" "$grace"
      }
      for p in $pids; do
        alive=$(_hang_starttime "$p") || continue
        [ -n "$alive" ] && [ "$alive" = "${born[$p]}" ] && kill -KILL "$p" 2>/dev/null
      done
      return 0
    fi
  done
}

if [ "$HANG_WINDOW" -gt 0 ] && [ -r "/proc/$$/stat" ]; then
  _hang_root=$$
  # NEVER 直接 `( _hang_watchdog … & )`：fork 出來的 subshell argv 仍是 `bash gate-slot.sh wait …`，
  # push 逾時分類器（scripts/lib/push-timeout-phase.ts GATE_SLOT_WAITER）會把它當成「還在排 slot」，
  # 把 gate 正在跑誤判成 gate-slot-wait。改 exec 一支 argv 不同的 bash。
  # shellcheck disable=SC2016
  (
    safe_key=$safe_key OUTPUT_HEARTBEAT=$OUTPUT_HEARTBEAT HANG_REPORT=$HANG_REPORT \
      exec -a gate-slot-hang-watchdog bash -c \
      "$(declare -f _hang_starttime _hang_tree _hang_sample _hang_wait_gone _hang_watchdog)"'
_hang_watchdog "$@"' gate-slot-hang-watchdog "$_hang_root" "$HANG_WINDOW" "$HANG_INTERVAL" "$HANG_GRACE" &
  ) </dev/null >/dev/null 2>&1
fi

if [ "$MAX_RUNTIME" -gt 0 ] && command -v timeout >/dev/null 2>&1; then
  set -- timeout --signal=TERM --kill-after=30 "$MAX_RUNTIME" "$@"
fi

if mem_scope_available; then
  # scope 包在 timeout 外面 —— 逃出去的孫行程也在同一個 cgroup 裡，
  # 這正是 2026-09-03 那隻 reparent 到 pid 1 的 vue-tsc 逃掉的那一格。
  # flock 的 fd 在此之前就取得，scope 下照常繼承，鎖隨行程結束釋放的性質不變。
  # Only hosts with an installed agent slice opt in. macOS/non-systemd keeps the old scope.
  # slice：重指令專用的 cladeheavy.slice 已載入就掛它（research 決策 11；slice unit 由主機端安裝，本 repo 尚無產生器，
  # 沒裝就不會載入），否則退回 agent-workloads.slice。兩者都沒載入就不指定（macOS／非 agent 主機維持舊行為）。
  gate_slice_args=()
  if [ "$GATE_CLASS" = heavy ]; then
    for _gate_slice in "${CLADE_HEAVY_GATE_SLICE:-cladeheavy.slice}" agent-workloads.slice; do
      if [ "$(systemctl --user show -p LoadState --value "$_gate_slice" 2>/dev/null)" = loaded ]; then
        gate_slice_args=(--slice="$_gate_slice")
        break
      fi
    done
  fi
  # gate 底下全是批次工作。與互動 session 同權重時，滿載下 claude TUI 主執行緒喚醒延遲實測達
  # 300ms、herdr 56ms；scope 設 idle 權重（cgroup cpu.idle）後 herdr 降到 5ms，批次仍吃得到所有閒置 CPU。
  # systemd < 252 不認得 idle，會讓 systemd-run 整個失敗，所以先驗版本。
  # 急件（保留名額池啟用且 flow 判為急件）在重指令專用 slice 內改用數字權重：同 slice 的一般重指令是 idle，
  # 任何非 idle 值都讓急件先跑（決策 7）；對互動 session 的份額由 slice 權重決定、不因此改變（FR-020）。
  # 數字權重所有 systemd 版本都認得，所以急件不受 <252 的限制。
  # 沒有任何重指令 slice 載入時（gate_slice_args 為空）scope 會落在預設 slice、與互動 session 平起平坐，
  # 數字權重會把 300ms 的 TUI 喚醒延遲帶回來——此時急件不升權，維持 idle（急件仍享有保留名額，只是 CPU 不加權）。
  gate_cpu_args=()
  if [ "$LANE_URGENT" = 1 ] && [ "${#gate_slice_args[@]}" -gt 0 ]; then
    gate_cpu_args=(-p "CPUWeight=$URGENT_CPU_WEIGHT")
  elif [ "$(systemctl --version 2>/dev/null | awk 'NR == 1 { print $2 + 0 }')" -ge 252 ] 2>/dev/null; then
    gate_cpu_args=(-p CPUWeight=idle)
  fi
  exec systemd-run --user --scope -q "${gate_slice_args[@]}" "${gate_cpu_args[@]}" \
    -p MemoryHigh="$GATE_MEM_HIGH" -p MemoryMax="$GATE_MEM_MAX" -p MemorySwapMax=0 \
    "$@"
fi

exec "$@"
