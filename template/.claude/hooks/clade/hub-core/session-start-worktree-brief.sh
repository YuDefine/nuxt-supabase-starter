#!/usr/bin/env bash
# session-start-worktree-brief.sh — surface WORKTREE-BRIEF.md in worktree sessions
#
# If cwd is inside a linked session worktree and WORKTREE-BRIEF.md exists at
# the worktree root, emit its content to stderr so the agent sees the task
# context immediately on session start. This enables seamless resume after
# session interruption.
#
# Exits 0 unconditionally (warn-only — must never block session start).

set -euo pipefail

HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$HOOK_DIR/_output-cap.sh" ]; then
  # shellcheck source=_output-cap.sh
  . "$HOOK_DIR/_output-cap.sh"
else
  cap_output() { cat; }
fi

# Detect linked worktree: git-dir contains /worktrees/
GIT_DIR="$(git rev-parse --git-dir 2>/dev/null || true)"
if [ -z "$GIT_DIR" ]; then exit 0; fi
case "$GIT_DIR" in
  */worktrees/*) ;;
  *) exit 0 ;;
esac

# Resolve worktree root (cwd may be in a subdirectory)
WT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$WT_ROOT" ]; then exit 0; fi

BRIEF="$WT_ROOT/WORKTREE-BRIEF.md"
if [ ! -f "$BRIEF" ]; then exit 0; fi

{
  echo "WORKTREE-BRIEF.md found — task context for this worktree:"
  echo "---"
  cat "$BRIEF"
  echo "---"
  echo "Read WORKTREE-BRIEF.md and continue from the next unchecked Progress item."
} | cap_output 60 6000 "cat $BRIEF" 1>&2

exit 0
