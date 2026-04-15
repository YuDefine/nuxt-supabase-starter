#!/bin/bash
# Lint Supabase DB — supports both local and remote modes
# Usage: pnpm db:lint
set -euo pipefail
source "$(dirname "$0")/lib/common.sh"

if is_remote; then
  require_ssh
  echo "Linting DB on $DEV_SSH_HOST..."
  remote_exec "cd $DEV_PROJECT_DIR && supabase db lint --level warning"
else
  supabase db lint --level warning
fi
