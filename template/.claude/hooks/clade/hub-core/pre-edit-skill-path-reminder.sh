#!/usr/bin/env bash
# PreToolUse(Edit|Write|MultiEdit) hook — 改到有 skill 承接的路徑（app/stores/**/*.ts、
# server/api/**/*.ts）那一刻，遞一行 `READ <skill>/SKILL.md`。
#
# 型別：提醒型（hook-authoring `rules/提醒注入型的送達去重與噪音.md`）。設計答案：
# - 送達通道：hookSpecificOutput.additionalContext（emit_pretool_context，TD-427）。
# - 觸發資料單一來源：_skill-rule-reminder.sh 的 skill_for_repo_path；本檔不寫路徑表。
#   路徑以目標檔所在 repo 的 toplevel 為基準比對；規則檔依 skill_rule_path 解析
#   （.claude/skills → .agents/skills → capabilities/core/skills），SKILL.md 存在才印——
#   consumer 沒裝該 skill（非 nuxt repo）就靜默。
# - 噪音預算：一次事件一行、< 400 bytes（test 釘住）。
# - 去重鍵：session_id（＋agent_id）＋skill；同一 agent 同一 skill 只提醒一次。payload 缺
#   session_id（舊 harness、手動測試）才退回 ppid-${PPID}。marker 在 ${TMPDIR:-/tmp}/clade-skill-path-reminder/。
# - subagent：收（內容是編輯這類檔的前置知識，不是主線流程責任），所以鍵含 agent_id。
# - 措辭：事實＋指標，不寫祈使句。
# - 效果指標：收到後同一 agent 在接下來的 tool call 內 Read 該 SKILL.md；
#   hook_followthrough.py --match 'READ .*/(pinia-store|server-api)/SKILL.md' 量（主線／subagent 分列）。
#
# 成本契約：無事 = 零輸出、exit 0。warn-only，NEVER 補 permissionDecision、NEVER exit 2。
# fail-open 全程：jq／git 缺、不在 git tree、找不到 SKILL.md、marker 寫不了 → 靜默或照印。

set -uo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)" || exit 0
# shellcheck source=_skill-rule-reminder.sh
. "$HOOK_DIR/_skill-rule-reminder.sh" 2>/dev/null || exit 0

INPUT=$(cat)
command -v jq >/dev/null 2>&1 || exit 0

FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // ""' 2>/dev/null) || exit 0
[ -n "$FILE_PATH" ] || exit 0
case "$FILE_PATH" in
  *.ts) ;;
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
TOP=$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null) || exit 0
TOP_REAL=$(cd -P -- "$TOP" 2>/dev/null && pwd -P) || exit 0
DIR_REAL=$(cd -P -- "$DIR" 2>/dev/null && pwd -P) || exit 0
# symlink（例如 /tmp → /private/tmp）會讓字串前綴對不上：以實體路徑算 repo 相對路徑。
SUFFIX="${FILE_PATH#"$DIR"}"
if [ "$DIR_REAL" = "$TOP_REAL" ]; then
  REL="${SUFFIX#/}"
else
  REL="${DIR_REAL#"$TOP_REAL"/}$SUFFIX"
fi

HIT=$(skill_for_repo_path "$REL")
[ -n "$HIT" ] || exit 0
SKILL="${HIT%%$'\t'*}"
FACT="${HIT#*$'\t'}"

ENTRY=$(skill_rule_path "$TOP" "$SKILL" SKILL.md)
[ -n "$ENTRY" ] || exit 0

SESSION=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
AGENT=$(printf '%s' "$INPUT" | jq -r '.agent_id // empty' 2>/dev/null)
KEY="${SESSION:-ppid-${PPID:-$$}}${AGENT:+-$AGENT}-$SKILL"
case "$KEY" in */* | *..*) KEY=$(printf '%s' "$KEY" | tr '/.' '__') ;; esac
STATE_DIR="${TMPDIR:-/tmp}/clade-skill-path-reminder"
MARKER="$STATE_DIR/$KEY.seen"
[ -f "$MARKER" ] && exit 0
mkdir -p "$STATE_DIR" 2>/dev/null && : >"$MARKER" 2>/dev/null

emit_pretool_context "⤷ ${FACT}。READ $ENTRY"
exit 0
