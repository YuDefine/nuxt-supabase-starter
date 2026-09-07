#!/bin/bash
# Generate TypeScript types from Supabase — local / remote / compose（見 db-lint.sh）
# NEVER 對 docker-compose 自架的 Supabase 用 --local，見 scripts/lib/common.sh 開頭。
# Usage: pnpm db:types
set -euo pipefail
source "$(dirname "$0")/lib/common.sh"
refuse_local_db_if_existing_server

OUTPUT_FILE="$(dirname "$0")/../app/types/database.types.ts"
TMP_FILE="$(mktemp)"
trap 'rm -f "$TMP_FILE"' EXIT

mkdir -p "$(dirname "$OUTPUT_FILE")"

if is_compose; then
  # 見 db-lint.sh 的說明：自架拓樸只能走 --db-url。
  echo "Generating types via --db-url..."
  if supabase gen types --lang=typescript --db-url "$(admin_db_url)" > "$TMP_FILE"; then
    mv "$TMP_FILE" "$OUTPUT_FILE"
    echo "✅ Types written to app/types/database.types.ts"
  else
    echo "❌ Failed to generate types" >&2
    exit 1
  fi
elif is_remote; then
  require_ssh
  echo "Generating types from $DEV_SSH_HOST..."
  if remote_exec "cd $DEV_PROJECT_DIR && supabase gen types --lang=typescript --local" > "$TMP_FILE"; then
    mv "$TMP_FILE" "$OUTPUT_FILE"
    echo "✅ Types written to app/types/database.types.ts"
  else
    echo "❌ Failed to generate types" >&2
    exit 1
  fi
else
  echo "Generating types from local Supabase..."
  if supabase gen types --lang=typescript --local > "$TMP_FILE"; then
    mv "$TMP_FILE" "$OUTPUT_FILE"
    echo "✅ Types written to app/types/database.types.ts"
  else
    echo "❌ Failed to generate types" >&2
    exit 1
  fi
fi
