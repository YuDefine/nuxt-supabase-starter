#!/usr/bin/env bash
# UserPromptSubmit / PreToolUse bridge to the canonical clade routing gate.
# Missing central clade is deployment skew, so bootstrap fails open; once the helper runs,
# its state/receipt failures retain their authoritative exit status.

set -uo pipefail

MODE=${1:-}
case "$MODE" in
  user-prompt | pre-tool) ;;
  *) exit 0 ;;
esac

INPUT=$(cat)

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

CLADE_ROOT=$(find_clade_root) || {
  printf 'routing gate: central clade not found; fail-open\n' >&2
  exit 0
}
HELPER="$CLADE_ROOT/vendor/scripts/pi-routing-gate.ts"
if [[ ! -f "$HELPER" ]]; then
  printf 'routing gate: helper not installed; fail-open\n' >&2
  exit 0
fi

printf '%s' "$INPUT" | node "$HELPER" "$MODE"
