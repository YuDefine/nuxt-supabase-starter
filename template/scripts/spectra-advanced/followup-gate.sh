#!/usr/bin/env bash
# 🔒 LOCKED — managed by clade · Source: vendor/scripts/spectra-advanced/followup-gate.sh · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/spectra-advanced/followup-gate.sh
# Preserve the archive gate CLI while sharing status and archive parsing with the collector.
set -uo pipefail
CHANGE="${1:-}"
[ -n "$CHANGE" ] || exit 0
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
exec node "$SCRIPT_DIR/collect-followups.ts" --gate "$CHANGE"
