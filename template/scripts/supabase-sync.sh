#!/bin/bash
# Sync local supabase/ config, migrations, and seed to remote Supabase via SSH
# Usage: pnpm supabase:sync
# Only needed in remote mode (SUPABASE_MODE=remote)
set -euo pipefail
source "$(dirname "$0")/lib/common.sh"

if ! is_remote; then
  echo "ℹ️  本地模式不需要 sync（直接使用 pnpm db:reset）"
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOCAL_SUPABASE="$SCRIPT_DIR/../supabase"

require_ssh

# Guard against empty migrations dir
sql_count=$(find "$LOCAL_SUPABASE/migrations" -maxdepth 1 -name "*.sql" 2>/dev/null | wc -l | tr -d ' ')
if [[ "$sql_count" -eq 0 ]]; then
  echo "❌ No .sql files in $LOCAL_SUPABASE/migrations/" >&2
  echo "   Refusing to sync empty directory (--delete would wipe remote)" >&2
  exit 1
fi

echo "Syncing supabase/ to $DEV_SSH_HOST..."

rsync -az --timeout=30 \
  "$LOCAL_SUPABASE/config.toml" \
  "$DEV_SSH_HOST:$DEV_PROJECT_DIR/supabase/config.toml"

test -f "$LOCAL_SUPABASE/seed.sql" && \
  rsync -az --timeout=30 "$LOCAL_SUPABASE/seed.sql" "$DEV_SSH_HOST:$DEV_PROJECT_DIR/supabase/seed.sql" || true

rsync -az --timeout=30 --delete \
  "$LOCAL_SUPABASE"/migrations/ \
  "$DEV_SSH_HOST:$DEV_PROJECT_DIR/supabase/migrations/"

LOCAL_COUNT=$(find "$LOCAL_SUPABASE/migrations" -maxdepth 1 -name "*.sql" | wc -l | tr -d ' ')
REMOTE_COUNT=$(remote_exec "ls $DEV_PROJECT_DIR/supabase/migrations/*.sql 2>/dev/null | wc -l" | tr -d ' ')

echo "Synced: $LOCAL_COUNT local → $REMOTE_COUNT remote migrations"
echo "Done. Run 'pnpm db:reset' to apply."
