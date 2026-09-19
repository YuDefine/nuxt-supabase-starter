#!/usr/bin/env bash
# clade — 寫完一條待拍板條目的當下，就地判「這題是 ruling 但沒有選項」。
#
# 為什麼是 PostToolUse 而不是靠既有的兩道：`flow sources` 的 lint 與 ingest 端的
# `ask-options` 退回都是對的，也都太晚——到那時題目已經在 Charles 手機上長成一個空白
# 輸入框，退回變成佇列上的另一張卡，而唯一五秒鐘就能修好的人（選項還在它 context 裡的
# 那個 agent）已經走了。2026-08-29 實測：一次這樣的退回在佇列上停了 3.2 小時。
#
# 判準與措辭都不在這裡：SoT 是 vendor/scripts/flow/decision-lint.ts，它呼叫的是
# decision-sources.ts 的同一組 scanner 與 decisions.ts 的 OPTIONS_REQUEST_TEXT。
# NEVER 在這支腳本裡自己解析 markdown —— 第二份 matcher 遲早與佇列給出不同答案，
# 而不一致的那一次會教讀者「這個提示是雜訊」。
#
# warn-only：印到 stderr、一律 exit 0。NEVER 改成 exit 2 擋下 Edit —— HANDOFF.md 是
# 高頻活文件，擋寫入買到的是一個繞過旗標，不是一條更好的 bullet。

set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_response.filePath // ""' 2>/dev/null || echo "")

[ -z "$FILE_PATH" ] && exit 0
case "$FILE_PATH" in
  *HANDOFF.md|*docs/tech-debt.md) ;;
  *) exit 0 ;;
esac
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
