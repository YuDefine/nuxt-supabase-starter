#!/usr/bin/env bash
# PostToolUse hook: Edit|Write → a new `tasks/<date>-<slug>.md` (clade home: `specs/sessions/<date>-<slug>.md`)
# must have a named work item.
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
#
# SECOND HALF — checkpoint pointer. A task file is this machine's draft: when the session dies, the
# progress in it is invisible from every other machine. When the session already has a work id and
# that work has no `work.checkpoint` on the spine in the last 15 minutes, print ONE line pointing at
# `flow work checkpoint` (session-tasks.md § 真相層與回報 already says MUST).
#   type: reminder, warn-only, fail-open (any read failure → silent exit 0)
#   channel: PostToolUse stdout (same as the work-open half)
#   dedupe: payload session_id; marker valid 15 minutes, so at most one line per session per
#           15 minutes even when the checkpoint is never sent
#   subagent: does NOT receive it — recording progress is the main line's responsibility
#   noise budget: one line, < 400 bytes (pinned by test/task-file-checkpoint-pointer.test.ts)
#   trigger data: the spine itself (the latest work.checkpoint for $CLADE_WORK_ID)

set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_response.filePath // ""' 2>/dev/null || echo "")

[ -z "$FILE_PATH" ] && exit 0

# `tasks/<something>.md`, excluding the two single-file exceptions the rule names.
# (`tasks/archive/` only exists in consumers not yet migrated to the plan/truth lifecycle.)
# clade home's session lists live in `specs/sessions/` (its `tasks/` is retired; see _session-task-dir.sh).
case "$FILE_PATH" in
  */tasks/*.md | tasks/*.md | */specs/sessions/*.md | specs/sessions/*.md) ;;
  *) exit 0 ;;
esac
case "$FILE_PATH" in
  */tasks/archive/* | tasks/archive/* | */tasks/lessons.md | tasks/lessons.md) exit 0 ;;
esac

checkpoint_pointer() {
  local agent session key state marker spine last now last_s common
  agent=$(printf '%s' "$INPUT" | jq -r '.agent_id // empty' 2>/dev/null || true)
  [ -n "$agent" ] && return 0
  session=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || true)
  key="${session:-ppid-${PPID:-$$}}"
  state="${XDG_CACHE_HOME:-$HOME/.cache}/clade/task-checkpoint-pointer"
  marker="$state/$key.seen"
  now=$(date +%s)
  if [ -f "$marker" ] && [ $((now - $(stat -c %Y "$marker" 2>/dev/null || echo 0))) -lt 900 ]; then
    return 0
  fi
  # A worktree's events land on the main checkout's spine: the parent of the git common dir.
  if [ -n "${CLADE_FLOW_EVENTS:-}" ]; then
    spine="$CLADE_FLOW_EVENTS"
  else
    common=$(git -C "$(dirname "$FILE_PATH")" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)
    [ -z "$common" ] && return 0
    spine="$(dirname "$common")/.clade/flow/events.jsonl"
  fi
  [ -f "$spine" ] || return 0
  last=$(grep -F '"kind":"work.checkpoint"' "$spine" 2>/dev/null | grep -F "\"work_id\":\"$CLADE_WORK_ID\"" | tail -n 1 |
    jq -r '.ts_utc // empty' 2>/dev/null || true)
  if [ -n "$last" ]; then
    last_s=$(date -d "$last" +%s 2>/dev/null || echo 0)
    [ $((now - last_s)) -lt 900 ] && return 0
  fi
  mkdir -p "$state" 2>/dev/null && touch "$marker" 2>/dev/null || true
  echo "⤷ tasks 檔只存在本機；$CLADE_WORK_ID 15 分鐘內沒有 work checkpoint，別台機器看不到這次進度。flow work checkpoint --step '<做到哪>' [--blocked-on <ref>]；READ .claude/rules/session-tasks.md"
}

# Ambient id means this session already opened its work; the file joins that work rather than
# starting a new one. NEVER prompt for `flow open` here — a second open would split one piece of
# work in two. The only thing left to say is the checkpoint pointer (second half, see header).
if [ -n "${CLADE_WORK_ID:-}" ]; then
  checkpoint_pointer || true
  exit 0
fi

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

cat <<MSG
[work-open] $REL 還沒有具名的 work item —— 它會在 /board 上顯示為 orphan、在 /overview 上完全不出現。

  node "\${CLADE_HOME:-\$HOME/offline/clade}"/vendor/scripts/flow/flow.ts open $BASE \\
    --actor claude-code --origin 'tasks:$REL' --title '<一句話：這件事是什麼>'

--title 要寫「要解決什麼問題」，NEVER 把 slug 重寫一遍——一個只是把檔名再說一次的 title，
對讀的人與沒有 title 完全等價。跑完把印出的 export CLADE_WORK_ID=… 帶進本 session。
鑄名 fail-open：這條指令失敗 NEVER 擋你繼續做事。
MSG
exit 0
