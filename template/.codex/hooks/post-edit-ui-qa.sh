#!/bin/bash
# Hook: UI 檔案編輯後提醒 design 品質檢查
# 觸發條件: Edit/Write 完成後 (*.vue, pages/, components/, layouts/)
#
# 行為：
# - 追蹤本次 session 的 UI 編輯次數（透過暫存檔）
# - 每 5 次 UI 編輯輸出一次 design 提醒（避免每次都吵）
# - 首次 UI 編輯時輸出一次性提醒

set -e

# Monorepo detection
if [ -d "${PROJECT_DIR}/template/app" ]; then
  _PROJECT="${PROJECT_DIR}/template"
else
  _PROJECT="${PROJECT_DIR}"
fi

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_response.filePath // ""')

# 只對 UI 相關檔案觸發
case "$FILE_PATH" in
  *.vue) ;;
  */pages/*|*/components/*|*/layouts/*) ;;
  *) exit 0 ;;
esac

# 追蹤 UI 編輯次數（session-scoped temp file）
COUNTER_FILE="/tmp/claude-ui-edit-counter-$$"

# 嘗試讀取父 process 的 counter（Claude session 的 PID 較穩定）
if [ -n "$PPID" ]; then
  COUNTER_FILE="/tmp/claude-ui-edit-counter-${PPID}"
fi

COUNT=0
if [ -f "$COUNTER_FILE" ]; then
  COUNT=$(cat "$COUNTER_FILE" 2>/dev/null || echo 0)
fi
COUNT=$((COUNT + 1))
echo "$COUNT" > "$COUNTER_FILE"

# 檢查 .impeccable.md 是否存在
HAS_IMPECCABLE=false
if [ -f "${_PROJECT}/.impeccable.md" ]; then
  HAS_IMPECCABLE=true
fi

# 首次 UI 編輯
if [ "$COUNT" -eq 1 ]; then
  if [ "$HAS_IMPECCABLE" = false ]; then
    echo "🎨 首次 UI 編輯 — .impeccable.md 不存在。建議先執行 /impeccable teach 建立設計脈絡。"
  fi
  exit 0
fi

# 每 5 次提醒一次
if [ $((COUNT % 5)) -eq 0 ]; then
  cat <<EOF
🎨 UI 品質提醒（已編輯 ${COUNT} 個 UI 檔案）：
  - 目前的 UI 變更是否符合設計方向？考慮跑 /critique 快速評估
  - 有 active spectra change？Design Review tasks 會在實作階段結束後執行
  - 需要即時檢查？執行 /audit [page] 或截圖確認
EOF
fi

exit 0
