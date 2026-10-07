#!/usr/bin/env bash
# PreToolUse(Read) hook — 讀 main checkout 的進度檔（`tasks/**`、`specs/plans/**`）而同一個
# slug／work id 有 session worktree 時，遞一行 `READ <wt>/rules/讀進度前先查worktree判準.md`。
#
# 為什麼：main 上的 tasks.md 是 fork 當下的 snapshot；worktree 已經推進好幾個 phase 時只讀
# main 會判成「還沒開始」（原 worktree-default §9.7）。
#
# slug 候選（由路徑推，依序試，命中一個就停）：
#   specs/plans/<dir>/…   → <dir>、<dir> 去掉 `W-YYYY-MM-DD-` 前綴
#   tasks/<name>[/…]      → <name> 去副檔名、再去掉 `W-YYYY-MM-DD-` 或 `YYYY-MM-DD[-HHMM]-` 前綴
# 「這個 slug 有沒有 session worktree」只問 `wt-helper.ts resolve <slug> --json`——它自述是
# 全 fleet 唯一的 slug→worktree matcher（findSessionWorktreeForSlug），NEVER 在這裡另寫比對。
# 不用 `wt-helper.ts list --json`：它要掃 landed state，實測約 9 秒，放在 Read 前面不可接受；
# resolve 約 0.25 秒，且每次呼叫另有 `timeout` 上限。
#
# 成本契約：無事 = 零輸出、exit 0。前置過濾依序：路徑形狀 → main checkout → 規則檔存在
# → 有任何 linked worktree → 屬 fleet，五道都過才啟動 node。fail-open 全程。

set -uo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)" || exit 0
# shellcheck source=_skill-rule-reminder.sh
. "$HOOK_DIR/_skill-rule-reminder.sh" 2>/dev/null || exit 0

# 每次 resolve 的上限（秒）。hooks.json 的 timeout 要大於「候選數 × 本值」。
RESOLVE_TIMEOUT="${CLADE_PROGRESS_REMINDER_TIMEOUT:-2}"

INPUT=$(cat)
command -v jq >/dev/null 2>&1 || exit 0

FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // ""' 2>/dev/null) || exit 0
[ -n "$FILE_PATH" ] || exit 0
case "$FILE_PATH" in
  */tasks/* | */specs/plans/* | tasks/* | specs/plans/*) ;;
  *) exit 0 ;;
esac
case "$FILE_PATH" in
  /*) ;;
  *)
    BASE=$(printf '%s' "$INPUT" | jq -r '.cwd // ""' 2>/dev/null)
    FILE_PATH="${BASE:-$PWD}/$FILE_PATH"
    ;;
esac

# 讀目錄或尚不存在的路徑時往上走到第一個存在的祖先，只用來定位 checkout。
DIR="$FILE_PATH"
[ -d "$DIR" ] || DIR=$(dirname -- "$DIR")
while [ -n "$DIR" ] && [ "$DIR" != '/' ] && [ ! -d "$DIR" ]; do
  DIR=$(dirname -- "$DIR")
done
[ -d "$DIR" ] || exit 0

is_linked_worktree_dir "$DIR"
[ $? = 1 ] || exit 0

TOP=$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null) || exit 0
REL="${FILE_PATH#"$TOP"/}"
case "$REL" in
  /*)
    # 符號連結讓絕對路徑與 toplevel 對不上：改用 prefix 重組。
    PREFIX=$(git -C "$DIR" rev-parse --show-prefix 2>/dev/null) || exit 0
    if [ -d "$FILE_PATH" ]; then REL="$PREFIX"; else REL="${PREFIX}$(basename -- "$FILE_PATH")"; fi
    ;;
esac

SEG=""
case "$REL" in
  specs/plans/*) SEG="${REL#specs/plans/}" ;;
  tasks/*) SEG="${REL#tasks/}" ;;
  *) exit 0 ;;
esac
SEG="${SEG%%/*}"
[ -n "$SEG" ] || exit 0

RULE=$(skill_rule_path "$TOP" wt 'rules/讀進度前先查worktree判準.md')
[ -n "$RULE" ] || exit 0

# 沒有任何 linked worktree → 不可能有對應的樹，不啟動 node。
COMMON=$(git -C "$TOP" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || exit 0
[ -n "$(ls -A "$COMMON/worktrees" 2>/dev/null)" ] || exit 0

# helper NEVER 取自 $TOP 本身：被讀的檔可能在任何 repo 裡，從那裡找 wt-helper.ts 再 node 執行，
# 就是把「Read 一個檔」變成「執行那個 repo 自帶的程式碼」。只認 fleet（clade home／registry
# consumer）main checkout 裡的那一份——威脅模型與判法見 _skill-rule-reminder.sh 的
# trusted_fleet_helper。不在 fleet → 靜默（那種 repo 本來就沒有 wt 的 session worktree 慣例）。
HELPER=$(trusted_fleet_helper "$TOP" wt-helper.ts) || exit 0
command -v node >/dev/null 2>&1 || exit 0

NAME="${SEG%.*}"
[ -n "$NAME" ] || NAME="$SEG"
CANDIDATES=("$NAME")
if [[ "$NAME" =~ ^W-[0-9]{4}-[0-9]{2}-[0-9]{2}-(.+)$ ]]; then
  CANDIDATES+=("${BASH_REMATCH[1]}")
elif [[ "$NAME" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}(-[0-9]{4})?-(.+)$ ]]; then
  CANDIDATES+=("${BASH_REMATCH[2]}")
fi

# 沒有 `timeout` 就不問：逾時上限是這支 hook 的前提，不是選配。
command -v timeout >/dev/null 2>&1 || exit 0
for slug in "${CANDIDATES[@]}"; do
  # 0 = 找到；3 = 沒有對應 worktree（不是錯誤）；其餘（含逾時 124）一律當沒找到。
  if (cd "$TOP" && timeout "$RESOLVE_TIMEOUT" node "$HELPER" resolve "$slug" --json >/dev/null 2>&1); then
    emit_pretool_context "READ $RULE"
    exit 0
  fi
done
exit 0
