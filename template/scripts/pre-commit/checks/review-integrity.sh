#!/usr/bin/env bash
# 🔒 LOCKED — managed by clade · Source: vendor/scripts/pre-commit/checks/review-integrity.sh · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/pre-commit/checks/review-integrity.sh
# CLADE:VENDOR-SCRIPT
# wrapper 自動登記在本 worktree 的 git dir，不依賴 owner 手動傳環境變數。
set -euo pipefail
CLADE_REVIEW_BASELINE=$(git rev-parse --path-format=absolute --git-path clade-review-integrity.json)
if [[ ! -e "$CLADE_REVIEW_BASELINE" ]]; then
  exit 0
fi
CLADE_REVIEW_HOME="${CLADE_HOME:-$HOME/offline/clade}"
node "$CLADE_REVIEW_HOME/vendor/scripts/lib/review-integrity-scope.ts" check-staged \
  --repo "$(git rev-parse --show-toplevel)" --baseline "$CLADE_REVIEW_BASELINE"
