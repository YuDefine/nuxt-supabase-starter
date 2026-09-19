#!/usr/bin/env bash
# PreToolUse:Bash hook — 重型 job 的 admission advisory（warn-only，NEVER block）
#
# 觸發條件：tool_input.command 命中重型清單（測試 / typecheck / build / publish gate），
#           **且**當下 load1 已高於核數，或已有其他重型 job 在跑。
# 行為：印出當下的 load、核數、以及正在跑的重型 job 清單，**一律 exit 0**。
#
# 為什麼需要它（TD-615）：18 個 agent session 共用 6 核，每個 session 都可以自己決定
#   何時起一套 CI 等級的測試，彼此不知道對方在跑。代價不只是全體變慢——
#   2026-08-24 實測 load 67 / 6 核（≈11x）時，`review-gui-web-quality` 的 5 筆
#   playwright 紅燈被誤歸因給一個 commit，三個 session 先後投入追查；降到 load 11
#   後同一棵樹重跑 28 passed / 0 failed。超賣會產生**看起來像真缺陷的假訊號**。
#
# 為什麼沒有鎖（TD-615 Restart brief 的「先決定鎖的載體」，本次選了第三案）：
#   PreToolUse 拿不到「這個 job 何時結束」的訊號，所以任何 lockfile / flock 都要另配
#   釋放路徑，而 session 被 kill 時那條路徑不會執行 —— brief 自己點名的「持鎖 session
#   被 kill」正是這個。改成**每次從 process table 現算**：沒有持有者，就沒有收屍問題，
#   也沒有跨 session 的狀態要維護。代價是拿不到「排隊」語意，只能 advisory —— 而
#   warn-only 本來就是本 hook 的設計（同 pre-bash-wait-loop-guard.sh 先例）。
#
# 為什麼 warn 不 block：重型 job 多數時候是**該跑的**（publish gate、驗收測試）。
#   擋下來的代價（工作停擺、且 agent 多半會想辦法繞過）高於它要防的代價（一輪假紅）。
#   要的是讓 agent 在**送出前**看到「現在跑會拿到不可信的結果」，判斷權留給它。
#
# fail-open：解析失敗 / 無 jq / 讀不到 load → 靜默 exit 0。

set -uo pipefail

input=$(cat)

command -v jq >/dev/null 2>&1 || exit 0
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""' 2>/dev/null) || exit 0
[ -n "$cmd" ] || exit 0

# ── 快篩：絕大多數 Bash 命令不是重型 job，在這裡就返回 ────────────────────────
case "$cmd" in
  *vitest*|*playwright*|*'vp test'*|*'vp check'*|*'node --test'*|*vue-tsc*|*'tsc '*|*'tsc -'*) ;;
  *'nuxt typecheck'*|*'nuxt build'*|*'vite build'*|*'pnpm build'*|*'pnpm install'*) ;;
  *publish.ts*|*propagate.ts*|*review-gui-web-quality*) ;;
  *) exit 0 ;;
esac

# ── 量 load 與核數（Linux /proc 優先，其餘走 uptime；兩者都失敗就 fail-open）──
if [ -r /proc/loadavg ]; then
  load1=$(cut -d' ' -f1 /proc/loadavg 2>/dev/null) || exit 0
else
  load1=$(uptime 2>/dev/null | sed -n 's/.*load averages*:[[:space:]]*\([0-9.]*\).*/\1/p') || exit 0
fi
[ -n "$load1" ] || exit 0

if command -v nproc >/dev/null 2>&1; then
  ncores=$(nproc 2>/dev/null)
else
  ncores=$(sysctl -n hw.ncpu 2>/dev/null)
fi
[ -n "${ncores:-}" ] && [ "$ncores" -gt 0 ] 2>/dev/null || exit 0

# ── 現算正在跑的重型 job（process table 是唯一事實來源，沒有鎖、沒有狀態）──────
# 自我排除用 `[x]` 形式，避免匹配到執行本 hook 的 shell 自己
# （同 pre-bash-wait-loop-guard.sh 要防的那個自我匹配）。
# 自己的祖先鏈也要排除：呼叫本 hook 的 shell，其 cmdline 含使用者送出的整條命令
# 字串（就是那條剛命中快篩的重型指令），不排掉會把「我自己」算成一個在跑的 job。
# `[x]` 括號技只擋得住 grep 自己，擋不住這個。
self_chain=" $$ "
_p=$$
for _ in 1 2 3 4 5 6 7 8; do
  _p=$(awk '{print $4}' "/proc/$_p/stat" 2>/dev/null) || break
  [ -n "${_p:-}" ] && [ "$_p" != '0' ] || break
  self_chain="${self_chain}${_p} "
done

running=$(ps -eo pid=,args= 2>/dev/null \
  | grep -E '[v]itest|[p]laywright|[v]ue-tsc|node .*--[t]est|[o]xlint|[n]uxt (build|typecheck)|[v]ite build' \
  | awk -v chain="$self_chain" '{ if (index(chain, " " $1 " ") == 0) print }' \
  | sed 's/^[[:space:]]*//') || running=''
nrunning=$(printf '%s' "$running" | grep -c . 2>/dev/null) || nrunning=0

# ── 判定：load 超過核數，或已有別的重型 job 在跑，才出聲 ──────────────────────
over=$(awk -v l="$load1" -v c="$ncores" 'BEGIN { print (l > c) ? 1 : 0 }' 2>/dev/null) || exit 0
[ "$over" = '1' ] || [ "${nrunning:-0}" -ge 1 ] || exit 0

ratio=$(awk -v l="$load1" -v c="$ncores" 'BEGIN { printf "%.1f", l / c }' 2>/dev/null)

{
  printf '\n⚠️  [clade] 現在起重型 job，結果可能不可信\n\n'
  printf '  load average(1m)：%s ／ %s 核  ＝ %sx\n' "$load1" "$ncores" "${ratio:-?}"
  printf '  正在跑的重型 job：%s 個\n' "${nrunning:-0}"
  if [ -n "$running" ]; then
    printf '%s\n' "$running" | head -6 | cut -c1-110 | sed 's/^/    /'
    [ "${nrunning:-0}" -gt 6 ] && printf '    …另外 %s 個\n' "$((nrunning - 6))"
  fi
  cat <<'MSG'

  超賣的代價不只是慢。高負載下 playwright 的 locator wait 逾時，回報形式與真缺陷
  **完全相同**（具名到 spec 與行號），只看輸出分不出來——2026-08-24 實測一次因此
  被誤歸因給某個 commit，三個 session 先後投入追查。

  送出前先判：
    1. 這輪結果會被拿去**下判斷**嗎（publish gate / 歸因 / 驗收）？
       → 是就先降載：等上面那幾個跑完，或 `herdr agent list` 看誰在跑
    2. 只是想看會不會過、失敗了也只是重跑？→ 照跑
    3. 已經拿到紅燈且 load 高於核數 → 那是「沒驗到」不是「驗出問題」，
       MUST 降載重跑後才寫歸因（clade-publish Step 1.5 ②）

  （advisory only — 這個 hook 從不擋任何指令）

MSG
} >&2

exit 0
