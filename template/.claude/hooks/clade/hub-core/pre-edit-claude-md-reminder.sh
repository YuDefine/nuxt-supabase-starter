#!/usr/bin/env bash
# PreToolUse(Edit|Write|MultiEdit) hook — 要改任何 CLAUDE.md／AGENTS.md 的那一刻，
# 遞一行 `READ <bp skill>/rules/落點路由判準.md`（Rule 8：想寫進 CLAUDE.md／AGENTS.md 的反模式列）。
#
# 規則正本：bp skill 的 rules/落點路由判準.md。CLAUDE.md／AGENTS.md 是 always-load 的常駐檔，
# 內容多半該落 skill／rule／cookbook，不該長在這；編輯當下沒有 SOP 觸發點，跨 session 的唯一
# 觸發就是本 hook。
#
# 命中條件：目標檔 basename 恰為 `CLAUDE.md` 或 `AGENTS.md`（任何目錄、檔案可以尚不存在）。
# 規則檔依 skill_rule_path 解析（.claude/skills → .agents/skills → capabilities/core/skills），
# 先以目標檔所在 repo 為準；目標不在 git tree（例如 ~/.claude/CLAUDE.md）或該 repo 沒有規則檔，
# 改用 session cwd 所在 repo。
#
# 成本契約：無事 = 零輸出、exit 0。warn-only，NEVER 補 permissionDecision、NEVER exit 2。
# fail-open 全程：jq／git 缺、找不到規則檔 → 靜默 exit 0。

set -uo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)" || exit 0
# shellcheck source=_skill-rule-reminder.sh
. "$HOOK_DIR/_skill-rule-reminder.sh" 2>/dev/null || exit 0

INPUT=$(cat)
command -v jq >/dev/null 2>&1 || exit 0

FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // ""' 2>/dev/null) || exit 0
[ -n "$FILE_PATH" ] || exit 0
case "$(basename -- "$FILE_PATH")" in
  CLAUDE.md | AGENTS.md) ;;
  *) exit 0 ;;
esac

CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // ""' 2>/dev/null)
case "$FILE_PATH" in
  /*) ;;
  *) FILE_PATH="${CWD:-$PWD}/$FILE_PATH" ;;
esac

# 目標目錄可能尚不存在（Write 新檔）：往上找第一個存在的祖先。
DIR=$(dirname -- "$FILE_PATH")
while [ ! -d "$DIR" ] && [ "$DIR" != "/" ]; do DIR=$(dirname -- "$DIR"); done

RULE=""
for D in "$DIR" "${CWD:-$PWD}"; do
  TOP=$(git -C "$D" rev-parse --show-toplevel 2>/dev/null) || continue
  RULE=$(skill_rule_path "$TOP" bp 'rules/落點路由判準.md')
  [ -n "$RULE" ] && break
done
[ -n "$RULE" ] || exit 0

emit_pretool_context "READ $RULE"
exit 0
