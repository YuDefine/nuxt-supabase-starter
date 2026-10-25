#!/usr/bin/env bash
# 🔒 LOCKED — managed by clade · Source: vendor/scripts/pre-commit/checks/td-priority.sh · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/pre-commit/checks/td-priority.sh
# CLADE:VENDOR-SCRIPT
#
# td-priority (pre-commit, staged) — 擋 docs/tech-debt.md 加回 TD 等級欄位（`**Priority**:` 行）
#
# 判定式唯一住在 scripts/checks/td-priority-gate.ts（CI 的 vendor/actions/td-priority-gate 呼叫同一份，
# NEVER 在這裡另寫判準）。本檔只負責找到 detector 並用 --staged 呼叫：新增或改寫的欄位行 → 擋；
# 刪除放行；其他檔不判。等級只看 fleet 看板 td:<repo>:TD-n。
#
# propagate 的 delivery commit 由 CLADE_PROPAGATE=1 放行（同 consumer-carriers.sh）。
# 缺 node / detector 未散播 → soft-skip exit 0。
#
# 規約來源：rules/core/follow-up-register.md § 等級只看 fleet 看板
#
# 由 ~/clade vendor/scripts/pre-commit/ 散播，請勿直接編輯 consumer 副本。

set -euo pipefail

[[ "${CLADE_PROPAGATE:-}" == "1" ]] && exit 0
command -v node >/dev/null 2>&1 || exit 0

PROJECT_ROOT="$(git rev-parse --show-toplevel)"
cd "$PROJECT_ROOT"

git diff --cached --quiet -- docs/tech-debt.md && exit 0

DETECTOR="scripts/checks/td-priority-gate.ts"
[[ -f "$DETECTOR" ]] || DETECTOR="vendor/scripts/checks/td-priority-gate.ts"
[[ -f "$DETECTOR" ]] || exit 0 # detector 未散播到此 consumer → no-op

exec node "$DETECTOR" --staged --root "$PROJECT_ROOT"
