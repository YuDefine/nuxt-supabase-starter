#!/usr/bin/env bash
# PreToolUse:Bash hook — 擋 agent 自行呼叫 codex CLI 派工（block，exit 2）
#
# 觸發條件：tool_input.command 在**命令位置**出現 `codex`，且接的是派工子命令
#           （exec / review / apply / resume）。
# 行為：exit 2 並在 stderr 給等效的 Pi dispatch 命令。
#
# 為什麼需要這道 gate：
#   派工一律走 vendor/scripts/pi-dispatch.ts（Pi runtime），這條規約寫在
#   rules/core/agent-routing.pi-watch-protocol.md § 「NEVER 直接執行 codex exec」。
#   但在本 hook 之前，那條規約**只有自律**：routing gate 的 Bash 分支只做 readonly-bash
#   計數（pi-routing-gate.ts 的 toolName === 'Bash' 分支），對 codex 字面零判定；
#   audit-governance-drift.ts 的 codex exec matcher 掃的是規約 markdown 文字有沒有
#   復辟 raw carrier，**不看實際被執行的命令**。也就是說事前無攔截、事後也看不到。
#
# 為什麼不塞進 pi-routing-gate.ts：
#   那支是**有狀態的 latch**（session-keyed state + file lock + receipt ledger），
#   它的 Bash 分支語意是「pending 時擋、非 pending 時計數」。一條應該**永遠**擋的
#   規則放進去會變成「只在某些 phase 擋」。而且該分支的註解逐字禁止再長出放寬
#   （reverted e191e8a0），test/pi-routing-gate.test.ts 鎖住那個契約。獨立檔
#   另有一個好處：hooks.json 拿掉一個 entry 就是乾淨的 kill switch。
#
# 不會誤擋 user 手動跑 cx / codex：
#   PreToolUse hook 由 Claude Code harness 對 tool call 觸發，輸入是 stdin 上的
#   tool-call JSON。user 在自己 terminal 打 codex 不產生 tool call、不產生那個 JSON，
#   hook 根本不會被 exec。這不是「設定成不擋」，是物理上碰不到。
#
# 不會誤擋 sync-to-codex.ts 與 security-scan.ts：
#   scripts/sync-to-codex.ts 的 execFile('codex', ['debug','prompt-input']) 與
#   scripts/security-scan.ts 的 spawnSync('codex', ['login','status']) 都是 Node 進程內
#   的子進程 spawn，不經過 shell、不經過 Bash tool——本 hook 只看得到外層命令字串
#   （node scripts/sync-to-codex.ts …），對它 fork 出來的子進程完全無知。
#   **這兩處刻意不列白名單**：列了反而是真正的繞道口（任何命令只要帶上那串字就放行）。
#   未來做「完備性檢查」的人請不要把它們加進來。
#
# 子命令白名單而非裸 codex 比對：`codex login` / `codex debug` / `codex --version`
# 是本機操作與診斷，不是派工，一律放行。
#
# fail-open：解析失敗 / 無 jq / 無 perl → 靜默 exit 0。hook 壞掉不該擋住工作。
# 逃生門：CLADE_ALLOW_RAW_CODEX=1 放行並在 stderr 留一行記錄。這是給 user 開口用的，
#         不是給 agent 自解的（同 pi-routing-gate.ts 的「Loosening this gate further
#         is a user decision, not an agent one」）。

set -uo pipefail

input=$(cat)

command -v jq >/dev/null 2>&1 || exit 0
command -v perl >/dev/null 2>&1 || exit 0
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""' 2>/dev/null) || exit 0
[ -n "$cmd" ] || exit 0

# 快篩：絕大多數命令不含 codex，在這裡返回，不付 perl 解析成本
case "$cmd" in
  *codex*) ;;
  *) exit 0 ;;
esac

# 命令位置 = 字串開頭、或 ; & | && || 之後、或 then/do 之後。
# 允許前綴：cd <path> && 、env VAR=val 、裸 VAR=val（CODEX_HOME=/x codex exec … 這種形式）。
# 要求 codex 後面接空白 + 派工子命令，所以下列都不匹配：
#   node …/pi-dispatch.ts     → codex 後面是 '-'
#   pgrep -af "codex exec"       → codex 不在命令位置（前面是引號）
#   grep -rn 'codex exec' docs/  → 同上
#   codex login status           → 子命令不在白名單
#   node scripts/sync-to-codex.ts → 命令位置是 node
printf '%s' "$cmd" | perl -0777 -e '
  my $c = <>;
  $c = "" unless defined $c;
  exit(($c =~ m{
    (?: ^ | [;&|] | \bthen\b | \bdo\b )      # 命令位置
    \s*
    (?: cd \s+ [^;&|]+ && \s* )?             # cd … && 前綴
    (?: (?:env\s+)? \w+=\S+ \s+ )*           # env / 裸 VAR=val 前綴
    codex \s+ (?: exec | review | apply | resume ) \b
  }x) ? 0 : 1)
' || exit 0

if [ "${CLADE_ALLOW_RAW_CODEX:-}" = "1" ]; then
  printf 'codex-exec gate: CLADE_ALLOW_RAW_CODEX=1 — 放行 raw codex 派工命令\n' >&2
  exit 0
fi

cat >&2 <<'MSG'
codex-exec gate: 派工一律走 Pi dispatcher，NEVER 直接執行 codex exec / review / apply / resume。

  node ~/offline/clade/vendor/scripts/pi-dispatch.ts \
    --route <routing-table|claude-delegate-sub|fallback-chain|manual> \
    --tier-basis <table-row|five-conjunct|adjudication|delegate-sub|quota-fallback|manual> \
    --table-row <row> --model <sol|gemini|grok-xai|grok-cursor> --effort <xhigh|high> \
    --label <descriptive-label>

Sol／Grok 一律 xhigh、Gemini 一律 high；Astra／Luna 已禁用（2026-09-24）。非 UI implementation／decision／planning 用 Sol。
判準與 Routing Table：rules/core/agent-routing.md § Routing Table
派工流程：rules/core/agent-routing.pi-watch-protocol.md § Codex 派工的標準流程

codex CLI 本身仍可用於本機操作與診斷（codex login / debug / --version 不受本 gate 影響），
user 在自己 terminal 手動跑 cx 也完全不經過本 gate。
MSG
exit 2
