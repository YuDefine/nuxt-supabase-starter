#!/usr/bin/env bash
# PostToolUse(Edit|Write) — UI 編輯期間的中途提醒（design / screenshot review）。
#
# 業務邏輯在 clade 的 vendor/scripts/ui-qa-reminder.sh。2026-09-07（TD-976 Wave 1）
# 之前它住在 consumer 端的 `scripts/spectra-advanced/`，隨 spectra 退役後改成**直接跑
# clade 中央倉那一份**（下方 `find_clade_root` 解析 clade home）。
# **NEVER** 改回 consumer-relative 路徑：那個目錄正在被 propagate 清除。

set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_response.filePath // ""' 2>/dev/null || echo "")

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

find_clade_root() {
  if [[ -n "${CLADE_HOME:-}" && -f "$CLADE_HOME/registry/consumers.json" ]]; then
    echo "$CLADE_HOME"; return 0
  fi
  for c in "$HOME/clade" "$HOME/offline/clade"; do
    if [[ -f "$c/registry/consumers.json" ]]; then
      echo "$c"; return 0
    fi
  done
  return 1
}

CLADE_ROOT=$(find_clade_root) || exit 0
SCRIPT="$CLADE_ROOT/vendor/scripts/ui-qa-reminder.sh"
[ -x "$SCRIPT" ] || exit 0

exec "$SCRIPT" "$FILE_PATH"
