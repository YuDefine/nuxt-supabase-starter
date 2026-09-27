#!/usr/bin/env bash
# 🔒 LOCKED — managed by clade · Source: vendor/scripts/pre-commit/checks/consumer-carriers.sh · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/pre-commit/checks/consumer-carriers.sh
# CLADE:VENDOR-SCRIPT
#
# consumer-carriers (pre-commit, staged) — 擋 consumer 重建已退役的待辦／文件載體
#
# 判定式唯一住在 scripts/checks/consumer-carrier-gate.ts（fleet 驗收 import 同一份，NEVER 在這裡
# 另寫判準）。本檔只負責找到 detector 並用 --staged 呼叫：
#   - docs/：已退役（HEAD 沒有任何 docs 路徑）的 consumer 新增或修改 `(^|/)docs/` 路徑 → 擋；
#     `specs/truth/docs/**` 放行
#   - 新 TD：lifecycle repo（有 specs/truth/work-lifecycle.md）新定義 HEAD 沒出現過的 TD-<n> → 擋
#   - HANDOFF：lifecycle repo 改到 HANDOFF.md 時，新出現的未勾項或不指向現役 W- plan 的頂層項 → 擋
#     （基準版已有的舊存量可留可刪）
# 未啟用的條件自動 no-op；刪除與搬出一律放行。
#
# propagate 的 delivery commit 由 CLADE_PROPAGATE=1 放行（同 clade-projection-drift.sh）。
# 缺 node / detector 未散播 → soft-skip exit 0。
#
# 判準來源：W-2026-09-20-consumer-lifecycle-migration spec FR-018／FR-025／FR-026；cookbook vendor/snippets/consumer-lifecycle/
#
# 由 ~/clade vendor/scripts/pre-commit/ 散播，請勿直接編輯 consumer 副本。

set -euo pipefail

[[ "${CLADE_PROPAGATE:-}" == "1" ]] && exit 0
command -v node >/dev/null 2>&1 || exit 0

PROJECT_ROOT="$(git rev-parse --show-toplevel)"
cd "$PROJECT_ROOT"

DETECTOR="scripts/checks/consumer-carrier-gate.ts"
[[ -f "$DETECTOR" ]] || DETECTOR="vendor/scripts/checks/consumer-carrier-gate.ts"
[[ -f "$DETECTOR" ]] || exit 0 # detector 未散播到此 consumer → no-op

exec node "$DETECTOR" --staged --root "$PROJECT_ROOT"
