#!/bin/bash
# Reset Supabase DB — local / remote / compose
# NEVER 對 docker-compose 自架的 Supabase 用 --local，見 scripts/lib/common.sh 開頭。
# Usage: pnpm db:reset
set -euo pipefail
source "$(dirname "$0")/lib/common.sh"

if is_compose; then
  echo "⚠️  這會清空資料庫並重放 supabase/migrations/**"
  supabase db reset --db-url "$(admin_db_url)"
  echo "✅ DB reset complete."
elif is_remote; then
  require_ssh
  echo "Resetting Dev DB on $DEV_SSH_HOST..."
  ssh -t "$DEV_SSH_HOST" "cd $DEV_PROJECT_DIR && supabase db reset"
  echo "✅ Remote DB reset complete."
else
  echo "Resetting local DB..."
  supabase db reset
  echo "✅ Local DB reset complete."
fi
