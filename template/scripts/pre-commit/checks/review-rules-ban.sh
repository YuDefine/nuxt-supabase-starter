#!/usr/bin/env bash
# 🔒 LOCKED — managed by clade · Source: vendor/scripts/pre-commit/checks/review-rules-ban.sh · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/pre-commit/checks/review-rules-ban.sh
# CLADE:VENDOR-SCRIPT
#
# review-rules-ban (pre-commit, staged) — 擋住 patterns.json 定義的機械規則違規（pre-commit layer）
#
# 薄殼呼叫統一掃描引擎 vendor/review-rules/scan.ts（pre-commit / pre-push / CI / audit
# 四入口共用，見 scan.ts 檔頭）。掃描邏輯 / glob matching / multiLine tag 展平全部收斂
# 在 scan.ts，本檔只負責：
#   - 無 patterns.json / scan.ts（consumer 尚未 propagate）→ 跳過
#   - 無 staged .vue / app.config.* / content 下的 .md（pre-commit layer 覆蓋的 glob）→ 跳過，
#     避免每次 commit 都 spawn node
#   - 呼叫 scan.ts --staged --layer pre-commit，轉發 exit code
#     （severity=error 命中 → exit 1 擋 commit；severity=warning 只印不擋）
#
# 由 ~/clade vendor/scripts/pre-commit/ 散播，請勿直接編輯 consumer 副本。

set -euo pipefail

PROJECT_ROOT="$(git rev-parse --show-toplevel)"
cd "$PROJECT_ROOT"

PATTERNS_FILE="$PROJECT_ROOT/vendor/review-rules/patterns.json"
SCAN_ENGINE="$PROJECT_ROOT/vendor/review-rules/scan.ts"

# patterns.json / scan.ts 不存在 → 跳過（consumer 尚未 propagate）
[[ -f "$PATTERNS_FILE" ]] || exit 0
[[ -f "$SCAN_ENGINE" ]] || exit 0

# 蒐集本次 staged 的 .vue + app.config.* + content/**/*.md（pre-commit layer 覆蓋的 glob）
# content 的 .md 是 prose-* 文案規則的掃描對象；無 content/ 的 consumer 這一支恆為空，
# 不影響既有行為。
STAGED=$(git diff --cached --name-only --diff-filter=ACM \
  -- '*.vue' 'app.config.ts' 'app.config.js' 'content/*.md' 'content/**/*.md' \
  2>/dev/null | sed '/^$/d' | sort -u || true)

# 無 staged 檔 → 跳過
[[ -z "$STAGED" ]] && exit 0

exec node "$SCAN_ENGINE" --staged --layer pre-commit
