#!/usr/bin/env bash
# 🔒 LOCKED — managed by clade · Source: vendor/scripts/pre-commit/checks/skip-expiry.sh · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/pre-commit/checks/skip-expiry.sh
# CLADE:VENDOR-SCRIPT
#
# skip-expiry (pre-commit, staged) — skip 誠實度：新增的 skip 要寫理由與到期日，碰到過期 skip 的改動要先處理
#
# 判定式唯一住在 scripts/checks/skip-gate.ts（skip 辨認與標記解析走 lib/mutation-probe/revive.ts；
# CI 的 vendor/actions/skip-expiry 呼叫同一份，NEVER 在這裡另寫判準）。本檔只負責找到 gate 並用 --staged 呼叫：
#   - 新增的 skip（數量超過 .clade/test-trust-baseline.json 該檔的數）缺 `clade-skip:` 標記或欄位不合法 → 擋（exit 1）
#   - 標記的 until 已過且該檔在這次 commit 中 → 擋；沒碰該檔 → 不擋
#   - baseline 檔新增列或 count 變大 → 擋（baseline 只能縮小）
#   - 無 baseline（HEAD 也沒有）→ 尚未採用，印 info 後放行；baseline 被刪、或 CI 的 --against 無 baseline → exit 3（印 --init-baseline 建立指令）
#   - revive=auto 的 skip 只印「CI 會驗」；復活驗證（成本高）只在 CI 跑
# 辨認 skip 需要 consumer 自己的 node_modules（typescript）；找不到 → gate 自行 soft-skip exit 0。
#
# propagate 的 delivery commit 由 CLADE_PROPAGATE=1 放行（同 consumer-carriers.sh）。
# 缺 node / gate 未散播 → soft-skip exit 0。
#
# 規約來源：rules/core/testing-anti-patterns.md § skip 誠實度
#
# 由 ~/clade vendor/scripts/pre-commit/ 散播，請勿直接編輯 consumer 副本。

set -euo pipefail

[[ "${CLADE_PROPAGATE:-}" == "1" ]] && exit 0
command -v node >/dev/null 2>&1 || exit 0

# consumer root（≠ git toplevel 的子目錄 consumer 也對）：解析規則與 staged 路徑規約見 ../consumer-root.sh
# shellcheck source=../consumer-root.sh
source "$(dirname "${BASH_SOURCE[0]}")/../consumer-root.sh"
PROJECT_ROOT="$(clade_consumer_root)"
cd "$PROJECT_ROOT"

GATE="scripts/checks/skip-gate.ts"
[[ -f "$GATE" ]] || GATE="vendor/scripts/checks/skip-gate.ts"
[[ -f "$GATE" ]] || exit 0 # gate 未散播到此 consumer → no-op

exec node "$GATE" --staged --root "$PROJECT_ROOT"
