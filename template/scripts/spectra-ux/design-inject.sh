#!/usr/bin/env bash
# spectra-ux: post-propose design review reminder
#
# Detects newly created UI-scoped changes and reminds the agent to add a
# Design Review block to tasks.md if it's missing.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"
sux_load_config

CHANGE_NAME="${1:-}"
if [ -n "$CHANGE_NAME" ]; then
  CHANGE_DIR=$(sux_find_change_by_name "$CHANGE_NAME") || exit 0
else
  CHANGE_DIR=$(sux_find_active_change) || exit 0
fi

TASKS_FILE="$CHANGE_DIR/tasks.md"
[ -f "$TASKS_FILE" ] || exit 0

if ! sux_tasks_has_ui_scope "$TASKS_FILE"; then
  exit 0
fi

if grep -qi '^## .*Design Review' "$TASKS_FILE" 2>/dev/null; then
  exit 0
fi

LAST_SECTION=$(grep -E '^## [0-9]+\.' "$TASKS_FILE" 2>/dev/null | sed -E 's/^## ([0-9]+).*/\1/' | tail -1)
LAST_SECTION=${LAST_SECTION:-0}
NEXT_SECTION=$((LAST_SECTION + 1))
CHANGE_NAME=$(basename "$CHANGE_DIR")

cat <<EOF
Design Review 提醒：change「${CHANGE_NAME}」包含 UI scope，但 tasks.md 尚未加入 Design Review 區塊。

請在最後一個功能區塊之後、`## 人工檢查` 之前加入完整的 7 步 template（**MUST** 全部 N.1~N.7，不可裁減）：

## ${NEXT_SECTION}. Design Review

- [ ] ${NEXT_SECTION}.1 檢查 PRODUCT.md（必要）+ DESIGN.md（建議）；缺 PRODUCT.md 跑 /impeccable teach、缺 DESIGN.md 跑 /impeccable document
- [ ] ${NEXT_SECTION}.2 執行 /design improve [affected pages/components]，產出 Design Fidelity Report
- [ ] ${NEXT_SECTION}.3 修復所有 DRIFT 項目（Fidelity Score < 8/8 時必做，loop 直到 DRIFT = 0，max 2 輪）
- [ ] ${NEXT_SECTION}.4 依 /design improve 計劃按 canonical order 執行 targeted impeccable skills（layout / typeset / clarify / harden / colorize 等實際所需項目）
- [ ] ${NEXT_SECTION}.5 執行 /impeccable audit，確認 Critical = 0
- [ ] ${NEXT_SECTION}.6 執行 review-screenshot，補 design-review.md / 視覺 QA 證據
- [ ] ${NEXT_SECTION}.7 Fidelity 確認 — design-review.md 中無 DRIFT 項，且 Cross-Change DRIFT 已記錄

完整規則見 \`ux-completeness.md\` 的 Design Review Task Template 段落、\`manual-review.md\`、\`screenshot-strategy.md\`、與 proactive-skills 的 Design Review orchestration。
EOF
