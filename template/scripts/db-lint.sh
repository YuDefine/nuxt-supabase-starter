#!/bin/bash
# Lint Supabase DB — local（supabase start）/ remote（ssh + supabase start）/ compose（--db-url）
# NEVER 對 docker-compose 自架的 Supabase 用 --local，見 scripts/lib/common.sh 開頭。
# Usage: pnpm db:lint
set -euo pipefail
source "$(dirname "$0")/lib/common.sh"
refuse_local_db_if_existing_server

if is_compose; then
  # docker-compose 自架沒有 CLI 認得的 local 專案，--local 一律回
  # "supabase start is not running"。--db-url 直連 Postgres 才是這個拓樸的入口。
  echo "Linting DB via --db-url..."
  supabase db lint --level warning --db-url "$(admin_db_url)"
elif is_remote; then
  require_ssh
  echo "Linting DB on $DEV_SSH_HOST..."
  remote_exec "cd $DEV_PROJECT_DIR && supabase db lint --level warning"
else
  supabase db lint --level warning
fi
