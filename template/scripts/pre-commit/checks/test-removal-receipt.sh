#!/usr/bin/env bash
# 🔒 LOCKED — managed by clade · Source: vendor/scripts/pre-commit/checks/test-removal-receipt.sh · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/pre-commit/checks/test-removal-receipt.sh
# CLADE:VENDOR-SCRIPT
#
# test-removal-receipt (pre-commit, staged) — 刪除／合併測試必須附有效收據才放行
#
# 判定式唯一住在 scripts/checks/test-removal-gate.ts（CI 的 vendor/actions/test-removal-receipt 呼叫
# 同一份，NEVER 在這裡另寫判準）。本檔只負責找到 gate 並用 --staged 呼叫：
#   - 被刪或被合併的 test case（整檔刪除、檔內減少、改名）沒有有效收據或合法豁免 → 擋（exit 1），
#     訊息帶可直接執行的探針指令（mutation-probe.ts run … --vouch …）
#   - 收據有效性 1–5 在這裡驗；第 6 條（CI 依收據重跑仍 caught）只在 CI 驗
#   - 只新增或修改測試、沒有 case 減少 → no-op
# 收據放在 .clade/break-receipts/，和改動一起 commit（pre-commit 階段 commit message 還不存在）。
# 判定需要 consumer 自己的 node_modules（typescript 列 test case 名稱）；找不到 → gate 只印警告。
#
# propagate 的 delivery commit 由 CLADE_PROPAGATE=1 放行（同 consumer-carriers.sh）。
# 缺 node / gate 未散播 → soft-skip exit 0。
#
# 規約來源：rules/core/testing-anti-patterns.md § 刪除或合併既有測試：先取得刪除證據
#
# 由 ~/clade vendor/scripts/pre-commit/ 散播，請勿直接編輯 consumer 副本。

set -euo pipefail

[[ "${CLADE_PROPAGATE:-}" == "1" ]] && exit 0
command -v node >/dev/null 2>&1 || exit 0

PROJECT_ROOT="$(git rev-parse --show-toplevel)"
cd "$PROJECT_ROOT"

GATE="scripts/checks/test-removal-gate.ts"
[[ -f "$GATE" ]] || GATE="vendor/scripts/checks/test-removal-gate.ts"
[[ -f "$GATE" ]] || exit 0 # gate 未散播到此 consumer → no-op

exec node "$GATE" --staged --root "$PROJECT_ROOT"
