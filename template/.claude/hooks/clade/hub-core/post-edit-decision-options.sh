#!/usr/bin/env bash
# clade — 待拍板條目載體（HANDOFF.md／docs/tech-debt.md／work-loop state）的兩個時間點：
#
#   無引數（PostToolUse Edit|Write）：寫完一條待拍板條目的當下，就地判「這題是 ruling 但沒有選項」。
#   `pre-edit`（PreToolUse Edit|Write）：動筆之前，每個 session 第一次遞一行
#       `READ <my skill>/rules/待拍板條目寫法.md`（條目該長什麼形狀的正本）。
#
# 兩個模式放在同一支，是因為「哪些檔是待拍板載體」只能有一份判準：`decision_carrier_kind`。
# 拆成兩支 hook 就是兩份 case，遲早一支認得 state.json、另一支不認得。
#
# 為什麼 lint 是 PostToolUse 而不是靠既有的兩道：`flow sources` 的 lint 與 ingest 端的
# `ask-options` 退回都是對的，也都太晚——到那時題目已經在 Charles 手機上長成一個空白
# 輸入框，退回變成佇列上的另一張卡，而唯一五秒鐘就能修好的人（選項還在它 context 裡的
# 那個 agent）已經走了。2026-08-29 實測：一次這樣的退回在佇列上停了 3.2 小時。
#
# 判準與措辭都不在這裡：SoT 是 vendor/scripts/flow/decision-lint.ts，它呼叫的是
# decision-sources.ts 的同一組 scanner 與 decisions.ts 的 OPTIONS_REQUEST_TEXT。
# NEVER 在這支腳本裡自己解析 markdown —— 第二份 matcher 遲早與佇列給出不同答案，
# 而不一致的那一次會教讀者「這個提示是雜訊」。lint 只跑 decision-lint 有 scanner 的
# HANDOFF.md 與 docs/tech-debt.md；work-loop state 只進 `pre-edit` 提醒。
#
# 提醒的去重：marker 在 `${TMPDIR:-/tmp}/clade-decision-authoring-read/<session_id>.seen`
# （與 pre-read-image-cost-warn.sh 同一種 per-session state 目錄慣例）。只在真的印出時寫
# marker——找不到規則檔的 session 之後投影補上了，仍會在第一次命中時提醒。
#
# warn-only：lint 印到 stderr、提醒走 additionalContext（TD-427），一律 exit 0。NEVER 改成
# exit 2 擋下 Edit —— HANDOFF.md 是高頻活文件，擋寫入買到的是一個繞過旗標，不是一條更好的 bullet。

set -euo pipefail

MODE="${1:-post-edit}"
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_response.filePath // ""' 2>/dev/null || echo "")

[ -z "$FILE_PATH" ] && exit 0

# 待拍板載體的唯一判準。work-loop state 的路徑與 decision-sources.ts 的 scanWorkLoopState 同一個。
decision_carrier_kind() {
  case "$1" in
    *HANDOFF.md) echo handoff ;;
    *docs/tech-debt.md) echo tech-debt ;;
    .clade/work-loop/state.json | */.clade/work-loop/state.json) echo work-loop ;;
  esac
}

KIND=$(decision_carrier_kind "$FILE_PATH")
[ -z "$KIND" ] && exit 0

if [ "$MODE" = "pre-edit" ]; then
  HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)" || exit 0
  # shellcheck source=_skill-rule-reminder.sh
  . "$HOOK_DIR/_skill-rule-reminder.sh" 2>/dev/null || exit 0

  SESSION=$(echo "$INPUT" | jq -r '.session_id // ""' 2>/dev/null || echo "")
  STATE_DIR="${TMPDIR:-/tmp}/clade-decision-authoring-read"
  MARKER="$STATE_DIR/${SESSION:-ppid-${PPID:-$$}}.seen"
  [ -f "$MARKER" ] && exit 0

  case "$FILE_PATH" in
    /*) ;;
    *)
      BASE=$(echo "$INPUT" | jq -r '.cwd // ""' 2>/dev/null || echo "")
      FILE_PATH="${BASE:-$PWD}/$FILE_PATH"
      ;;
  esac
  # Write 可以指向還不存在的檔或目錄：往上走到第一個存在的祖先再定位 repo。
  DIR=$(dirname -- "$FILE_PATH")
  while [ -n "$DIR" ] && [ "$DIR" != '/' ] && [ ! -d "$DIR" ]; do
    DIR=$(dirname -- "$DIR")
  done
  TOP=$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null || echo "")
  [ -n "$TOP" ] || exit 0

  RULE=$(skill_rule_path "$TOP" my 'rules/待拍板條目寫法.md')
  [ -n "$RULE" ] || exit 0

  mkdir -p "$STATE_DIR" 2>/dev/null || true
  : >"$MARKER" 2>/dev/null || true
  emit_pretool_context "READ $RULE"
  exit 0
fi

[ "$KIND" = "work-loop" ] && exit 0
[ -f "$FILE_PATH" ] || exit 0

ROOT="${CLADE_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-$(pwd)}}"
# clade home 跑自己的源檔；consumer 端 flow/ 不投影（規約一律寫
# `node ~/offline/clade/vendor/scripts/flow/flow.ts`），所以第二順位是 clade home。
# 第一個引數永遠是「被編輯的那個 repo」——lint 讀的是它的 HANDOFF，不是 clade 的。
for LINT in \
  "$ROOT/vendor/scripts/flow/decision-lint.ts" \
  "${CLADE_HOME:-$HOME/offline/clade}/vendor/scripts/flow/decision-lint.ts"; do
  if [ -f "$LINT" ]; then
    node "$LINT" "$ROOT" "$FILE_PATH" >&2 || true
    exit 0
  fi
done

exit 0
