#!/usr/bin/env bash
# Stop hook — when a review-handoff receipt exists, last user-visible /review/
# URL MUST exact-match the receipt's review_url (canonical HTTPS).
#
# exit 2 blocks stop. No receipt / stale receipt / no /review/ URL → exit 0.
# NEVER host-blacklist: curl http://127.0.0.1:5174/api/changes is probe-only
# and is not a /review/ path.
#
# fail-open: helper missing / node missing / stdin not JSON.

set -uo pipefail

input=$(cat || true)

find_clade_root() {
  if [[ -n "${CLADE_HOME:-}" && -f "$CLADE_HOME/registry/consumers.json" ]]; then
    printf '%s\n' "$CLADE_HOME"
    return 0
  fi
  for candidate in "$HOME/clade" "$HOME/offline/clade"; do
    if [[ -f "$candidate/registry/consumers.json" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

command -v node >/dev/null 2>&1 || exit 0
CLADE_ROOT=$(find_clade_root) || exit 0
HELPER="$CLADE_ROOT/vendor/scripts/review-handoff-url.ts"
[ -f "$HELPER" ] || exit 0

printf '%s' "$input" | node "$HELPER" stop-check
exit $?
