#!/usr/bin/env bash
# 🔒 LOCKED — managed by clade · Source: vendor/scripts/pre-commit/checks/new-python.sh · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/pre-commit/checks/new-python.sh
# CLADE:VENDOR-SCRIPT
#
# new-python (pre-commit, staged) — 擋新增 .py（toolchain D1：Python 已退役）
#
# 判定式唯一住在 scripts/checks/new-python-gate.ts（clade home 的 check-retired-carriers.ts import
# 同一份，NEVER 在這裡另寫判準）。本檔只負責：沒有新落腳的 .py 就直接放行；有就找到 detector
# 用 --staged 呼叫。修改既有 .py、純改名、重新投影既有 .py 放行。
#
# fail-closed：有新增 .py 卻缺 node 或 detector → 擋。
# propagate 的 delivery commit 由 CLADE_PROPAGATE=1 放行（同 consumer-carriers.sh；投影內容由 clade 源頭負責）。
#
# 規約來源：rules/core/code-style.md § 新增腳本選語言
#
# 由 ~/clade vendor/scripts/pre-commit/ 散播，請勿直接編輯 consumer 副本。

set -euo pipefail

[[ "${CLADE_PROPAGATE:-}" == "1" ]] && exit 0

# consumer root（≠ git toplevel 的子目錄 consumer 也對）：解析規則與 staged 路徑規約見 ../consumer-root.sh
# shellcheck source=../consumer-root.sh
source "$(dirname "${BASH_SOURCE[0]}")/../consumer-root.sh"
PROJECT_ROOT="$(clade_consumer_root)"
cd "$PROJECT_ROOT"

# 用 --quiet 的 exit code 判斷：0＝沒有新落腳的 .py、1＝有、其他＝git 失敗 → fail-closed 擋。
# NEVER 接 grep -q：pipefail 下 git 吃 SIGPIPE，大量 .py 時反而放行。
staged_py_rc=0
git diff --cached --quiet --diff-filter=ACR -M -- '*.py' || staged_py_rc=$?
case "$staged_py_rc" in
  0) exit 0 ;;
  1) ;;
  *)
    echo "[new-python] git diff 失敗（rc=${staged_py_rc}），無法判定 staged .py → 擋（rules/core/code-style.md § 新增腳本選語言）" >&2
    exit 1
    ;;
esac

if ! command -v node >/dev/null 2>&1; then
  echo "[new-python] 有新增 .py 但找不到 node，檢查跑不起來 → 擋（rules/core/code-style.md § 新增腳本選語言）" >&2
  exit 1
fi

DETECTOR="scripts/checks/new-python-gate.ts"
[[ -f "$DETECTOR" ]] || DETECTOR="vendor/scripts/checks/new-python-gate.ts"
if [[ ! -f "$DETECTOR" ]]; then
  echo "[new-python] 有新增 .py 但 detector 未散播（scripts/checks/new-python-gate.ts）→ 擋；請跑 clade propagate" >&2
  exit 1
fi

exec node "$DETECTOR" --staged --root "$PROJECT_ROOT"
