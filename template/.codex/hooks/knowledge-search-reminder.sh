#!/bin/bash
# Hook: 首次編輯 .ts/.vue 前搜尋既有知識 + 引導 Spectra/Design 流程
# 觸發條件: PreToolUse Edit/Write（.ts, .vue 檔案）
#
# 行為：
# - 只在 session 首次觸發時輸出提醒（透過 flag file）
# - 搜尋 docs/solutions/ 和 docs/verify/ 是否有相關經驗
# - 根據有無 active spectra change 引導不同流程
# - 不阻擋（exit 0），純提醒

set -e

# Monorepo detection
if [ -d "${PROJECT_DIR}/template/app" ]; then
  _PROJECT="${PROJECT_DIR}/template"
else
  _PROJECT="${PROJECT_DIR}"
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

# 檢查是否有 active spectra change
HAS_ACTIVE_CHANGE=false
CHANGE_NAME=""
OPENSPEC_DIR="${_PROJECT}/openspec"

if [ -d "$OPENSPEC_DIR/changes" ]; then
  for dir in "$OPENSPEC_DIR/changes"/*/; do
    [ -d "$dir" ] || continue
    [[ "$(basename "$dir")" == "archive" ]] && continue
    if [ -f "$dir/proposal.md" ]; then
      HAS_ACTIVE_CHANGE=true
      CHANGE_NAME=$(basename "$dir")
      break
    fi
  done
fi

# 取得編輯檔案的基本名稱供搜尋建議
BASENAME=$(basename "$FILE_PATH" 2>/dev/null || echo "")

if [ "$HAS_ACTIVE_CHANGE" = true ]; then
  cat <<EOF
📚 知識搜尋提醒（首次編輯）：

Active change: ${CHANGE_NAME}
- 查詢相關經驗：搜尋 docs/solutions/ 是否有相關問題記錄
- 查詢現有規格：/spectra-ask 確認實作方向與 spec 一致

此 change 若涉及 UI（.vue），Design Review tasks 會在實作後自動觸發。
EOF
else
  cat <<EOF
📚 知識搜尋提醒（首次編輯，無 active change）：

⚠️ 目前沒有 active Spectra change。建議：
- 需求明確 → /spectra-propose 建立 change 再實作
- 需求模糊 → /spectra-discuss 先釐清
- 純 debug/hotfix → 可直接實作，但結束前考慮 docs/solutions/ 記錄

搜尋既有知識：docs/solutions/
EOF
fi

exit 0
