#!/usr/bin/env bash
# PreToolUse(Edit|Write) hook — 動筆之前，問一次 claim registry「這個檔已經有別人在做嗎」。
#
# 規約：rules/core/session-claims.md § 3.3（導出契約）。成因全文見
# docs/pitfalls/2026-08-29-coordination-state-broadcast-because-no-consumer-reads-the-claim.md：
# claim registry、契約、heartbeat、ownership journal 全部存在且在運作，而**沒有任何動作在動筆
# 之前讀它**。於是持有者只剩兩個選擇——沉默（別人重工）或廣播（N-1 份 context 純浪費）。
# 本 hook 是那個缺掉的消費端：衝突那一刻遞一行給衝突者，沒衝突時一個字都不送。
#
# 成本契約（TD-794 刀 4 一等公民）：**無衝突 = 零輸出、零 token、exit 0**。
# 任何「無事發生時仍要 agent 讀一段字」的版本都不合格 —— 那就是廣播換個地方發。
#
# 判準來源只吃 `declared` 與 `derived-hook`：journal 的 `mtime-diff` 列（clade 自身實測
# 95.5% 的量、其中可裁決的部分 87.5% 歸錯人）NEVER 用來出聲。理由與量測全文在
# claim-helper.ts 的 `claimConflictsForPath` 頭註 —— **NEVER** 在這裡放寬它。
#
# 通道：hookSpecificOutput.additionalContext（TD-427 —— PreToolUse 上 stderr / 裸 stdout
# 都到不了 agent）。NEVER 補 permissionDecision：這是 warn，不是 block。爭用的正解是兩個
# session 談，不是機器替其中一方否決另一方。
#
# fail-open 全程：jq 缺 / node 缺 / 不在 git tree / 查詢自己出錯 → silent exit 0。
# 協調訊號 NEVER 擋住寫入。

set -uo pipefail

INPUT=$(cat)
command -v jq >/dev/null 2>&1 || exit 0

FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // ""' 2>/dev/null) || exit 0
[ -n "$FILE_PATH" ] || exit 0

# 目標檔所在的樹。Write 可以指向尚未存在的目錄，所以往上走到第一個存在的祖先——
# 直接 `[ -d "$(dirname)" ] || exit 0` 會讓「在新目錄裡開新檔」這個最需要攔的情境
# 靜默通過，而 fail-open 的靜默與「查過了沒衝突」完全同形。
TARGET_DIR=$(dirname -- "$FILE_PATH")
while [ -n "$TARGET_DIR" ] && [ "$TARGET_DIR" != '/' ] && [ ! -d "$TARGET_DIR" ]; do
  TARGET_DIR=$(dirname -- "$TARGET_DIR")
done
[ -d "$TARGET_DIR" ] || exit 0

TOPLEVEL=$(cd "$TARGET_DIR" 2>/dev/null && git rev-parse --show-toplevel 2>/dev/null) || exit 0
[ -n "$TOPLEVEL" ] || exit 0

# consumer root = main worktree（claims / journal 住在那裡，linked worktree 沒有自己的一份）
COMMON_DIR=$(cd "$TARGET_DIR" 2>/dev/null && git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || exit 0
CONSUMER_ROOT=$(dirname -- "$COMMON_DIR")
CLAIMS_DIR="$CONSUMER_ROOT/.clade/claims"
[ -d "$CLAIMS_DIR" ] || exit 0

# ── 便宜的前置過濾：沒有「別人的」claim 就完全不啟動 node ────────────────────────
# 每次 Edit/Write 都 spawn 一個 TS-loader node 是本 hook 唯一的常態成本。這一段把它壓成
# 「只有真的有別的樹在 claim 時才付」。NEVER 拿它當判準——它只回答「有沒有必要問」，
# 「有沒有衝突」由 claim-helper 回答。
OTHERS=0
for f in "$CLAIMS_DIR"/*.json; do
  [ -e "$f" ] || continue
  wt=$(jq -r '.worktree_path // ""' "$f" 2>/dev/null) || continue
  [ "$wt" = "$TOPLEVEL" ] && continue
  OTHERS=1
  break
done
[ "$OTHERS" = 1 ] || exit 0

REL="${FILE_PATH#"$TOPLEVEL"/}"
# 絕對路徑不在這棵樹底下（不該發生，但別猜）→ 靜默。
case "$REL" in /*) exit 0 ;; esac

# helper 的落點在 clade home 與 consumer 端**不同**：clade 的源檔在 vendor/scripts/，
# 散播到 consumer 是 scripts/。兩個都問，NEVER 只寫其中一個 —— 只寫 vendor 的版本在
# 全 13 個 consumer 上都會靜默 no-op，而 fail-open 的靜默與「查過了，沒衝突」完全同形。
HELPER=""
for cand in "$CONSUMER_ROOT/scripts/claim-helper.ts" "$CONSUMER_ROOT/vendor/scripts/claim-helper.ts"; do
  [ -f "$cand" ] && { HELPER="$cand"; break; }
done
[ -n "$HELPER" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0

OUT=$(cd "$CONSUMER_ROOT" && node "$HELPER" conflicts "$REL" --worktree "$TOPLEVEL" 2>/dev/null)
RC=$?
# 3 = 有衝突（見 claim-helper CLI）。其餘一律靜默，含查詢自己失敗的 1。
[ "$RC" = 3 ] || exit 0
[ -n "$OUT" ] || exit 0

# 上限 3 行：更多的話問題不是「你不知道」，是「這個檔本來就是共寫的」，而那要人談不是機器列。
MSG=$(printf '%s\n' "$OUT" | head -3)
jq -n --arg ctx "$MSG" \
  '{hookSpecificOutput: {hookEventName: "PreToolUse", additionalContext: $ctx}}'
exit 0
