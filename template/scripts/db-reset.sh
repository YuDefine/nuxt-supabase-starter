#!/bin/bash
# Reset Supabase DB — local / remote / compose（見 db-lint.sh）
# NEVER 對 docker-compose 自架的 Supabase 用 --local，見 scripts/lib/common.sh 開頭。
# Usage: pnpm db:reset
set -euo pipefail
source "$(dirname "$0")/lib/common.sh"
refuse_local_db_if_existing_server

if is_compose; then
  # 見 db-lint.sh 的說明：自架拓樸只能走 --db-url。
  echo "⚠️  這會清空資料庫並重放 supabase/migrations/**"
  supabase db reset --db-url "$(admin_db_url)"
  echo "✅ DB reset complete."
elif is_remote; then
  require_ssh
  echo "Resetting Dev DB on $DEV_SSH_HOST..."
  remote_exec "cd $DEV_PROJECT_DIR && supabase db reset"
  echo "✅ Remote DB reset complete."
else
  echo "Resetting local DB..."
  supabase db reset
  echo "✅ Local DB reset complete."
fi
