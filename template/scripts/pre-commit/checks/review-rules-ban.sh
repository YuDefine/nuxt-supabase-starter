#!/usr/bin/env bash
# CLADE:VENDOR-SCRIPT
#
# review-rules-ban (pre-commit, staged) — 擋住 patterns.json 定義的機械規則違規（pre-commit layer）
#
# 薄殼呼叫統一掃描引擎 vendor/review-rules/scan.mjs（pre-commit / pre-push / CI / audit
# 四入口共用，見 scan.mjs 檔頭）。掃描邏輯 / glob matching / multiLine tag 展平全部收斂
# 在 scan.mjs，本檔只負責：
#   - 無 patterns.json / scan.mjs（consumer 尚未 propagate）→ 跳過
#   - 無 staged .vue / app.config.*（pre-commit layer 目前只覆蓋這兩種 glob）→ 跳過，
#     避免每次 commit 都 spawn node
#   - 呼叫 scan.mjs --staged --layer pre-commit，轉發 exit code
#     （severity=error 命中 → exit 1 擋 commit；severity=warning 只印不擋）
#
# 由 ~/clade vendor/scripts/pre-commit/ 散播，請勿直接編輯 consumer 副本。

set -euo pipefail

PROJECT_ROOT="$(git rev-parse --show-toplevel)"
cd "$PROJECT_ROOT"

PATTERNS_FILE="$PROJECT_ROOT/vendor/review-rules/patterns.json"
SCAN_ENGINE="$PROJECT_ROOT/vendor/review-rules/scan.mjs"

# patterns.json / scan.mjs 不存在 → 跳過（consumer 尚未 propagate）
[[ -f "$PATTERNS_FILE" ]] || exit 0
[[ -f "$SCAN_ENGINE" ]] || exit 0

# 蒐集本次 staged 的 .vue + app.config.*（pre-commit layer 目前只覆蓋這兩種 glob）
STAGED_VUE=$(git diff --cached --name-only --diff-filter=ACM -- '*.vue' 2>/dev/null || true)
STAGED_CONFIG=$(git diff --cached --name-only --diff-filter=ACM -- 'app.config.ts' 'app.config.js' 2>/dev/null || true)
STAGED=$(printf '%s\n%s' "$STAGED_VUE" "$STAGED_CONFIG" | sed '/^$/d' | sort -u)

# 無 staged 檔 → 跳過
[[ -z "$STAGED" ]] && exit 0

exec node "$SCAN_ENGINE" --staged --layer pre-commit
