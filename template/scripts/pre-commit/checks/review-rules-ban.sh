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
#   - 無 staged 新增 / 修改檔（純刪除 commit）→ 跳過
#   - 呼叫 scan.ts --staged --layer pre-commit，轉發 exit code
#     （severity=error 命中 → exit 1 擋 commit；severity=warning 只印不擋）；零命中不出聲
#
# 哪些副檔名要掃由 patterns.json 各規則的 fileGlob 決定，本檔 NEVER 另列一份副檔名清單：
# 兩份清單一漂開，fileGlob 在清單外的規則（如 `**/*.ts`）就在 pre-commit 永遠不觸發。
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

STAGED=$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null | sed '/^$/d' || true)
[[ -z "$STAGED" ]] && exit 0

rc=0
out=$(node "$SCAN_ENGINE" --staged --layer pre-commit 2>&1) || rc=$?
[[ "$out" == '✅ 未發現違規' ]] || printf '%s\n' "$out" >&2
exit "$rc"
