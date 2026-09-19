#!/usr/bin/env bash
# PreToolUse:ProposeGoal hook — model 自己提 session goal 的那一刻，注入
# goal-mode 判別測試一行。
#
# 為什麼是 hook 不是 always-load rule：`/goal` 的兩條觸發路徑裡，**這一條**
# （model-proposed，`ProposeGoal` 工具，harness 預設 `auto`）沒有任何 prompt
# 層標記——user 沒打任何東西，規約要在「模型正要提 goal」那一刻到場。
# always-load 對它的送達靠模型從 184 KB 常駐裡回想起這條；PreToolUse 是機器判定。
#
# **NEVER 在這裡複製規約全文**（per TD-824 § 未治理的旁路）：hook 注入的 bytes
# 不在 always-load budget 分母裡，全文搬過來等於繞過 budget gate。只放 pointer 級。
#
# warn/inject，NEVER block：規約要的是「這條件 agent 驗不驗得了」的判斷，
# 不是禁止提 goal。exit 2 會把一個合法動作變成不可能。
# jq 缺 / 解析失敗 → silent exit 0（fail-open，同 user-prompt-shorthand-gate.sh）。

set -uo pipefail

INPUT=$(cat)
command -v jq >/dev/null 2>&1 || exit 0
TOOL=$(printf '%s' "$INPUT" | jq -r '.tool_name // ""' 2>/dev/null) || exit 0

# matcher 已在 hooks.json 綁 ProposeGoal，這裡再確認一次——matcher 是 regex，
# 未來若有 ProposeGoalSomething 這類工具名會一起命中。
[ "$TOOL" = "ProposeGoal" ] || exit 0

MSG='🎯 正要提 session goal — MUST 先過判別測試（全文 `~/offline/clade/docs/rule-rationale/goal-mode.md`）：對 goal 內**每一條**問「stop-hook 觸發時，我能用工具自力驗證這條完成嗎？」。任一條答否就 NEVER 放進 goal（user 親跑 / 親確認、user 環境密鑰、user commit 決策、等 CI 等外部 signal、跨 session 協作皆屬之）——那會讓 stop-hook 變成無限迴圈，agent 只能反覆吐「等 user」直到 token 燒光。改把那些條目移到 HANDOFF.md / docs/tech-debt.md。'

jq -n --arg ctx "$MSG" \
  '{hookSpecificOutput: {hookEventName: "PreToolUse", additionalContext: $ctx}}'
exit 0
