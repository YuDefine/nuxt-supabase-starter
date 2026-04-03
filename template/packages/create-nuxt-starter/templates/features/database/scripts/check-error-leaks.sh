#!/bin/bash
# 檢查 server API 中是否有 createError 帶 data 屬性（可能洩漏內部錯誤）

PATTERN='createError\(\{[^}]*data:'
FILES=$(grep -rn "$PATTERN" server/api/ --include="*.ts" -l 2>/dev/null)

if [ -n "$FILES" ]; then
  echo "❌ 發現 createError 中帶有 data 屬性（可能洩漏內部錯誤）："
  grep -rn "$PATTERN" server/api/ --include="*.ts"
  echo ""
  echo "請移除 data 屬性，改用 statusMessage 回傳使用者友善訊息。"
  exit 1
fi

echo "✅ 無 createError data 洩漏"
