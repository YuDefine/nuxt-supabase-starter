#!/usr/bin/env bash
# UserPromptSubmit hook — user 打 `/goal` 的那一刻，注入 goal-mode 判別測試一行。
#
# 這是 goal 兩條觸發路徑的第二條（另一條是 model 自己提，見
# pre-propose-goal-vet.sh 的 PreToolUse:ProposeGoal）。
#
# **通道是實測定的，不是查文件定的**（2026-08-29，TD-824）：
#   - `UserPromptSubmit` 的 `.prompt` 收到的是**字面** `/goal <args>`，不是展開後的內容
#   - `UserPromptExpansion` 對內建 slash command **不 fire**（同一次實測，同一個 probe）
# 兩件事都與當時查到的說法相反。**NEVER 因為某份文件說 UserPromptSubmit 看不到 slash
# command 就改通道** —— 改之前先用 probe hook 重跑一次那個實測。
#
# NEVER 複製規約全文（hook 注入的 bytes 不在 always-load budget 分母裡，搬全文
# 等於繞過 budget gate）。只放 pointer 級，長度由 test 釘住。
# jq 缺 / 解析失敗 → silent exit 0（fail-open）。

set -uo pipefail

INPUT=$(cat)
command -v jq >/dev/null 2>&1 || exit 0
PROMPT=$(printf '%s' "$INPUT" | jq -r '.prompt // ""' 2>/dev/null) || exit 0
[ -n "$PROMPT" ] || exit 0

# 只認行首的 /goal，且後面不能緊接英數（`/goals` 不算）。
# `/goal clear` 是收掉 goal，不需要判別測試 —— 但它也無害，不特別排除以免多一條分支。
printf '%s' "$PROMPT" | grep -qE '^[[:space:]]*/goal([^[:alnum:]-]|$)' || exit 0

MSG='🎯 偵測到 /goal — MUST 先過判別測試（全文 `~/offline/clade/docs/rule-rationale/goal-mode.md`）：對 goal 內**每一條**問「stop-hook 觸發時，我能用工具自力驗證這條完成嗎？」。任一條答否就 NEVER 收下（user 親跑 / 親確認、user 環境密鑰、user commit 決策、等 CI 等外部 signal、跨 session 協作皆屬之）——那會讓 stop-hook 變成無限迴圈，只能反覆吐「等 user」直到 token 燒光。改用 AskUserQuestion 把 user-bound 條目列出來，提議移到 HANDOFF.md / docs/tech-debt.md，確認剩下的才啟動。'

jq -n --arg ctx "$MSG" \
  '{hookSpecificOutput: {hookEventName: "UserPromptSubmit", additionalContext: $ctx}}'
exit 0
