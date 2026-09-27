#!/bin/bash
# Hook: 首次編輯 .ts/.vue 前搜尋既有知識
# 觸發條件: PreToolUse Edit/Write（.ts, .vue 檔案）
#
# 行為：
# - 只在 session 首次觸發時輸出提醒（透過 flag file）
# - 提醒去既有知識載體找相關經驗：lifecycle repo（有 specs/truth/work-lifecycle.md）是
#   specs/truth/**；未遷移 consumer 是既有的 docs/solutions/、docs/decisions/
# - 新教訓的落點同 knowledge-and-decisions 規約：NEVER 叫 agent 在 docs/ 開新檔
# - 根據有沒有 session task 檔引導不同流程
# - 不阻擋（exit 0），純提醒
#
# 出口是 JSON stdout 的 `hookSpecificOutput.additionalContext`，**不是**裸 stdout。
# 2026-08-06 work-loop round 31 四通道實測（TD-427 step 1）：PreToolUse 上裸 stdout、stderr、
# `permissionDecisionReason` 三者都**到不了 agent**，只有 `additionalContext` 會被注入成
# system-reminder。
#
# 本檔曾被 TD-425 § Sweep 判為「走 stdout 故到得了」而清掉——那條判定規則整條推導自
# **PostToolUse** 的實測，套到 PreToolUse 是外推。實測推翻了它。
#
# **NEVER 為了送達改 exit code**：PreToolUse 的 exit 2 是 block，與本 hook「不阻擋」的設計衝突。
# **NEVER 補 `permissionDecision`**：帶 `"allow"` 會自動核准該次 Edit/Write、繞過 permission 提示。

set -e

# Monorepo detection
if [ -d "${CLAUDE_PROJECT_DIR}/template/app" ]; then
  _PROJECT="${CLAUDE_PROJECT_DIR}/template"
else
  _PROJECT="${CLAUDE_PROJECT_DIR}"
fi

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')

# 只對 .ts 和 .vue 檔案觸發
case "$FILE_PATH" in
  *.ts|*.vue) ;;
  *) exit 0 ;;
esac

# Session-scoped: 只觸發一次
FLAG_FILE="/tmp/claude-knowledge-reminder-${PPID:-$$}"
if [ -f "$FLAG_FILE" ]; then
  exit 0
fi
touch "$FLAG_FILE"

# 知識載體依 repo 是否已採用 lifecycle 分支（判準同 consumer-docs-retirement 規約）
if [ -f "${_PROJECT}/specs/truth/work-lifecycle.md" ]; then
  KNOWLEDGE_SEARCH="specs/truth/**（specs/truth/owners.md 查該模組歸哪個單位）"
  KNOWLEDGE_RECORD="結束前把已驗證、會重現的教訓併進它所屬的 truth 單位（per knowledge-and-decisions）"
else
  KNOWLEDGE_SEARCH="docs/solutions/、docs/decisions/"
  KNOWLEDGE_RECORD="結束前把教訓寫進當下工作的 plan／spec（NEVER 在 docs/solutions/ 開新檔）"
fi

# 檢查有沒有 session task 檔（tasks/<date>-<slug>.md）
HAS_ACTIVE_TASK=false
TASK_NAME=""

if [ -d "${_PROJECT}/tasks" ]; then
  for f in "${_PROJECT}/tasks"/*.md; do
    [ -f "$f" ] || continue
    HAS_ACTIVE_TASK=true
    TASK_NAME=$(basename "$f")
    break
  done
fi

if [ "$HAS_ACTIVE_TASK" = true ]; then
  MSG=$(cat <<EOF
📚 知識搜尋提醒（首次編輯）：

Session task: ${TASK_NAME}
- 查詢相關經驗：搜尋 ${KNOWLEDGE_SEARCH} 是否有相關記錄
- 查詢現有規格：讀 isa.yml 與 specs/ 確認實作方向與規格一致
EOF
)
else
  MSG=$(cat <<EOF
📚 知識搜尋提醒（首次編輯，尚無 session task 檔）：

⚠️ tasks/ 底下沒有本次工作的 task 檔。建議：
- 非瑣碎工作 → 先開 tasks/<date>-<slug>.md（per session-tasks 規約）
- 需要規格 → 走 SpecFormula／aixbdd（specs/plans/）
- 純 debug/hotfix → 可直接實作，${KNOWLEDGE_RECORD}

搜尋既有知識：${KNOWLEDGE_SEARCH}
EOF
)
fi

# 走 jq 而非手組 JSON：${TASK_NAME} 來自檔名，可能含需要跳脫的字元。
# 本檔 L21 本來就依賴 jq，這裡不新增依賴。
jq -n --arg ctx "$MSG" \
  '{hookSpecificOutput: {hookEventName: "PreToolUse", additionalContext: $ctx}}'

exit 0
