#!/usr/bin/env bash
# clade session-claim: SessionStart heartbeat refresh.
#
# Looks up an existing .clade/claims/<session-id>.json whose worktree_path
# matches the current cwd and refreshes its expires_at. Fail-open: any error
# or absence (no claim, no script, no git repo) is silent. Pure best-effort.
#
# Contract: rules/core/session-claims.md
#
# Output budget: this hook is silent by design — the only external call below
# discards stdout AND stderr (>/dev/null 2>&1), so total session-context
# injection is 0 lines (trivially within the 40-line / 4000-byte SessionStart
# budget). No cap_output wrapping: surfacing previously-discarded helper
# errors would violate the silent best-effort contract above. If this hook
# ever starts emitting, route it through hooks/_output-cap.sh like the other
# session-start-* hooks.
#
# The Claude Code session may start in a session worktree
# (~/offline/<consumer>-wt/<slug>/) — claim-helper.ts walks `git rev-parse
# --git-common-dir` to find the canonical consumer root where claims live.

set -u
set +e

cwd=$(pwd -P 2>/dev/null) || exit 0
[[ -d "$cwd" ]] || exit 0

# Locate scripts/claim-helper.ts by walking up from cwd to the first dir
# containing it. This handles both consumer-root invocation and session
# worktree invocation (worktree shares git dir but not file tree).
find_helper() {
  local d="$1"
  while [[ "$d" != "/" && -n "$d" ]]; do
    if [[ -f "$d/scripts/claim-helper.ts" ]]; then
      echo "$d/scripts/claim-helper.ts"
      return 0
    fi
    d=$(dirname "$d")
  done
  return 1
}

# Try cwd first (main-worktree case), then git common dir parent (session
# worktree case: cwd != main, but common dir resolves to main).
helper=""
helper=$(find_helper "$cwd")
if [[ -z "$helper" ]]; then
  common_dir=$(git -C "$cwd" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
  if [[ -n "$common_dir" ]]; then
    main_root=$(dirname "$common_dir")
    helper=$(find_helper "$main_root")
  fi
fi

[[ -n "$helper" ]] || exit 0
command -v node >/dev/null 2>&1 || exit 0

node "$helper" refresh-by-cwd >/dev/null 2>&1
exit 0
