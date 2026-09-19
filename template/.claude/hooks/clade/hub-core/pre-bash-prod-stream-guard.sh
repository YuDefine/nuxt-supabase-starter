#!/usr/bin/env bash
# PreToolUse:Bash — consumer-configured production DB stdout/pipe guard.
#
# Consumers opt in with .claude/prod-stream-guard.json. The central hook owns
# evaluation so a dangerous export cannot bypass a prose-only rule. Missing or
# invalid config/dependencies fail open; a matched blocked pattern fails closed.

set -uo pipefail

project_dir=${CLAUDE_PROJECT_DIR:-}
[ -n "$project_dir" ] || exit 0
config="$project_dir/.claude/prod-stream-guard.json"
[ -f "$config" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0
command -v perl >/dev/null 2>&1 || exit 0

jq -e '
  .schemaVersion == 1
  and (.protectedHosts | type == "array")
  and (.safeHelpers | type == "array")
  and (.blockedPatterns | type == "array")
  and all(.protectedHosts[]; type == "string" and length > 0)
  and all(.safeHelpers[]; (.id | type == "string") and (.commandRegex | type == "string"))
  and all(.blockedPatterns[]; (.id | type == "string") and (.regex | type == "string"))
' "$config" >/dev/null 2>&1 || exit 0

input=$(cat) || exit 0
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""' 2>/dev/null) || exit 0
[ -n "$cmd" ] || exit 0

protected=0
while IFS= read -r host; do
  [ -n "$host" ] || continue
  case "$cmd" in
    *"$host"*) protected=1; break ;;
  esac
done < <(jq -r '.protectedHosts[]' "$config" 2>/dev/null) || exit 0
[ "$protected" -eq 1 ] || exit 0

matches_regex() {
  local value=$1
  local regex=$2
  perl -e '
    use strict;
    use warnings;
    my ($value, $regex) = @ARGV;
    my $matched = eval { $value =~ /$regex/is ? 1 : 0 };
    exit 2 if $@;
    exit($matched ? 0 : 1);
  ' "$value" "$regex" 2>/dev/null
}

while IFS= read -r encoded; do
  [ -n "$encoded" ] || continue
  item=$(printf '%s' "$encoded" | base64 -d 2>/dev/null) || exit 0
  id=$(printf '%s' "$item" | jq -r '.id' 2>/dev/null) || exit 0
  regex=$(printf '%s' "$item" | jq -r '.regex' 2>/dev/null) || exit 0
  matches_regex "$cmd" "$regex"
  status=$?
  [ "$status" -ne 2 ] || exit 0
  if [ "$status" -eq 0 ]; then
    helper=$(jq -r '.safeHelpers[0].id // "consumer-declared safe helper"' "$config" 2>/dev/null)
    helper_regex=$(jq -r '.safeHelpers[0].commandRegex // ""' "$config" 2>/dev/null)
    printf '\n⛔ [clade] blocked production database stdout/pipe export (%s)\n' "$id" >&2
    printf '   Use the consumer safe helper: %s\n' "$helper" >&2
    [ -z "$helper_regex" ] || printf '   Contract: %s\n' "$helper_regex" >&2
    exit 2
  fi
done < <(jq -r '.blockedPatterns[] | @base64' "$config" 2>/dev/null) || exit 0

while IFS= read -r encoded; do
  [ -n "$encoded" ] || continue
  item=$(printf '%s' "$encoded" | base64 -d 2>/dev/null) || exit 0
  regex=$(printf '%s' "$item" | jq -r '.commandRegex' 2>/dev/null) || exit 0
  matches_regex "$cmd" "$regex"
  status=$?
  [ "$status" -ne 2 ] || exit 0
  [ "$status" -ne 0 ] || exit 0
done < <(jq -r '.safeHelpers[] | @base64' "$config" 2>/dev/null) || exit 0

exit 0
