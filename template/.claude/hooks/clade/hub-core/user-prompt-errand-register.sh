#!/usr/bin/env bash
# UserPromptSubmit hook — Charles 在自開的 Herdr pane 交代第一件事時，把這個 session 登記進委託帳
# （`/track` 的登記檔，origin=auto）。之後 watch 收掉、停放、換棒都跟著這筆走，結論落接續檔；
# Charles 用 `/track` 或 `/fleet` 的「我交代的事」查，不必掛著 pane、也不必自己找 pane。
#
# 型別：注入型的旁支——零輸出的登記副作用（不擋、不注入任何字）；依 hook-authoring
# `rules/提醒注入型的送達去重與噪音.md` 審：
#   - 證據（hook-authoring Rule 1）：Charles 2026-10-24 明示要求（臨時交代的事被主持收走後不知道進度與結論、
#     只能掛著 pane 撐過 TTL、還得自己找 pane），且 `/track` 手動標記 6 筆中沒有一筆標在自開 pane 下的臨時任務
#     ——手動那一步本身就是漏的原因。
#   - predicate 機械可判：HERDR_PANE_ID 有值（在 Herdr pane）、CLADE_DISPATCH_ID 與 CLADE_FLOW_PARENT_SPAN 空
#     （不是 helper 派出或接班的；那些照現有派工追蹤）、WORK_LOOP_RUNNER_CHILD 空、CLAUDE_CODE_REMOTE 空、payload 無 agent_id、
#     本 session 還沒有 marker。管理指令（/coordinator、/track…）與主持者自己的 pane 由 CLI `auto` 判
#     （單一來源：`vendor/scripts/tracked-session.ts` 的 NOT_AN_ERRAND 與主持登記），不在本檔另寫一份。
#   - 送達：無（零輸出）。效果指標：登記檔出現 origin=auto 的列（`tracked-session.ts list --all`）。
#   - 去重：payload 的 session_id 一個 marker（`~/.cache/clade/errand-register/<session>.done`），
#     由 CLI 在登記成功或判定永不登記（主持者）後寫；管理指令不寫 marker，下一則才是真的任務。
#     同一 session 重複呼叫在登記檔端也是冪等的（markTracked 以 session 合併、auto 不覆寫既有列）。
#   - subagent：不登記（agent_id 非空即退出）——委託是 Charles 對主線交代的事，subagent 不是委託對象。
#   - 噪音：零輸出；CLI 在背景跑（非權威機要 ssh 轉送），hook 本身只做 env 與 marker 判斷就返回。
# 失敗處置：jq／node／script 缺、payload 解析不了、CLI 失敗 → 靜默 exit 0（fail-open；漏登記的代價是
# Charles 還能手動 `/track`，擋住 prompt 的代價高得多）。散播：hub-core 全 fleet——Charles 在任何 repo 的
# 自開 pane 都會交代事情；script 在 clade home（不投影），不在就靜默。
#
# 可覆寫（測試用）：CLADE_ERRAND_SCRIPT（預設 ~/offline/clade/vendor/scripts/tracked-session.ts）、
#   CLADE_ERRAND_MARKER_DIR（預設 ${XDG_CACHE_HOME:-~/.cache}/clade/errand-register）、
#   CLADE_ERRAND_SYNC=1（前景跑 CLI，測試等結果用）。

set -uo pipefail

INPUT=$(cat)
case "${CLAUDE_CODE_REMOTE:-}" in '' | 0 | false) ;; *) exit 0 ;; esac
[ -n "${HERDR_PANE_ID:-}" ] || exit 0
[ -z "${CLADE_DISPATCH_ID:-}" ] || exit 0
# helper 開的 pane（派工、/handoff relay、--successor 繼任）都帶 CLADE_FLOW_PARENT_SPAN；relay 繼任刻意不帶
# CLADE_DISPATCH_ID，只看上一行會把每份交棒 brief 登記成一筆新委託
[ -z "${CLADE_FLOW_PARENT_SPAN:-}" ] || exit 0
[ -z "${WORK_LOOP_RUNNER_CHILD:-}" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0
command -v node >/dev/null 2>&1 || exit 0

AGENT=$(printf '%s' "$INPUT" | jq -r '.agent_id // empty' 2>/dev/null) || exit 0
[ -z "$AGENT" ] || exit 0
SESSION=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null) || exit 0
[[ "$SESSION" =~ ^[A-Za-z0-9._-]+$ ]] || exit 0

MARKER_DIR=${CLADE_ERRAND_MARKER_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/clade/errand-register}
MARKER="$MARKER_DIR/$SESSION.done"
[ -e "$MARKER" ] && exit 0

SCRIPT=${CLADE_ERRAND_SCRIPT:-$HOME/offline/clade/vendor/scripts/tracked-session.ts}
[ -f "$SCRIPT" ] || exit 0

# 標題：prompt 第一個非空行（CLI 再截 40 字）
TITLE=$(printf '%s' "$INPUT" | jq -r '(.prompt // "") | split("\n") | map(select(test("\\S"))) | .[0] // "" | .[0:200]' 2>/dev/null) || exit 0
[ -n "$TITLE" ] || exit 0
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)

ARGS=(auto "--title=$TITLE" --session "$SESSION" --marker "$MARKER")
[ -n "$CWD" ] && ARGS+=(--cwd "$CWD")

if [ "${CLADE_ERRAND_SYNC:-}" = 1 ]; then
  timeout 30 node "$SCRIPT" "${ARGS[@]}" >/dev/null 2>&1
else
  (setsid timeout 30 node "$SCRIPT" "${ARGS[@]}" >/dev/null 2>&1 &) >/dev/null 2>&1
fi
exit 0
