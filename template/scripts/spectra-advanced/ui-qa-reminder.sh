#!/usr/bin/env bash
# spectra-advanced: UI edit reminder
#
# Emits lightweight reminders during active UI work so design / QA checks do
# not all get deferred until archive time.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"
sux_load_config

FILE_PATH="${1:-}"
[ -n "$FILE_PATH" ] || exit 0

if ! sux_path_is_ui_related "$FILE_PATH"; then
  exit 0
fi

COUNTER_FILE="/tmp/spectra-advanced-ui-edit-counter-$(date +%Y%m%d)-${PPID:-$$}"
COUNT=0
if [ -f "$COUNTER_FILE" ]; then
  COUNT=$(cat "$COUNTER_FILE" 2>/dev/null || echo 0)
fi
COUNT=$((COUNT + 1))
printf '%s\n' "$COUNT" > "$COUNTER_FILE"

ROOT=$(sux_repo_root)

if [ "$COUNT" -eq 1 ]; then
  if [ ! -f "$ROOT/PRODUCT.md" ]; then
    echo "首次 UI 編輯：尚未看到 PRODUCT.md。建議先跑 /impeccable teach 建立設計脈絡，再持續修改 UI。"
  elif [ ! -f "$ROOT/DESIGN.md" ]; then
    echo "首次 UI 編輯：PRODUCT.md 已建立但缺 DESIGN.md。已有 code 可跑 /impeccable document 反推；尚未實作可待 craft 後再 document。"
  fi
  exit 0
fi

if [ $((COUNT % 5)) -ne 0 ]; then
  exit 0
fi

if CHANGE_DIR=$(sux_find_active_change 2>/dev/null); then
  CHANGE_NAME=$(basename "$CHANGE_DIR")
  cat <<EOF
UI 品質提醒：本 session 已編輯 ${COUNT} 個 UI 檔案，目前有 active change「${CHANGE_NAME}」。

- 若 UI 方向已偏離，先回到 /design improve 更新診斷
- 視覺驗收證據不要拖到最後，適合先跑一次 screenshot review
- archive 前仍須通過 Design Gate 與人工檢查
EOF
else
  cat <<EOF
UI 品質提醒：本 session 已編輯 ${COUNT} 個 UI 檔案。

- 若畫面已成形，建議先做一次 screenshot review / critique
- 若此工作之後會成為正式變更，記得在 propose / apply 流程補上 Design Review 與人工檢查
EOF
fi
