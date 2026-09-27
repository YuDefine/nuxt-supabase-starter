#!/usr/bin/env bash
# PostToolUse(Edit|Write) ／ Stop — 轉呼叫 impeccable 原生 detector hook。
#
# impeccable 的 `hooks on` 要每個專案、每台機器各跑一次，fleet 實測 0/11 啟用；
# 這裡由 hub-core 統一註冊，所有機器生效（W-2026-09-26-impeccable-closed-loop D6）。
# `impeccable hook` 從 stdin 讀 hook payload，自己判斷是不是 UI 檔、要不要回報；
# 專案用 committed `.impeccable/config.json` 的 `hook.enabled: false` 關閉仍有效。
#
# 兩種情況直接 exit 0：launcher 不存在（專案沒裝 impeccable），或專案已經用
# `impeccable hooks on` 原生註冊（那份會跑，這裡再跑一次會重複回報）。

set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
LAUNCHER="$ROOT/.claude/skills/impeccable/scripts/impeccable"
[ -x "$LAUNCHER" ] || exit 0

for settings in "$ROOT/.claude/settings.local.json" "$ROOT/.claude/settings.json"; do
  if [ -f "$settings" ] && grep -qE 'skills/impeccable/scripts/impeccable(\\")? hook' "$settings"; then
    exit 0
  fi
done

exec "$LAUNCHER" hook
