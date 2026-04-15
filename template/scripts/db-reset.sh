#!/bin/bash
# Reset Supabase DB — supports both local and remote modes
# Usage: pnpm db:reset
set -euo pipefail
source "$(dirname "$0")/lib/common.sh"

if is_remote; then
  require_ssh
  echo "Resetting Dev DB on $DEV_SSH_HOST..."
  remote_exec "cd $DEV_PROJECT_DIR && supabase db reset"
  echo "✅ Remote DB reset complete."
else
  echo "Resetting local DB..."
  supabase db reset
  echo "✅ Local DB reset complete."
fi
