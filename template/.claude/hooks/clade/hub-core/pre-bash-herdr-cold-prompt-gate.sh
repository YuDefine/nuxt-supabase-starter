#!/usr/bin/env bash
# PreToolUse:Bash hook — 擋 Bash 對閒置 ≥ prompt-cache TTL 的 Claude pane 送 `herdr agent prompt`（block，exit 2）
#
# 規約：Charles 2026-09-26「超過 TTL 的 session 一律不叫醒，改開新 pane 冷續接」。
# 一則 prompt 會讓冷 pane 用未快取價格重讀整段 context（常是數十萬 token）；正解是
# session-census.ts digest → 把要交代的事寫進 brief → 同 cwd 開新 pane 冷續接。
# `herdr-session-handoff.ts --continue` 已有同一判定（`cache_ttl_expired`）；本 gate 補的是
# agent 在 Bash 直接打 `herdr agent prompt`（含 `herdr --machine <peer> agent prompt`）這個入口。
# plan：specs/plans/W-2026-09-26-ttl-wake-paths/plan.md（Scope B）。
#
# 判定只 import `vendor/scripts/lib/pane-cache-ttl.ts`（lastCacheTouchMs／CONTINUATION_CACHE_TTL_MS），
# NEVER 在這裡另寫門檻、NEVER import herdr-session-handoff.ts。
#
# 放行（fail-open，與 `--continue` 同一契約：「量不到年齡」NEVER 等於「冷」）：
#   - 不在命令位置的 `herdr agent prompt`（grep 參數、echo 字串開頭）與其他 herdr 子命令
#   - target 是 shell 變數（`"$PANE"`）：hook 看不到展開後的值，`agent get` 失敗即放行（已知缺口）
#
# 已知誤擋：引號字串內出現「; herdr agent prompt <pane>」這種形狀（例如 `echo "a; herdr agent prompt w1:p2"`）
# 也會被當成命令位置而判定；只在該 pane 真的冷時才會擋，代價是一次改寫指令，不會送出 prompt。
#   - `herdr agent get` 失敗、目標不是 claude agent、目標正在 working（prompt 排在進行中的 turn 後面）
#   - 讀不到 transcript 年齡（沒 session id、找不到檔、ssh 失敗）
#   - jq／perl／node／herdr／中央 clade／pane-cache-ttl.ts 任一缺
#
# 沒有繞過旗標：冷續接一定有路走，擋下來不是死路。
#
# 不會誤擋 user 手動操作：PreToolUse 只對 agent 的 tool call 觸發，user 自己 terminal 打的指令
# 不產生 tool-call JSON。vendor/scripts 內 spawnSync('herdr', ['agent','prompt',…]) 也看不到——
# 那些入口由各 helper 自己的送前判定負責（缺口 B1）。

set -uo pipefail

input=$(cat)

command -v jq >/dev/null 2>&1 || exit 0
command -v perl >/dev/null 2>&1 || exit 0
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""' 2>/dev/null) || exit 0
[ -n "$cmd" ] || exit 0

# 快篩：絕大多數命令不含 herdr，在這裡返回，不付 perl／node 成本
case "$cmd" in
  *herdr*prompt*) ;;
  *) exit 0 ;;
esac

# 每個命令位置上的 `herdr [--machine M] agent prompt <TARGET>` 印一行 "<machine>\t<target>"。
# 命令位置 = 開頭、換行、; & | 之後、( ` $( 之後、then/do 之後；允許 cd … &&、env／VAR=val 與 command／exec／nohup／timeout 前綴；
# target 前可先接無值旗標（--wait 等）；
# herdr 可帶路徑（~/.local/bin/herdr）。target 可被單／雙引號包住。
targets=$(printf '%s' "$cmd" | perl -0777 -ne '
  while (m{
    (?: ^ | [;&|(`\n] | \bthen\b | \bdo\b )
    \s*
    (?: cd \s+ [^;&|]+ && \s* )?
    (?: (?:env\s+)? \w+=\S+ \s+ )*
    (?: (?: command | exec | nohup | timeout (?: \s+ -\S+ (?: \s+ [^-\s]\S* )?? )* \s+ \S+ ) \s+ )*
    (?: \S*/ )? herdr
    ( (?: \s+ --machine (?: \s+ | = ) (?: "[^"]*" | '"'"'[^'"'"']*'"'"' | [^\s;&|]+ ) )? )
    \s+ agent \s+ prompt \s+
    (?: --[\w-]+ \s+ )*
    ( "[^"]*" | '"'"'[^'"'"']*'"'"' | [^\s;&|]+ )
  }gx) {
    my ($m, $t) = ($1, $2);
    $m =~ s/^\s+--machine(?:\s+|=)//;
    s/^["'"'"']|["'"'"']$//g for ($m, $t);
    print "$m\t$t\n";
  }
') || exit 0
[ -n "$targets" ] || exit 0

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
LIB="$CLADE_ROOT/vendor/scripts/lib/pane-cache-ttl.ts"
[ -f "$LIB" ] || exit 0

# node 只在這裡做「target → agent get → transcript 年齡」；任何例外都放行（exit 0）。
# 輸出：擋下時印一段訊息並 exit 2。
# shellcheck disable=SC2016 # JS 原文，$ 不給 shell 展開
JS='
import { spawnSync } from "node:child_process"
import { pathToFileURL } from "node:url"
const [lib, targets] = process.argv.slice(1)
const { lastCacheTouchMs, CONTINUATION_CACHE_TTL_MS } = await import(pathToFileURL(lib).href)
const ttlMin = CONTINUATION_CACHE_TTL_MS / 60_000
const cold = []
for (const line of targets.split("\n")) {
  if (!line) continue
  const [machine, pane] = line.split("\t")
  const args = [...(machine ? ["--machine", machine] : []), "agent", "get", pane]
  const got = spawnSync("herdr", args, { encoding: "utf8", timeout: 10_000 })
  if (got.status !== 0) continue
  let agent
  try { agent = JSON.parse(got.stdout)?.result?.agent } catch { continue }
  if (!agent || agent.agent !== "claude" || agent.agent_status === "working") continue
  const sessionId = agent.agent_session?.value
  // cwd 缺時退用 foreground_cwd（同 herdr-patrol／handoff 的讀法）；兩者都缺仍可靠 session UUID 掃 transcript。
  const cwd = typeof agent.cwd === "string" ? agent.cwd : typeof agent.foreground_cwd === "string" ? agent.foreground_cwd : ""
  if (typeof sessionId !== "string") continue
  // herdr 只說得出 "claude"，說不出是 cc（~/.claude）還是 ccw（~/.claude-work）：兩個都量，取最暖。
  const touches = ["cc", "ccw"]
    .map((launcher) => lastCacheTouchMs({ launcher, cwd, claude_session_id: sessionId }, machine || undefined))
    .filter((ms) => typeof ms === "number")
  if (touches.length === 0) continue
  const idleMs = Date.now() - Math.max(...touches)
  if (idleMs >= CONTINUATION_CACHE_TTL_MS)
    cold.push({ machine, pane, cwd: cwd || "cwd 不明", idleMin: Math.floor(idleMs / 60_000) })
}
if (cold.length === 0) process.exit(0)
const lines = cold.map((c) => `  ${c.machine ? c.machine + " " : ""}${c.pane}（${c.cwd}）閒置 ${c.idleMin}m ≥ TTL ${ttlMin}m`)
process.stderr.write(`herdr cold-prompt gate: 超過 prompt-cache TTL 的 Claude session 一律不叫醒。
${lines.join("\n")}

送 prompt 會讓它用未快取價格重讀整段 context。改走冷續接：
  1. node ~/offline/clade/vendor/scripts/session-census.ts digest <pane-id>  摘要那個 session
  2. 把要交代的內容逐字寫進 durable brief，在同一 cwd 開新 pane（herdr-session-handoff.ts dispatch）
  3. 新 pane 接手後 --reclaim <pane> --verified 回收舊 pane
與 herdr-session-handoff.ts --continue 的 cache_ttl_expired 同一判定；本 gate 沒有繞過旗標。
`)
process.exit(2)
'

node --input-type=module -e "$JS" "$LIB" "$targets"
rc=$?
[ "$rc" -eq 2 ] && exit 2
exit 0
