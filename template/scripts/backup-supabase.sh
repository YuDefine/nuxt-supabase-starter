#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v supabase >/dev/null 2>&1; then
  echo "❌ 找不到 Supabase CLI，請先安裝：brew install supabase/tap/supabase"
  exit 1
fi

if [ ! -d "supabase" ]; then
  echo "❌ 找不到 supabase/ 目錄，請先執行：supabase init"
  exit 1
fi

if ! supabase status >/dev/null 2>&1; then
  echo "❌ 本地 Supabase 尚未啟動，請先執行：supabase start"
  exit 1
fi

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_DIR="supabase/backups/$TIMESTAMP"
SEED_FILE="$BACKUP_DIR/seed.sql"

mkdir -p "$BACKUP_DIR"

supabase db dump --local --data-only --use-copy -f "$SEED_FILE"

echo "✅ 備份完成"
echo "- 輸出檔案: $SEED_FILE"
