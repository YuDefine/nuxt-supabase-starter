#!/usr/bin/env bash
set -euo pipefail

HOOK_EVENT="${HOOK_EVENT:-}"
ORIGINAL_HOOK_COMMAND="${ORIGINAL_HOOK_COMMAND:-}"

if [ -z "$ORIGINAL_HOOK_COMMAND" ]; then
  echo "Missing ORIGINAL_HOOK_COMMAND for Codex hook wrapper" >&2
  exit 1
fi

stdin_file="$(mktemp)"
stdout_file="$(mktemp)"
stderr_file="$(mktemp)"

cleanup() {
  rm -f "$stdin_file" "$stdout_file" "$stderr_file"
}
trap cleanup EXIT

cat > "$stdin_file"

set +e
/bin/bash -lc "$ORIGINAL_HOOK_COMMAND" <"$stdin_file" >"$stdout_file" 2>"$stderr_file"
status=$?
set -e

if [ -s "$stdout_file" ] && jq empty "$stdout_file" >/dev/null 2>&1; then
  cat "$stdout_file"
  if [ -s "$stderr_file" ]; then
    cat "$stderr_file" >&2
  fi
  exit "$status"
fi

if [ -s "$stderr_file" ]; then
  cat "$stderr_file" >&2
fi

if [ "$status" -eq 0 ]; then
  if [ ! -s "$stdout_file" ]; then
    exit 0
  fi

  message="$(cat "$stdout_file")"
  case "$HOOK_EVENT" in
    SessionStart)
      printf '%s
' "$message"
      exit 0
      ;;
    PostToolUse)
      # Codex expects JSON for PostToolUse. Suppress plain-text stdout here so a
      # reminder-style Claude hook does not become an invalid post-tool-use JSON error.
      exit 0
      ;;
    Stop)
      jq -n --arg reason "$message" '{ decision: "block", reason: $reason }'
      exit 0
      ;;
    *)
      printf '%s
' "$message"
      exit 0
      ;;
  esac
fi

if [ -s "$stdout_file" ]; then
  cat "$stdout_file"
fi

exit "$status"
