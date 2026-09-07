#!/bin/bash
# Supabase security / performance advisors。
# security 類 finding 一律當場修或登記 TD，performance 類是參考。
# Usage: pnpm db:advisors [security|performance|all]
set -euo pipefail
source "$(dirname "$0")/lib/common.sh"
refuse_local_db_if_existing_server

TYPE="${1:-all}"

if is_compose; then
  supabase db advisors --type "$TYPE" --db-url "$(admin_db_url)"
elif is_remote; then
  require_ssh
  remote_exec "cd $DEV_PROJECT_DIR && supabase db advisors --type $TYPE"
else
  supabase db advisors --type "$TYPE" --local
fi
