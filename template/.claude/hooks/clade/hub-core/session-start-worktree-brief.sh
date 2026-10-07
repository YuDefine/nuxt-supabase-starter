#!/usr/bin/env bash
# session-start-worktree-brief.sh — surface WORKTREE-BRIEF.md in worktree sessions
#
# If cwd is inside a linked session worktree and WORKTREE-BRIEF.md exists at
# the worktree root, emit its content to stdout so the agent sees the task
# context immediately on session start. This enables seamless resume after
# session interruption.
#
# 通道是 stdout：SessionStart exit 0 時只有 stdout（或 additionalContext）會注入 agent 的
# context，stderr 不會（Claude Code hooks reference「For … SessionStart … Claude Code adds
# stdout … to Claude's context」）。本檔原本寫 stderr，brief 從未送達 agent（2026-10-03 查證）。
#
# 同時遞一行 `READ <wt skill>/rules/worker契約.md`（wt 的 worker 合約正本；路徑依
# _skill-rule-reminder.sh 的 skill_rule_path 解析，找不到規則檔就不印）。這行放在區塊
# **第一行**：cap_output 保頭砍尾，brief 再長也不會把它折掉。
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
if [ -f "$HOOK_DIR/_skill-rule-reminder.sh" ]; then
  # shellcheck source=_skill-rule-reminder.sh
  . "$HOOK_DIR/_skill-rule-reminder.sh"
else
  skill_rule_path() { :; }
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

WORKER_RULE="$(skill_rule_path "$WT_ROOT" wt 'rules/worker契約.md')"

{
  if [ -n "$WORKER_RULE" ]; then echo "READ $WORKER_RULE"; fi
  echo "WORKTREE-BRIEF.md found — task context for this worktree:"
  echo "---"
  cat "$BRIEF"
  echo "---"
  echo "Read WORKTREE-BRIEF.md and continue from the next unchecked Progress item."
} | cap_output 60 6000 "cat $BRIEF"

exit 0
