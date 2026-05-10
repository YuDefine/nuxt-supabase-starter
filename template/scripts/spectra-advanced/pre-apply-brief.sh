#!/usr/bin/env bash
# spectra-advanced: pre-apply journey brief
#
# Briefs the implementer with the User Journeys and Affected Entity Matrix
# from a change's proposal, plus exit criteria.
#
# Usage:
#   pre-apply-brief.sh                  → finds latest active change
#   pre-apply-brief.sh <change-name>    → briefs specific change
#
# Exit: 0 always (informational)

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"
sux_load_config

CHANGE_DIR=""
if [ $# -ge 1 ] && [ -n "$1" ]; then
  CHANGE_DIR=$(sux_find_change_by_name "$1") || true
else
  CHANGE_DIR=$(sux_find_active_change) || true
fi

[ -z "$CHANGE_DIR" ] && exit 0

CHANGE_NAME=$(basename "$CHANGE_DIR")
PROPOSAL_FILE="$CHANGE_DIR/proposal.md"
[ -f "$PROPOSAL_FILE" ] || exit 0

JOURNEY_BLOCK=$(sux_extract_section "$PROPOSAL_FILE" 'User Journeys')
ENTITY_BLOCK=$(sux_extract_section "$PROPOSAL_FILE" 'Affected Entity Matrix')
RISK_BLOCK=$(sux_extract_section "$PROPOSAL_FILE" 'Implementation Risk Plan')

if [ -z "$JOURNEY_BLOCK" ] && [ -z "$ENTITY_BLOCK" ] && [ -z "$RISK_BLOCK" ]; then
  exit 0
fi

echo "[UX Completeness] spectra-apply 實作簡報 (change: ${CHANGE_NAME})"
echo ""
echo "本次 apply 必須確保以下體驗在瀏覽器端走得通。完成每個 task 後對照此清單。"
echo ""

if [ -n "$ENTITY_BLOCK" ]; then
  echo "═══ Affected Entity Matrix ═══"
  echo "$ENTITY_BLOCK"
  echo ""
fi

if [ -n "$RISK_BLOCK" ]; then
  echo "═══ Implementation Risk Plan（先對齊前提再動手） ═══"
  echo "$RISK_BLOCK"
  echo ""
fi

if [ -n "$JOURNEY_BLOCK" ]; then
  echo "═══ User Journeys（每個都必須可執行） ═══"
  echo "$JOURNEY_BLOCK"
  echo ""
fi

cat <<'EOF'
═══ 實作自我檢查 ═══

完成任一 task 前，自問：

  [ ] 1. 這個改動是否讓某個 journey 往前一步？（若否，為何要做？）
  [ ] 2. 被動到的 enum 分支處理有用 switch + assertNever 嗎？
  [ ] 3. 新增頁面有處理 empty / loading / error / unauthorized 四種 state？
  [ ] 4. 新增 route 在 navigation 有入口連結嗎？
  [ ] 5. 被動到的 entity 詳情頁是否需要顯示反向關聯？

═══ Exit Criteria ═══

當你覺得「都做完了」，最後三步必須：

  1. 對照 User Journeys 逐一在瀏覽器走通
  2. 跑 audit:ux-drift script — 確認沒新漂移
  3. 派遣截圖驗證 agent / 自己截圖比對

沒跑完這三步 ≠ 完成。

核心心智模型：
  - DB allow ≠ feature ready
  - Tests pass ≠ UX done
  - Tasks checked off ≠ user can do the thing

完整規則見 docs/rules/ux-completeness.md
EOF

exit 0
