#!/usr/bin/env bash
# 🔒 LOCKED — managed by clade · Source: vendor/scripts/cbm-index.sh · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/cbm-index.sh
# The cgroup bounds this CLI, not an already-running indexing daemon.
set -euo pipefail
scripts=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$scripts/cbm-project.sh"
cbm_resolve_project "${1:-}" || exit 0
cbm_is_temporary && exit 0
# Test runners place throwaway Git worktrees below these run-scoped sandboxes.
# They exercise worktree behavior, not full indexing; never index their fixtures.
for cache_root in "${XDG_CACHE_HOME:-$HOME/.cache}" "$HOME/.cache"; do
  sandbox_base="$cache_root/clade/tmp"
  [[ -d "$sandbox_base" ]] || continue
  sandbox_base=$(cd "$sandbox_base" && pwd -P)
  case "$CBM_REPO" in
    "$sandbox_base"/clade-test-run-* | "$sandbox_base"/clade-test-*-run-*) exit 0 ;;
  esac
done
umask 077
mkdir -p "$CBM_CACHE/provenance"
# Cache/project identity serializes aliases and callers sharing the same database.
exec flock -n "$CBM_CACHE/provenance/$CBM_PROJECT.lock" node "$scripts/cbm-health.ts" --index "$CBM_REPO" "${2:-}"
