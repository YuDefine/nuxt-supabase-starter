#!/usr/bin/env bash
# 🔒 LOCKED — managed by clade · Source: vendor/scripts/cbm-index.sh · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/cbm-index.sh
# The cgroup bounds this CLI, not an already-running indexing daemon.
set -euo pipefail
scripts=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$scripts/cbm-project.sh"
cbm_resolve_project "${1:-}" || exit 0
cbm_is_temporary && exit 0
umask 077
mkdir -p "$CBM_CACHE/provenance"
# Cache/project identity serializes aliases and callers sharing the same database.
exec flock -n "$CBM_CACHE/provenance/$CBM_PROJECT.lock" node "$scripts/cbm-health.ts" --index "$CBM_REPO" "${2:-}"
