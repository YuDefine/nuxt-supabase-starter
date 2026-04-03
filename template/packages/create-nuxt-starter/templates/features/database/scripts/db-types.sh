#!/bin/bash
# Generate TypeScript types from Supabase
# Usage: pnpm db:types
set -euo pipefail
source "$(dirname "$0")/lib/common.sh"

OUTPUT_FILE="$(dirname "$0")/../app/types/database.types.ts"
TMP_FILE="$(mktemp)"
trap 'rm -f "$TMP_FILE"' EXIT

mkdir -p "$(dirname "$OUTPUT_FILE")"

if is_remote; then
  require_ssh
  echo "Generating types from $DEV_SSH_HOST..."
  if ssh "$DEV_SSH_HOST" "cd $DEV_PROJECT_DIR && supabase gen types --lang=typescript --local" > "$TMP_FILE"; then
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
