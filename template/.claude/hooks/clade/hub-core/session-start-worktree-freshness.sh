#!/usr/bin/env bash
# SessionStart hook — linked worktree 的規約／runtime 落後 main 警告＋可回收 worktree 清單。
#
# 防的失敗：propagate 只寫 main，數百棵 worktree 凍結在開樹那一刻的 `.claude/rules/`、
# `vendor/scripts/`、`capabilities/core/scripts/`。舊樹裡的 session 讀舊規約、跑舊 helper，
# 表面訊號全部正常（2026-09-23：多個 session 在舊樹跑 0-A wrapper，到報錯才發現）。
# 所以在第一屏就說出「落後 N commit、哪些 runtime 檔不同」。
#
# 判定全在 vendor/scripts/worktree-freshness.ts（只比 tree hash、不 fetch、不跑完整 diff；
# 可回收清單讀快取、過期才背景 refresh）。本 hook 只負責找到那支 script——與 review
# wrapper 同一個解析順序：CLADE_HOME 優先，CLADE_RUNTIME_FROM_REPO=1 時本樹優先。
# 讀不到 / 跑不動一律靜默（fail-open）：SessionStart 的噪音成本高於漏報一次。

set -uo pipefail
cat > /dev/null

ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
HOME_SCRIPT="${CLADE_HOME:-$HOME/offline/clade}/vendor/scripts/worktree-freshness.ts"
REPO_SCRIPT="$ROOT/vendor/scripts/worktree-freshness.ts"
if [ "${CLADE_RUNTIME_FROM_REPO:-}" = "1" ]; then
  set -- "$REPO_SCRIPT" "$HOME_SCRIPT"
else
  set -- "$HOME_SCRIPT" "$REPO_SCRIPT"
fi
for script in "$@"; do
  if [ -f "$script" ]; then
    node "$script" session-start --cwd "$ROOT" 2>/dev/null || true
    exit 0
  fi
done
exit 0
