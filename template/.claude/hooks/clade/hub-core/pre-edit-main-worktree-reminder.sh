#!/usr/bin/env bash
# PreToolUse(Edit|Write|MultiEdit|NotebookEdit) hook — 要在 main checkout 改 tracked 檔的那一刻，
# 遞一行 `READ <wt skill>/rules/改tracked檔前先隔離判準.md`。
#
# 規則正本：wt skill 的 rules/改tracked檔前先隔離判準.md（原 worktree-default §1／§2）。
# `wt` 本身不判斷「要不要開 worktree」，所以這份規則沒有 SOP 觸發點；跨 session 的唯一
# 觸發就是本 hook。
#
# 命中條件（全部成立才出聲）：
#   1. 目標檔所在的 checkout 是 main checkout（git-dir 不含 /worktrees/）。判的是**目標檔**
#      的樹而不是 session cwd：cwd 在 worktree 卻改 main 的檔，正是這條規則要攔的形狀；
#      cwd 在 main 卻改 worktree 裡的檔，則沒有違規。
#   2. 目標檔是 tracked（新檔不在 index 裡，不算「改 tracked 檔」）。
#   3. 路徑不在「可直接 commit 到 main」的白名單。判準 MUST 與
#      pre-bash-git-commit-only-whitelist.sh 同一份——由 _skill-rule-reminder.sh 的
#      main_commit_allowlisted 直接拿那支 gate 當 oracle，NEVER 在這裡另列清單。
#   4. 找得到規則檔（.claude/skills → .agents/skills → capabilities/core/skills）。
#
# 成本契約：無事 = 零輸出、exit 0。warn-only，NEVER 補 permissionDecision、NEVER exit 2。
# fail-open 全程：jq／git 缺、不在 git tree、白名單判不出來 → 靜默 exit 0。

set -uo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)" || exit 0
# shellcheck source=_skill-rule-reminder.sh
. "$HOOK_DIR/_skill-rule-reminder.sh" 2>/dev/null || exit 0

INPUT=$(cat)
command -v jq >/dev/null 2>&1 || exit 0

FILE_PATH=$(printf '%s' "$INPUT" |
  jq -r '.tool_input.file_path // .tool_input.notebook_path // ""' 2>/dev/null) || exit 0
[ -n "$FILE_PATH" ] || exit 0
case "$FILE_PATH" in
  /*) ;;
  *)
    BASE=$(printf '%s' "$INPUT" | jq -r '.cwd // ""' 2>/dev/null)
    FILE_PATH="${BASE:-$PWD}/$FILE_PATH"
    ;;
esac
# 不存在的檔不可能是 tracked。
[ -f "$FILE_PATH" ] || exit 0

DIR=$(dirname -- "$FILE_PATH")
NAME=$(basename -- "$FILE_PATH")
is_linked_worktree_dir "$DIR"
[ $? = 1 ] || exit 0

git -C "$DIR" ls-files --error-unmatch -- "$NAME" >/dev/null 2>&1 || exit 0

TOP=$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null) || exit 0
PREFIX=$(git -C "$DIR" rev-parse --show-prefix 2>/dev/null) || exit 0
REL="${PREFIX}${NAME}"

RULE=$(skill_rule_path "$TOP" wt 'rules/改tracked檔前先隔離判準.md')
[ -n "$RULE" ] || exit 0

main_commit_allowlisted "$TOP" "$REL"
[ $? = 1 ] || exit 0

emit_pretool_context "READ $RULE"
exit 0
