#!/bin/bash
# Verify connectivity to Supabase environments
# Usage: pnpm supabase:check
set -euo pipefail
source "$(dirname "$0")/lib/common.sh"

echo "Checking Supabase connectivity..."
echo ""

if is_remote; then
  echo "Mode: Remote ($DEV_SSH_HOST)"

  # Check SSH
  if ssh -o ConnectTimeout=5 -o BatchMode=yes "$DEV_SSH_HOST" true 2>/dev/null; then
    echo "  ✓ SSH OK"
  else
    echo "  ✗ SSH unreachable (check ~/.ssh/config)"
  fi

  # Check API
  REMOTE_URL="${SUPABASE_URL:-http://$DEV_SSH_HOST:54321}"
  if curl -sf -o /dev/null -w '' "$REMOTE_URL/rest/v1/" --max-time 3; then
    echo "  ✓ API reachable ($REMOTE_URL)"
  else
    echo "  ✗ API unreachable ($REMOTE_URL)"
  fi
else
  echo "Mode: Local"

  if curl -sf -o /dev/null -w '' "http://localhost:54321/rest/v1/" --max-time 3; then
    echo "  ✓ Local Supabase API reachable"
  else
    echo "  ✗ Local Supabase not running (run: supabase start)"
  fi
fi
