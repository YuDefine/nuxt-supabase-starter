#!/usr/bin/env bash
# PreToolUse(Edit|Write) hook — clade 自身 root config 修改前，代跑「反查誰以它為基準」
# 的 rg 並把結果注入（clade home 自用）。
#
# 規約：clade 沒有純粹的本地設定——clade 既是被稽核的對象也是稽核的基準，自身狀態同時被自家
# test / audit / skill 當成 reference implementation 讀（pitfall-self-config-is-own-test-fixture：
# 拿掉 `.mcp.json` 一個 entry 時剛好有 test 接住；換成沒有 test 覆蓋的 root config 就完全無回饋）。
# 動 `.mcp.json` / `package.json` / `vite.config.ts` / `registry/*.json` / `.claude/settings.json`
# 前 MUST 先反查誰以它為基準；本 hook 把「提醒 agent 去跑」壓成「代跑並附結果」，少一步遺忘面。
#
#   0 命中                      一般設定，照常改
#   命中 test/ 或 audit script  它是基準：要改就連基準一起改，NEVER 只改設定、讓 test 紅了再想辦法
#   命中 rules/ 或 capabilities/ 它同時是散播內容，走 publish／propagate，不是本地改完就算
#
# NEVER 用「沒有 🔒 LOCKED banner／chmod 正常／沒有註解」推論它沒被當基準——檔案外觀不承載這個資訊，
# 只有反查承載。
#
# 通道：hookSpecificOutput.additionalContext（TD-427——PreToolUse 上 stderr / 裸 stdout
# 都到不了 agent）。不阻擋（exit 0）；NEVER 補 permissionDecision。
# rg 缺 / jq 缺 / 非 root config / 0 命中 → silent exit 0。

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
  HITS=$(cd "$ROOT" 2>/dev/null && rg -n --fixed-strings "$BASE" "${DIRS[@]}" 2>/dev/null || true)
fi

# D4b：0 命中＝沒有可行動事項，零輸出（照常改本來就是預設）。
[ -n "$HITS" ] || exit 0

# 命中只列前 CAP 行、每行截 160 字元；完整清單用同一條 rg 現查（行數多代表它本來就是共用基準，列再多也看不完）。
CAP=8
TOTAL=$(printf '%s\n' "$HITS" | wc -l | tr -d ' ')
SHOWN=$(printf '%s\n' "$HITS" | head -n "$CAP" | cut -c1-160)
MORE=""
[ "$TOTAL" -gt "$CAP" ] && MORE="
…另 $((TOTAL - CAP)) 處：rg -n --fixed-strings $BASE ${DIRS[*]}"
MSG="🔎 root config 反查（${REL}）— 以下位置以它為基準（clade-role-and-todo-discipline § 反查表）：
${SHOWN}${MORE}
命中 test/ 或 audit script → 連基準一起改，NEVER 只改設定讓 test 紅了再想辦法；命中 rules/ / capabilities/ → 同時是散播內容，走 publish / propagate。"

jq -n --arg ctx "$MSG" \
  '{hookSpecificOutput: {hookEventName: "PreToolUse", additionalContext: $ctx}}'
exit 0
