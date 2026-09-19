#!/usr/bin/env bash
# clade improvement-loop: SessionStart PATH-order check.
#
# Verifies that ${CLADE_ROOT}/bin precedes other directories that ship a real
# `vp` binary in PATH. If the shim is shadowed, signal capture for human-terminal
# vp invocations silently drops. We emit a one-time warning per session so the
# user can fix shell rc ordering; we never abort the session.
#
# This is fail-open: any error printed here is informational only.
#
# Output cap: the only unbounded part is $shadow_body (`type vp` prints the
# whole function body when vp is shadowed by a shell function) — capped at
# 10 lines / 800 bytes via cap_output so the fixed Quick-fix guidance below it
# (and the PATH-order block) always survives. Worst case total output:
# ~22 lines (shadow block) + ~11 lines (PATH block) ≈ 33 lines / ~2.5KB,
# within the 40-line / 4000-byte SessionStart budget by construction.

set -u
set +e

HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ -f "$HOOK_DIR/_output-cap.sh" ]]; then
  # shellcheck source=_output-cap.sh
  . "$HOOK_DIR/_output-cap.sh"
else
  # Fail-open: helper missing → pass-through (never block session start).
  cap_output() { cat; }
fi

find_clade_root() {
  if [[ -n "${CLADE_HOME:-}" && -f "$CLADE_HOME/registry/consumers.json" ]]; then
    echo "$CLADE_HOME"; return 0
  fi
  for c in "$HOME/clade" "$HOME/offline/clade"; do
    if [[ -f "$c/registry/consumers.json" ]]; then
      echo "$c"; return 0
    fi
  done
  return 1
}

CLADE_ROOT=$(find_clade_root) || exit 0

SHIM_DIR="$CLADE_ROOT/bin"
if [[ ! -x "$SHIM_DIR/vp" ]]; then
  exit 0
fi

# Step 1: detect shell function / alias shadow. `type vp` reports function/alias
# even when PATH is correctly ordered. Subprocess `which`/PATH lookup can't see
# this because functions/aliases are shell-local.
shadow_kind=""
shadow_body=""
if type_out=$(type vp 2>/dev/null); then
  case "$type_out" in
    *"is a shell function"*) shadow_kind="function"; shadow_body="$type_out" ;;
    *"is an alias"*)         shadow_kind="alias";    shadow_body="$type_out" ;;
  esac
fi

if [[ -n "$shadow_kind" ]]; then
  # Function bodies can be arbitrarily long — keep the head, fold the rest so
  # the Quick-fix guidance below always stays visible.
  shadow_body=$(printf '%s\n' "$shadow_body" | cap_output 10 800 'type vp')
  cat >&2 <<MSG
[clade improvement-loop] vp shim shadowed by shell $shadow_kind:
$shadow_body

  Human-terminal \`vp\` invocations resolve to the shell $shadow_kind, **not**
  the shim at $SHIM_DIR/vp. Signal capture for those invocations drops silently.
  Agent-driven \`vp\` (subprocess) still hits the shim because subprocesses do
  not inherit shell functions/aliases.

  Quick fix: remove the $shadow_kind from your shell rc, e.g.
    unset -f vp     # if function
    unalias vp      # if alias
  Then ensure PATH puts $SHIM_DIR first (see secondary check below).
MSG
fi

# Step 2: find every executable named 'vp' in PATH order, return the first that is NOT the shim.
shim_real_path=$(cd "$SHIM_DIR" && pwd -P)/vp
first_vp=""
IFS=':' read -r -a path_dirs <<< "$PATH"
for d in "${path_dirs[@]}"; do
  [[ -z "$d" ]] && continue
  candidate="$d/vp"
  [[ -x "$candidate" ]] || continue
  real_candidate=$(cd "$d" 2>/dev/null && pwd -P)/vp
  first_vp="$real_candidate"
  break
done

if [[ -z "$first_vp" ]]; then
  exit 0
fi

if [[ "$first_vp" != "$shim_real_path" ]]; then
  cat >&2 <<MSG
[clade improvement-loop] PATH order issue:
  expected first vp in PATH: $shim_real_path (clade shim)
  actual first vp in PATH:   $first_vp

  The shim will be bypassed for human-terminal \`vp\` invocations until you put
  $SHIM_DIR ahead of the other vp install in PATH. Agent-driven invocations
  routed through clade tooling still work.

  Quick fix: add this line to your shell rc (above any vp install dir):
    export PATH="$SHIM_DIR:\$PATH"
MSG
fi

exit 0
