#!/usr/bin/env bash
# PostToolUse hook: Edit|Write → a new `tasks/<date>-<slug>.md` must have a named work item.
#
# WHY THIS EXISTS. `rules/core/session-tasks.operations.md` § 建檔的同一步順路鑄 work id already
# says MUST, and says it precisely (`flow open <slug> --origin tasks:<path> --title '<一句話>'`).
# It was not being followed: measured 2026-08-29 across 12 consumer repos, 350 work items carried
# 0 titles and 0 origins. A MUST with no mechanical backstop is a MUST that fires only when
# somebody happens to have read it — and the moment it must fire (creating the file) is exactly
# the moment nobody is reading rules.
#
# So this is a BACKSTOP, not new policy: it prints the command the rule already specifies, filled
# in with this file's own path and slug, at the instant the file appears.
#
# warn-only, and MUST stay warn-only. Blocking a task-file write to collect telemetry inverts the
# priority the whole spine is built on — the work outranks the record of the work (emit's contract
# is fail-open everywhere for the same reason). A blocked write would also arrive as an error on
# the one action a session takes when it is trying to be disciplined.
#
# It does NOT mint anything itself. Minting needs a `--title` that says what the work is, and only
# the agent that just wrote the file knows that; a hook-generated title would be the slug again,
# which is the exact failure being fixed (a name that names nothing).

set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_response.filePath // ""' 2>/dev/null || echo "")

[ -z "$FILE_PATH" ] && exit 0

# `tasks/<something>.md`, excluding the two single-file exceptions the rule names.
case "$FILE_PATH" in
  */tasks/*.md | tasks/*.md) ;;
  *) exit 0 ;;
esac
case "$FILE_PATH" in
  */tasks/archive/* | tasks/archive/* | */tasks/lessons.md | tasks/lessons.md) exit 0 ;;
esac

BASE=$(basename "$FILE_PATH" .md)
REL="${FILE_PATH#"$(pwd)/"}"

# Already named? Two independent signals, either one is enough:
#   1. the file itself declares a work_id (the optional index the rule allows), or
#   2. the spine already carries a work.open whose origin_ref points at this path.
# NEVER tighten this to require both — the header field is deliberately optional, and demanding it
# would turn an index into a gate the rule explicitly says it is not.
if grep -qE '^work_id:[[:space:]]*W-' "$FILE_PATH" 2>/dev/null; then
  exit 0
fi

SPINE="${CLADE_FLOW_EVENTS:-$(pwd)/.clade/flow/events.jsonl}"
if [ -f "$SPINE" ] && grep -qF "\"origin_ref\":\"tasks:$REL\"" "$SPINE" 2>/dev/null; then
  exit 0
fi

# Ambient id means this session already opened its work; the file joins that work rather than
# starting a new one. NEVER prompt here — a second `flow open` would split one piece of work in two.
[ -n "${CLADE_WORK_ID:-}" ] && exit 0

cat <<MSG
[work-open] $REL 還沒有具名的 work item —— 它會在 /board 上顯示為 orphan、在 /overview 上完全不出現。

  node "\${CLADE_HOME:-\$HOME/offline/clade}"/vendor/scripts/flow/flow.ts open $BASE \\
    --actor claude-code --origin 'tasks:$REL' --title '<一句話：這件事是什麼>'

--title 要寫「要解決什麼問題」，NEVER 把 slug 重寫一遍——一個只是把檔名再說一次的 title，
對讀的人與沒有 title 完全等價。跑完把印出的 export CLADE_WORK_ID=… 帶進本 session。
鑄名 fail-open：這條指令失敗 NEVER 擋你繼續做事。
MSG
exit 0
