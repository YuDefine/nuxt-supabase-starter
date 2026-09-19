#!/usr/bin/env bash
# Shared nonblocking health entry; bootstrap owns creation of missing graphs.
set -uo pipefail
input=""
while IFS= read -r -t 0.2 line || [[ -n "${line:-}" ]]; do input+="$line"; done
export CLADE_CBM_SESSION_KEY="$(printf '%s' "$input" | jq -r '.session_id // .conversation_id // empty' 2>/dev/null)"
payload_repo=$(printf '%s' "$input" | jq -r '.cwd // .working_directory // empty' 2>/dev/null)
repo="${payload_repo:-${CLAUDE_PROJECT_DIR:-${CURSOR_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}}}"
[[ -n "$repo" ]] || exit 0
for candidate in "$repo/vendor/scripts/cbm-health.ts" "$repo/scripts/cbm-health.ts" \
  "$repo/.clade/scripts/cbm-health.ts" "$HOME/offline/clade/vendor/scripts/cbm-health.ts"; do
  if [[ -f "$candidate" && -f "$(dirname "$candidate")/cbm-project.sh" && -f "$(dirname "$candidate")/run-evidence.ts" ]]; then
    node "$candidate" --refresh "$repo" PostToolUse
    exit $?
  fi
done
jq -cn --arg event 'PostToolUse' --arg runtime "${CLADE_RUNTIME:-}" \
  --arg text 'codebase-memory: lifecycle helper missing; repair the clade scripts projection before relying on automatic index refresh' \
  'if $runtime == "cursor" then {additional_context:$text} else {hookSpecificOutput:{hookEventName:$event,additionalContext:$text}} end'
exit 0
