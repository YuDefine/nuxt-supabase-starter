#!/usr/bin/env bash
# 🔒 LOCKED — managed by clade · Source: vendor/scripts/cbm-index.sh · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/cbm-index.sh
# Protected explicit index entry shared by lifecycle hooks.
# The cgroup bounds this CLI process; a pre-existing daemon may execute indexing.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/cbm-project.sh"
cbm_resolve_project "${1:-}" || exit 0
cbm_is_temporary && exit 0
bin=$(command -v codebase-memory-mcp 2>/dev/null) || bin="$HOME/.local/bin/codebase-memory-mcp"
[[ -x "$bin" ]] || exit 0
command -v jq >/dev/null 2>&1 || { echo 'cbm-index: jq is required to encode the index request' >&2; exit 1; }
lock="${TMPDIR:-/tmp}/cbm-index-${CBM_PATH_ID}.lock"
[[ -d "$CBM_CACHE" ]] && find "$CBM_CACHE" -maxdepth 1 -name '*.corrupt' -mtime +7 -delete 2>/dev/null || true
payload=$(jq -cn --arg repo "$CBM_REPO" --arg name "$CBM_PROJECT" --arg mode "${2:-}" '{repo_path:$repo,name:$name} + (if $mode == "" then {} else {mode:$mode} end)')
if case "$(systemctl --user is-system-running 2>/dev/null)" in running|degraded) true ;; *) false ;; esac; then
  exec systemd-run --user --scope -q \
    -p MemoryMax="${CBM_INDEX_MEM_MAX:-6G}" -p MemorySwapMax=0 -p CPUQuota="${CBM_INDEX_CPU_QUOTA:-200%}" \
    flock -n "$lock" "$bin" cli index_repository "$payload"
else
  exec flock -n "$lock" "$bin" cli index_repository "$payload"
fi
