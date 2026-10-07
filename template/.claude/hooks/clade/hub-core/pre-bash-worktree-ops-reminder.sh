#!/usr/bin/env bash
# PreToolUse(Bash) hook — 送出 worktree 操作指令的那一刻，遞一行該讀的 wt RuleFile。
#
#   `wt-helper.ts add`                                   → READ <wt>/rules/fork前baseline判準.md
#   `wt-helper.ts cleanup|prune|merge-back|reclaim-stale`、
#   `stash-reconcile`、`git stash`                        → READ <wt>/rules/worktree保留與回收判準.md
#
# 兩組都命中（例：`git stash && node …/wt-helper.ts add x`）就各印一行。其餘指令零輸出。
#
# 這是提醒，不是 gate：比對只看字面子字串（先去掉引號與反斜線，`"wt-helper.ts" add` 一樣
# 命中），不解析 shell。誤報的代價是一行 READ；漏報由 wt SOP 的具名讀取兜底。
# 規則路徑依 _skill-rule-reminder.sh 的 skill_rule_path 解析，以 session cwd 所在的 repo 為準。
#
# 成本契約：無事 = 零輸出、exit 0。warn-only，NEVER 補 permissionDecision、NEVER exit 2。

set -uo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)" || exit 0
# shellcheck source=_skill-rule-reminder.sh
. "$HOOK_DIR/_skill-rule-reminder.sh" 2>/dev/null || exit 0

INPUT=$(cat)
command -v jq >/dev/null 2>&1 || exit 0

CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // ""' 2>/dev/null) || exit 0
[ -n "$CMD" ] || exit 0
TEXT=$(printf '%s' "$CMD" | tr -d "'\"\\\\")

# 便宜的前置過濾：兩組關鍵字都不在就不碰 git。
case "$TEXT" in
  *wt-helper.ts* | *stash*) ;;
  *) exit 0 ;;
esac

FORK=0
RETAIN=0
# Here-string，不用 `printf | grep -q`：pipefail 下提早結束的 reader 會把 SIGPIPE 變成 141。
grep -qE 'wt-helper\.ts[[:space:]]+add([[:space:]]|$)' <<<"$TEXT" && FORK=1
grep -qE 'wt-helper\.ts[[:space:]]+(cleanup|prune|merge-back|reclaim-stale)([[:space:]]|$)|stash-reconcile|(^|[^[:alnum:]_.-])git([[:space:]]+-[Cc][[:space:]]+[^[:space:]]+)*[[:space:]]+stash([[:space:]]|$)' \
  <<<"$TEXT" && RETAIN=1
[ "$FORK" = 1 ] || [ "$RETAIN" = 1 ] || exit 0

CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // ""' 2>/dev/null)
TOP=$(git -C "${CWD:-$PWD}" rev-parse --show-toplevel 2>/dev/null) || exit 0

LINES=""
if [ "$FORK" = 1 ]; then
  RULE=$(skill_rule_path "$TOP" wt 'rules/fork前baseline判準.md')
  [ -n "$RULE" ] && LINES="READ $RULE"
fi
if [ "$RETAIN" = 1 ]; then
  RULE=$(skill_rule_path "$TOP" wt 'rules/worktree保留與回收判準.md')
  [ -n "$RULE" ] && LINES="${LINES:+$LINES
}READ $RULE"
fi

emit_pretool_context "$LINES"
exit 0
