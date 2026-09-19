#!/usr/bin/env bash
# session-start-session-tasks-reminder.sh — surface rules/core/session-tasks.md 的建檔要求
#
# TD-330（2026-08-05 拍板 A）。第二輪稽核的 active 欄顯示：遵從率集中在 4 家重度 repo，
# 其餘 5 家為 0。既有數據只說得出「輕度 repo 沒採用」，說不出是**不需要**還是**沒被提醒** ——
# 這支 hook 存在就是為了把那兩者分開：掛上提示後若輕度 repo 仍 0，那才是「不需要」的證據。
#
# 兩個安靜條件（避免變成每 session 恆亮的雜訊，恆亮的提示會訓練人跳過整段）：
#   1. 今天已有 tasks/<YYYY-MM-DD-HHMM>-*.md → 已遵守，完全不出聲
#   2. source=resume → 同一段工作續跑，不是新開工
# source=compact 反而**一律**出聲：auto-compact 剛把狀態丟掉，而 task 檔正是跨 compact
# 的主要狀態載體 —— 那一刻沒有檔案的代價最大。
#
# Exits 0 unconditionally（warn-only — NEVER block session start）。

set -euo pipefail

HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$HOOK_DIR/_output-cap.sh" ]; then
  # shellcheck source=_output-cap.sh
  . "$HOOK_DIR/_output-cap.sh"
else
  cap_output() { cat; }
fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$REPO_ROOT" ] || exit 0

# hook stdin 是 JSON；只取 source，解不出來就當 startup（照常提示，不靜默）
SOURCE=""
if [ ! -t 0 ]; then
  SOURCE="$(head -c 4096 | tr ',' '\n' | grep -o '"source"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || true)"
fi

TODAY="$(date +%Y-%m-%d)"
HAS_TODAY=0
if compgen -G "$REPO_ROOT/tasks/${TODAY}-*.md" > /dev/null 2>&1; then HAS_TODAY=1; fi

if [ "$SOURCE" = "compact" ]; then
  [ "$HAS_TODAY" -eq 1 ] && exit 0
  {
    echo "[session-tasks] auto-compact 剛發生，而本 repo 今天還沒有 tasks/${TODAY}-*.md。"
    echo "  compact 會丟掉 session 狀態，task 檔是跨 compact 的主要狀態載體 —— 續做前先補一份："
    echo "  Write tasks/${TODAY}-HHMM-<slug>.md（規約：rules/core/session-tasks.md）"
  } 2>&1 | cap_output >&2
  exit 0
fi

# resume = 同一段工作續跑，不是新開工
[ "$SOURCE" = "resume" ] && exit 0
[ "$HAS_TODAY" -eq 1 ] && exit 0

{
  echo "[session-tasks] 開始任何 ad-hoc 工作（debug／配置調整／單檔 fix／勘查）前，"
  echo "  MUST 先 Write tasks/${TODAY}-HHMM-<slug>.md 再動手（一 session 一檔，NEVER 共享單檔）。"
  if [ ! -d "$REPO_ROOT/tasks" ]; then
    echo "  本 repo 尚無 tasks/ —— 目錄不存在**不代表**未採用本規約，直接建即可。"
  fi
  echo "  規約全文：rules/core/session-tasks.md（Claude 投影在 .claude/skills/clade-session-work/rules/session-tasks.md）"
} 2>&1 | cap_output >&2
exit 0
