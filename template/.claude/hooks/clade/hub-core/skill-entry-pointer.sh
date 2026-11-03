#!/usr/bin/env bash
# skill-entry-pointer.sh — 把 agent 帶到 skill 入口的一行指標（W-2026-10-19-rule-skill-trigger-vue-skills Scope 3）。
#
#   PreToolUse(Read|Edit|Write|MultiEdit)：首次碰到某 family 管轄路徑 → `READ <family>/SKILL.md`。
#   PostToolUse(Read|Bash)：輸出含「依 `/skill-engineering` … 產出」標記 → `READ <skill-engineering>/SKILL.md`。
#
# 型別：提醒型
# 重複證據：6 個 Vue consumer 19 份改 .vue 的 transcript，vue-best-practices 0 次、clade-frontend 3 次
#   （evidence/2026-10-20-baseline-measurement.md）；子代理沒有 Skill tool、不讀 SKILL.md（2026-10-20-a3-subagent-eval.md）；
#   2026-10-25 主線以 Bash cat 讀根因閘門報告、未載入 skill 就提方案（plan.md T4）。
# 設計答案（hook-authoring `rules/提醒注入型的送達去重與噪音.md`）：
# - 送達通道：兩個事件都走 hookSpecificOutput.additionalContext，實測紀錄在
#   evidence/2026-10-31-t4-nonce-delivery.md。NEVER 補 permissionDecision、NEVER exit 2。
# - 觸發資料單一來源：skill-entry-match.ts（本檔不寫路徑表與標記字串比對，快篩字串除外）；SKILL.md 存在才印（skill_rule_path）。
# - 噪音預算：一次事件一行、< 400 bytes，放不下的 family 留到下一次；每 agent 每 session family 行數 ≤ 8（test 釘住）。
# - 去重鍵：session_id（＋agent_id）＋入口名。payload 沒有 session_id 時退回當日鍵。NEVER 用 PPID。
# - subagent：收（子代理沒有 Skill tool，靠路徑直接 Read 入口；是動作的前置知識，不是主線流程責任），所以鍵含 agent_id。
# - 措辭：事實＋指標，不寫祈使句。
# - 效果指標：收到後同一 agent 在接下來的 tool call 內 Read 該 SKILL.md；
#   hook_followthrough.py --match 'READ .*/SKILL\.md' 量（主線／subagent 分列）。
# - 信任邊界：只對 fleet repo 印（fleet_repo_root）。clone 下來的陌生 repo 可以自帶 clade-* 目錄與標記字串，
#   hook NEVER 把它們的檔案遞成規約入口；找不到 clade home（cloud VM）判不出成員身分，同樣靜默。
#   成員身分只看 git-common-dir，偽造的 `.git` gitfile 能指到 fleet repo，所以另要求目錄是該 repo 登記的 worktree（trusted_top）。
# - 指標路徑：cwd 正好是 repo 根 → repo 相對；否則絕對路徑（entry_ref），相對路徑會解析到 cwd。
# - 標記沒有驗證機制，任何內容都能自稱，所以措辭是「標示為」，不斷言來源；指標只指向本 repo 已裝的 skill。
# - 第三方 family 的路徑在 clade home 的 registry/skill-sources.json。
# - 狀態住使用者私有的 cache（umask 077），不放共用 /tmp；超過 7 天的 session 目錄順手清掉。
#
# fail-open：jq／node／helper 缺、判不出來 → 靜默 exit 0。

set -uo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)" || exit 0
# shellcheck source=_skill-rule-reminder.sh
. "$HOOK_DIR/_skill-rule-reminder.sh" 2>/dev/null || exit 0

MAX_BYTES=399
MAX_FAMILY_LINES=8

INPUT=$(cat)
command -v jq >/dev/null 2>&1 || exit 0
command -v node >/dev/null 2>&1 || exit 0
MATCH="$HOOK_DIR/skill-entry-match.ts"
[ -f "$MATCH" ] || exit 0

EVENT=$(printf '%s' "$INPUT" | jq -r '.hook_event_name // "PreToolUse"' 2>/dev/null) || exit 0
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // ""' 2>/dev/null)
[ -n "$CWD" ] || CWD="$PWD"

SESSION=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
AGENT=$(printf '%s' "$INPUT" | jq -r '.agent_id // empty' 2>/dev/null)
KEY="${SESSION:-no-session-$(date +%Y%m%d)}${AGENT:+-$AGENT}"
KEY=$(printf '%s' "$KEY" | tr -c 'A-Za-z0-9_-' '_')
STATE_ROOT="${XDG_CACHE_HOME:-${HOME:-/nonexistent}/.cache}/clade/skill-entry-pointer"
STATE_DIR="$STATE_ROOT/$KEY"

seen() { [ -f "$STATE_DIR/$1.seen" ]; }
mark() {
  if [ ! -d "$STATE_DIR" ]; then
    find "$STATE_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime +7 -exec rm -rf {} + 2>/dev/null
    (umask 077 && mkdir -p "$STATE_DIR") 2>/dev/null
  fi
  : >"$STATE_DIR/$1.seen" 2>/dev/null
}

trusted_top() {
  fleet_repo_root "$1" >/dev/null || return 1
  local real
  real=$(cd -P -- "$1" 2>/dev/null && pwd -P) || return 1
  # 換行會讓 grep 拆成多個 pattern，空 pattern 配 -x 又吃 porcelain 的空行分隔。
  case "$real" in *$'\n'*) return 1 ;; esac
  git -C "$1" worktree list --porcelain 2>/dev/null | grep -qxF -e "worktree $real"
}

# entry_ref <top> <entry> —— cwd 正好是 repo 根才印相對路徑，其餘絕對。
entry_ref() {
  local real cwd_real
  real=$(cd -P -- "$1" 2>/dev/null && pwd -P) || return 1
  cwd_real=$(cd -P -- "$CWD" 2>/dev/null && pwd -P)
  if [ "$cwd_real" = "$real" ]; then
    printf '%s\n' "$2"
  else
    printf '%s/%s\n' "$real" "$2"
  fi
}

emit() {
  jq -cn --arg event "$EVENT" --arg ctx "$1" '{hookSpecificOutput: {hookEventName: $event, additionalContext: $ctx}}'
}

if [ "$EVENT" = "PostToolUse" ]; then
  # 快篩：絕大多數輸出不含這個字，不付 node 啟動成本
  case "$INPUT" in
    *skill-engineering*) ;;
    *) exit 0 ;;
  esac
  OUTPUT=$(printf '%s' "$INPUT" | jq -r '.tool_response | if type == "object" then (.file.content // .stdout // "") else tostring end' 2>/dev/null) || exit 0
  MARKERS=$(printf '%s' "$OUTPUT" | node "$MATCH" --content --json 2>/dev/null | jq -r '.markers[]?' 2>/dev/null) || exit 0
  TOP=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null) || exit 0
  trusted_top "$TOP" || exit 0
  while IFS= read -r SKILL; do
    [ -n "$SKILL" ] || continue
    seen "marker-$SKILL" && continue
    ENTRY=$(skill_rule_path "$TOP" "$SKILL" SKILL.md)
    [ -n "$ENTRY" ] || continue
    mark "marker-$SKILL"
    emit "⤷ 這份內容標示為 /${SKILL} 的產出，提案與閘門答覆接在該 skill 的 Phase 上。READ $(entry_ref "$TOP" "$ENTRY")"
    exit 0
  done <<<"$MARKERS"
  exit 0
fi

FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // ""' 2>/dev/null) || exit 0
[ -n "$FILE_PATH" ] || exit 0

[ "$(find "$STATE_DIR" -maxdepth 1 -name 'line-*' 2>/dev/null | wc -l)" -lt "$MAX_FAMILY_LINES" ] || exit 0

REGISTRY_ARGS=()
if HOME_ROOT=$(clade_home_root 2>/dev/null) && [ -f "$HOME_ROOT/registry/skill-sources.json" ]; then
  REGISTRY_ARGS=(--registry "$HOME_ROOT/registry/skill-sources.json")
fi
RESULT=$(node "$MATCH" --file "$FILE_PATH" --cwd "$CWD" "${REGISTRY_ARGS[@]}" --json 2>/dev/null) || exit 0
TOP=$(printf '%s' "$RESULT" | jq -r '.repo // empty' 2>/dev/null)
[ -n "$TOP" ] || exit 0
trusted_top "$TOP" || exit 0

PREFIX='⤷ 這個路徑有對應的規約入口，入口列出各 rule 的適用條件。'
LINE="$PREFIX"
ADDED=()
while IFS= read -r FAMILY; do
  [ -n "$FAMILY" ] || continue
  seen "family-$FAMILY" && continue
  ENTRY=$(skill_rule_path "$TOP" "$FAMILY" SKILL.md)
  [ -n "$ENTRY" ] || continue
  CANDIDATE="${LINE}READ $(entry_ref "$TOP" "$ENTRY") "
  [ "$(printf '%s' "$CANDIDATE" | wc -c)" -le "$MAX_BYTES" ] || continue
  LINE="$CANDIDATE"
  ADDED+=("$FAMILY")
done < <(printf '%s' "$RESULT" | jq -r '.families[]?' 2>/dev/null)
[ "${#ADDED[@]}" -gt 0 ] || exit 0

for FAMILY in "${ADDED[@]}"; do mark "family-$FAMILY"; done
mark "line-$(find "$STATE_DIR" -maxdepth 1 -name 'line-*' 2>/dev/null | wc -l)"
emit "${LINE% }"
exit 0
