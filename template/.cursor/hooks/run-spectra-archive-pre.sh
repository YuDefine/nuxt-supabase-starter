#!/usr/bin/env bash

set -euo pipefail

ROOT="${CURSOR_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-$(pwd)}}"
PAYLOAD=$(jq -nc --arg skill "spectra-archive" --arg args "$*" '{tool_input:{skill:$skill,args:$args}}')

run_gate() {
  local hook_path="$1"
  [ -x "$hook_path" ] || return 0

  local output
  output=$(printf '%s\n' "$PAYLOAD" | (cd "$ROOT" && "$hook_path") 2>&1) || local status=$?
  status=${status:-0}

  if [ -n "$output" ]; then
    printf '%s\n' "$output"
  fi

  return "$status"
}

run_gate "$ROOT/.claude/hooks/pre-archive-design-gate.sh"
run_gate "$ROOT/.claude/hooks/pre-archive-ux-gate.sh"
run_gate "$ROOT/.claude/hooks/pre-archive-followup-gate.sh"
