#!/bin/bash
# pre-archive-design-gate.sh
# PreToolUse hook: blocks spectra-archive if:
#   1. 人工檢查 section incomplete
#   2. UI changes lack design review evidence
#
# Exit codes:
#   0 = allow
#   2 = block

set -euo pipefail

# Monorepo detection
if [ -d "${CLAUDE_PROJECT_DIR}/template/app" ]; then
  _PROJECT="${CLAUDE_PROJECT_DIR}/template"
else
  _PROJECT="${CLAUDE_PROJECT_DIR}"
fi

# Consume stdin and filter skill
INPUT=$(cat)
SKILL=$(echo "$INPUT" | jq -r '.tool_input.skill // ""' 2>/dev/null || echo "")

# 只攔截 spectra-archive
if [ "$SKILL" != "spectra-archive" ] && [ "$SKILL" != "spectra:archive" ]; then
  exit 0
fi

OPENSPEC_DIR="${_PROJECT}/openspec"
ACTIVE_CHANGE=""

# Find active change directory (skip archive/)
if [ -d "$OPENSPEC_DIR/changes" ]; then
  for dir in "$OPENSPEC_DIR/changes"/*/; do
    [ -d "$dir" ] || continue
    [[ "$(basename "$dir")" == "archive" ]] && continue
    if [ -f "$dir/proposal.md" ]; then
      ACTIVE_CHANGE="$dir"
      break
    fi
  done
fi

# No active change — allow (spectra handles its own validation)
if [ -z "$ACTIVE_CHANGE" ]; then
  exit 0
fi

TASKS_FILE="$ACTIVE_CHANGE/tasks.md"
CHANGE_NAME=$(basename "$ACTIVE_CHANGE")

# No tasks file — allow
if [ ! -f "$TASKS_FILE" ]; then
  exit 0
fi

BLOCKED=false
MESSAGES=()

# --- Check 1: 人工檢查 ---
if grep -q '^## 人工檢查' "$TASKS_FILE"; then
  UNCHECKED=$(sed -n '/^## 人工檢查/,/^## /p' "$TASKS_FILE" | grep -c '^\- \[ \]' || true)
  if [ "$UNCHECKED" -gt 0 ]; then
    BLOCKED=true
    MESSAGES+=("[Guard] 人工檢查有 ${UNCHECKED} 個未完成項目。

禁止直接編輯 checkbox 繞過此 gate。你必須按以下步驟操作：

  Step 1: 派遣 screenshot-review agent 截圖
     Agent(subagent_type=\"screenshot-review\", model=\"sonnet\",
       prompt=\"change: ${CHANGE_NAME}, 人工檢查清單: <貼上清單>\")

  Step 2: 收到報告後，引導使用者逐項檢查
     對每個檢查項目：
     a. 告訴使用者截圖路徑（使用者可用 Read 查看）
     b. 描述截圖中看到的狀態
     c. 問使用者：這項 OK 嗎？
     d. 使用者回覆 OK → 標記 [x]
     e. 使用者回覆有問題 → 記錄問題，不標記
     f. 使用者回覆 skip → 標記 [x] 並註記已跳過
     g. 使用者回覆 skip all → 全部標記 [x] 並註記

  Step 3: 全部確認完畢後，再次嘗試 archive

  你的角色是引導使用者走完檢查流程，不是自己代替使用者確認。")
  fi
else
  BLOCKED=true
  MESSAGES+=("[Guard] tasks.md 沒有「## 人工檢查」區塊。請先用 /spectra 走完整流程。")
fi

# --- Check 2: Design Gate（僅 UI change） ---
HAS_UI=false

if grep -qiE '\.vue|pages/|components/|layouts/' "$TASKS_FILE" 2>/dev/null; then
  HAS_UI=true
fi
if git diff --name-only HEAD 2>/dev/null | grep -qE '\.vue$'; then
  HAS_UI=true
fi
if git diff --cached --name-only 2>/dev/null | grep -qE '\.vue$'; then
  HAS_UI=true
fi

if [ "$HAS_UI" = true ]; then
  DESIGN_PASSED=false

  # Signal A: design-review.md 存在且有實質內容（≥10 行 + 截圖證據）
  if [ -f "$ACTIVE_CHANGE/design-review.md" ]; then
    LINE_COUNT=$(wc -l < "$ACTIVE_CHANGE/design-review.md" | tr -d ' ')
    HAS_SCREENSHOT=$(grep -ciE '\.png|\.jpg|\.jpeg|screenshot|截圖' "$ACTIVE_CHANGE/design-review.md" 2>/dev/null || echo 0)
    if [ "$LINE_COUNT" -ge 10 ] && [ "$HAS_SCREENSHOT" -gt 0 ]; then
      DESIGN_PASSED=true
    fi
  fi

  # Signal B: Design Review section 全部完成
  if [ "$DESIGN_PASSED" = false ] && grep -q '## .*Design Review' "$TASKS_FILE" 2>/dev/null; then
    DR_UNCHECKED=$(sed -n '/## .*Design Review/,/^## /p' "$TASKS_FILE" | grep -c '\- \[ \]' 2>/dev/null || echo 0)
    DR_UNCHECKED=${DR_UNCHECKED:-0}
    if [ "$DR_UNCHECKED" -eq 0 ]; then
      DESIGN_PASSED=true
    fi
  fi

  if [ "$DESIGN_PASSED" = false ]; then
    BLOCKED=true
    MESSAGES+=("[Guard] Design Gate 未通過 — change「${CHANGE_NAME}」包含 UI 變更但缺少設計審查證據。

需要以下任一信號（禁止捏造內容繞過）：
  A. design-review.md（>=10 行 + 包含截圖路徑/截圖證據）
  B. tasks.md 的 Design Review 區塊全部完成 [x]（需使用者確認）

禁止建立空的或草率的 design-review.md 繞過。你必須：
  1. 實際執行 /design improve [affected pages] — 取得診斷
  2. 依計劃跑 targeted design skills
  3. 執行 /audit 確認 Critical = 0
  4. 派遣 screenshot-review agent（model: sonnet）執行截圖驗證
  5. 將截圖路徑寫入 design-review.md，展示給使用者確認
見 .claude/rules/proactive-skills.md Design Gate 段落")
  fi
fi

# --- 輸出結果 ---
if [ "$BLOCKED" = true ]; then
  for msg in "${MESSAGES[@]}"; do
    echo "$msg"
    echo ""
  done
  exit 2
fi

exit 0
