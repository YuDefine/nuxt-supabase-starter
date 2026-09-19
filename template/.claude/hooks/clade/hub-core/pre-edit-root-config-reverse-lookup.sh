#!/usr/bin/env bash
# PreToolUse(Edit|Write) hook — clade 自身 root config 修改前，代跑「反查誰以它為基準」
# 的 rg 並把結果注入（clade home 自用）。
#
# 規約：.claude/rules/local/clade-role-and-todo-discipline.md § 改 clade 自身 root config
# 前 MUST 反查誰以它為基準——「檔案外觀不承載這個資訊，只有反查承載」
# （pitfall-self-config-is-own-test-fixture）。本 hook 把「提醒 agent 去跑」壓成「代跑
# 並附結果」，少一步遺忘面。
#
# 通道：hookSpecificOutput.additionalContext（TD-427——PreToolUse 上 stderr / 裸 stdout
# 都到不了 agent）。不阻擋（exit 0）；NEVER 補 permissionDecision。
# rg 缺 / jq 缺 / 非 root config → silent exit 0。

set -uo pipefail

INPUT=$(cat)
command -v jq >/dev/null 2>&1 || exit 0
command -v rg >/dev/null 2>&1 || exit 0

ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // ""' 2>/dev/null) || exit 0
[ -n "$FILE_PATH" ] || exit 0

# 相對 root 的路徑（絕對路徑去前綴）
REL="${FILE_PATH#"$ROOT"/}"

case "$REL" in
  .mcp.json | package.json | vite.config.ts | registry/*.json | .claude/settings.json) ;;
  *) exit 0 ;;
esac

BASE=$(basename "$REL")
# 只搜實際存在的目錄：rg 對缺目錄回非零，pipefail 下會把已捕到的命中清掉（實測踩過）
DIRS=()
for d in test scripts vendor/scripts capabilities plugins rules; do
  [ -d "$ROOT/$d" ] && DIRS+=("$d")
done
HITS=""
if [ "${#DIRS[@]}" -gt 0 ]; then
  HITS=$(cd "$ROOT" 2>/dev/null && rg -n --fixed-strings "$BASE" "${DIRS[@]}" 2>/dev/null | head -20 || true)
fi

if [ -z "$HITS" ]; then
  MSG="🔎 root config 反查（${REL}）：0 命中 — 一般設定，照常改。"
else
  MSG="🔎 root config 反查（${REL}）— 以下位置以它為基準（clade-role-and-todo-discipline § 反查表）：
${HITS}
命中 test/ 或 audit script → 它是基準，連基準一起改，NEVER 只改設定讓 test 紅了再想辦法；
命中 rules/ / capabilities/ → 它同時是散播內容，走 publish / propagate。"
fi

jq -n --arg ctx "$MSG" \
  '{hookSpecificOutput: {hookEventName: "PreToolUse", additionalContext: $ctx}}'
exit 0
