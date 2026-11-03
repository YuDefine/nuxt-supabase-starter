#!/usr/bin/env bash
# PostToolUse(Agent) hook — subagent 完成後提醒主線跑 scope-verify（clade home 自用）。
#
# 規約：.claude/skills/clade-home/rules/subagent-scope-discipline.md「收到 subagent 完成 notification
# 之後，MUST 先讀 detail」——verify SOP 是主線工作，主線的「那一刻」= Agent tool result
# 回來時。SubagentStop 不適用：它的 exit 2 / stderr 收件人是 subagent 自己。
# hook 拿不到 brief 宣告的 scope pattern，所以只做送達、不代跑。
#
# 通道：exit 2 + stderr（TD-425——PostToolUse exit 0 的 stderr 只進 debug log；exit 2
# 「Shows stderr to Claude; the tool already ran」，不阻擋任何東西，warn-only 語義不變）。
#
# 節流：並行 batch 完成會連環觸發，10 分鐘 bucket 內只響一次（一次提醒涵蓋整個 batch）。
# read-only agent（Explore / Plan / commit-0a-reviewer）不改檔 → 跳過。commit-0a-reviewer 的 tools 只有
# Read, Grep, Glob（capabilities/core/agents/commit-0a-reviewer.md）；主持者每輪 0-A 派多批，提醒全是雜訊。
# 去重鍵 session_id＋10 分鐘 bucket（hook-authoring `rules/提醒注入型的送達去重與噪音.md` Rule 2；
# NEVER 用 ${PPID}：主線與 subagent 共用 harness 行程、行程 ID 會被回收）。payload 缺 session_id
# （舊 harness、手動測試）才退回 ppid-${PPID}。
# subagent：不收——scope-verify 是主線驗收流程，subagent 無此責任（agent_id 非空即靜默，Rule 3）。
# 效果指標：收到後主線在接下來的 tool call 內跑 scripts/scope-verify.ts；
#   hook_followthrough.py --match 'scope-verify' 量。
# scope-verify.ts 不存在（非 clade home）/ jq 缺 → silent exit 0（fail-open）。

set -uo pipefail

INPUT=$(cat)
ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
[ -f "$ROOT/scripts/scope-verify.ts" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0

SUBAGENT_TYPE=$(printf '%s' "$INPUT" | jq -r '.tool_input.subagent_type // ""' 2>/dev/null) || exit 0
case "$SUBAGENT_TYPE" in
  Explore | Plan | commit-0a-reviewer | hub-core:commit-0a-reviewer) exit 0 ;;
esac

AGENT=$(printf '%s' "$INPUT" | jq -r '.agent_id // empty' 2>/dev/null) || exit 0
[ -n "$AGENT" ] && exit 0

SESSION=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
BUCKET=$(($(date +%s) / 600))
KEY="${SESSION:-ppid-${PPID:-$$}}-${BUCKET}"
case "$KEY" in */* | *..*) KEY=$(printf '%s' "$KEY" | tr '/.' '__') ;; esac
STATE_DIR="${TMPDIR:-/tmp}/claude-scope-verify-reminder"
MARKER="$STATE_DIR/$KEY.seen"
[ -f "$MARKER" ] && exit 0
mkdir -p "$STATE_DIR" 2>/dev/null && : >"$MARKER" 2>/dev/null || true

cat >&2 <<'MSG'
📋 subagent 完成 → 主線 verify SOP：READ .claude/skills/clade-home/rules/subagent-scope-discipline.detail.md § 主線 verify SOP
   node scripts/scope-verify.ts --scope '<brief 宣告的每一條 scope>'
   ⚠️ `**` 不匹配 dot 路徑段——.claude/** 等要明寫。scope 外有改動 → 先判斷再決定 revert。
MSG
exit 2
