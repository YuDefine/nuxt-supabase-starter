#!/usr/bin/env bash
# PreToolUse(Agent) hook — 派工 brief 超過 thin-brief 門檻時提醒（warn-only，不阻擋）。
#
# 規約：~/.claude/CLAUDE.md § Parallel Subagent Fan-out 第 3 條要求 thin brief =
# 「萃取後的 3–5K 具體指示」。scripts/audit-subagent-brief-size.ts（TD-376）是事後
# 掃 transcript 的回顧工具；本 hook 在派工**當下**直接量 tool_input.prompt，
# 時機恰好、零掃描成本。門檻沿用該 audit 的 DEFAULT_THRESHOLD=5000。
#
# 輸出通道：hookSpecificOutput.additionalContext（TD-427 round 31 實測——PreToolUse 上
# stderr / 裸 stdout / permissionDecisionReason 都到不了 agent）。
# **NEVER 為了送達改 exit 2**：那是 block，與 warn-only 衝突（肥 brief 可能合法）。
# **NEVER 補 permissionDecision**：帶 "allow" 會自動核准、繞過 permission 提示。
#
# fork subagent 繼承完整對話 context，prompt 本來就短且不適用 thin-brief 模型 → 跳過。
# jq 缺 / 輸入解析不出 → silent exit 0（fail-open）。

set -uo pipefail

INPUT=$(cat)
command -v jq >/dev/null 2>&1 || exit 0

SUBAGENT_TYPE=$(printf '%s' "$INPUT" | jq -r '.tool_input.subagent_type // ""' 2>/dev/null) || exit 0
[ "$SUBAGENT_TYPE" = "fork" ] && exit 0

BYTES=$(printf '%s' "$INPUT" | jq -r '.tool_input.prompt // "" | utf8bytelength' 2>/dev/null) || exit 0
THRESHOLD=5000
[ "$BYTES" -gt "$THRESHOLD" ] 2>/dev/null || exit 0

MSG="⚠️ 派工 brief ${BYTES} bytes > thin-brief 門檻 ${THRESHOLD}（CLAUDE.md § Parallel Subagent Fan-out 第 3 條：萃取後 3–5K 具體指示）。
本次派工不擋；下一次派工前先預消化——只給檔案路徑、相關規則條目、驗收標準，NEVER 丟整份規約 / 原始檔全文讓 subagent 自己讀。"

jq -n --arg ctx "$MSG" \
  '{hookSpecificOutput: {hookEventName: "PreToolUse", additionalContext: $ctx}}'
exit 0
