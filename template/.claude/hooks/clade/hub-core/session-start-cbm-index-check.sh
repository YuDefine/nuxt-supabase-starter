#!/usr/bin/env bash
# Shared nonblocking health entry; bootstrap owns creation of missing graphs.
# cloud VM（CLAUDE_CODE_REMOTE 有值）整支跳過：VM 沒有 codebase-memory-mcp 也沒有 clade helper，
# 下面的 fallback 會注入「repair the clade scripts projection」，叫 session 去修不存在的投影（證據在 clade
# specs/plans/W-2026-10-07-clade-cloud-hook-remote-guard/evidence/）。
set -uo pipefail
input=""
while IFS= read -r -t 0.2 line || [[ -n "${line:-}" ]]; do input+="$line"; done
case "${CLAUDE_CODE_REMOTE:-}" in '' | 0 | false) ;; *) exit 0 ;; esac
export CLADE_CBM_SESSION_KEY="$(printf '%s' "$input" | jq -r '.session_id // .conversation_id // empty' 2>/dev/null)"
payload_repo=$(printf '%s' "$input" | jq -r '.cwd // .working_directory // empty' 2>/dev/null)
repo="${payload_repo:-${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}}"
[[ -n "$repo" ]] || exit 0
# repo 自帶的 helper 只在 repo 屬 fleet 時才取，而且從它 main checkout 的實體路徑取（判定與威脅
# 模型見 _skill-rule-reminder.sh 的 fleet_repo_root）；`$repo` 是 session cwd，NEVER 直接執行它
# 底下的腳本。不在 fleet 的 repo 仍由 clade home 的 helper 刷 index——那只讀它，不執行它。
candidates=()
# shellcheck source=_skill-rule-reminder.sh
if . "$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)/_skill-rule-reminder.sh" 2>/dev/null &&
  fleet_hit=$(fleet_repo_root "$repo"); then
  fleet_root="${fleet_hit#*$'\t'}"
  candidates+=("$fleet_root/vendor/scripts/cbm-health.ts" "$fleet_root/scripts/cbm-health.ts"
    "$fleet_root/.clade/scripts/cbm-health.ts")
fi
candidates+=("$HOME/offline/clade/vendor/scripts/cbm-health.ts")
for candidate in "${candidates[@]}"; do
  if [[ -f "$candidate" && -f "$(dirname "$candidate")/cbm-project.sh" && -f "$(dirname "$candidate")/run-evidence.ts" ]]; then
    node "$candidate" --refresh "$repo" SessionStart
    exit $?
  fi
done
jq -cn --arg event 'SessionStart' \
  --arg text 'codebase-memory: lifecycle helper missing; repair the clade scripts projection before relying on automatic index refresh' \
  '{hookSpecificOutput:{hookEventName:$event,additionalContext:$text}}'
exit 0
