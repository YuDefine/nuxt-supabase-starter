#!/usr/bin/env bash
# PostToolUse(Agent) hook — subagent 完成後提醒主線跑 scope-verify（clade home 自用）。
#
# 規約：.claude/rules/local/subagent-scope-discipline.md「收到 subagent 完成 notification
# 之後，MUST 先讀 detail」——verify SOP 是主線工作，主線的「那一刻」= Agent tool result
# 回來時。SubagentStop 不適用：它的 exit 2 / stderr 收件人是 subagent 自己。
# hook 拿不到 brief 宣告的 scope pattern，所以只做送達、不代跑。
#
# 通道：exit 2 + stderr（TD-425——PostToolUse exit 0 的 stderr 只進 debug log；exit 2
# 「Shows stderr to Claude; the tool already ran」，不阻擋任何東西，warn-only 語義不變）。
#
# 節流：並行 batch 完成會連環觸發，10 分鐘 bucket 內只響一次（一次提醒涵蓋整個 batch）。
# read-only agent（Explore / Plan）不改檔 → 跳過。
# scope-verify.ts 不存在（非 clade home）/ jq 缺 → silent exit 0（fail-open）。

set -uo pipefail

INPUT=$(cat)
ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
[ -f "$ROOT/scripts/scope-verify.ts" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0

SUBAGENT_TYPE=$(printf '%s' "$INPUT" | jq -r '.tool_input.subagent_type // ""' 2>/dev/null) || exit 0
case "$SUBAGENT_TYPE" in
  Explore | Plan) exit 0 ;;
esac

BUCKET=$(($(date +%s) / 600))
MARKER="${TMPDIR:-/tmp}/claude-scope-verify-reminder-${PPID:-$$}-${BUCKET}"
[ -f "$MARKER" ] && exit 0
touch "$MARKER" 2>/dev/null || true

cat >&2 <<'MSG'
📋 subagent 完成 → 主線 verify SOP（subagent-scope-discipline.detail § 主線 verify SOP）：
   node scripts/scope-verify.ts --scope '<brief 宣告的每一條 scope>'
   ⚠️ `**` 不匹配 dot 路徑段——.claude/** 等要明寫。scope 外有改動 → 先判斷再決定 revert。
MSG
exit 2
