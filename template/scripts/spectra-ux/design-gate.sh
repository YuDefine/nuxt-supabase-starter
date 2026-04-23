#!/usr/bin/env bash
# spectra-ux: design gate
#
# Blocks archive when:
#   1. Manual review section exists but still has unchecked items
#   2. UI changes lack design review evidence
#
# Usage:
#   design-gate.sh <change-name>
#
# Exit:
#   0 = pass
#   2 = block

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

BLOCKED=false
MESSAGES=()
CHANGE_NAME=$(basename "$CHANGE_DIR")

HAS_UI=false
if sux_tasks_has_ui_scope "$TASKS_FILE"; then
  HAS_UI=true
fi

if [ "$HAS_UI" = true ]; then
  MANUAL_SECTION=$(sed -n '/^## .*人工檢查/,/^## /p' "$TASKS_FILE" 2>/dev/null | sed '$d')
  if [ -z "$MANUAL_SECTION" ]; then
    MANUAL_SECTION=$(sed -n '/^## .*Manual Review/,/^## /p' "$TASKS_FILE" 2>/dev/null | sed '$d')
  fi

  if [ -n "$MANUAL_SECTION" ]; then
    UNCHECKED=$(printf '%s\n' "$MANUAL_SECTION" | grep -c '^\- \[ \]' || true)
    UNCHECKED=${UNCHECKED:-0}
    if [ "$UNCHECKED" -gt 0 ]; then
      BLOCKED=true
      MESSAGES+=("[Design Gate] 人工檢查尚未完成：${UNCHECKED} 個項目仍未確認。

請先展示截圖或其他驗收證據，逐項取得使用者確認後再勾選。禁止由 agent 直接代勾 ## 人工檢查。")
    fi
  else
    BLOCKED=true
    MESSAGES+=("[Design Gate] tasks.md 缺少 ## 人工檢查 / ## Manual Review 區塊。請先補齊人工檢查項目，再進行 archive。")
  fi

  DESIGN_PASSED=false
  DESIGN_REVIEW_FILE="$CHANGE_DIR/design-review.md"

  if [ -f "$DESIGN_REVIEW_FILE" ]; then
    LINE_COUNT=$(wc -l < "$DESIGN_REVIEW_FILE" | tr -d ' ')
    HAS_SCREENSHOT=$(grep -ciE '\.png|\.jpg|\.jpeg|screenshot|screenshots/|截圖' "$DESIGN_REVIEW_FILE" 2>/dev/null || true)
    HAS_SCREENSHOT=${HAS_SCREENSHOT:-0}
    HAS_FIDELITY=$(grep -ciE 'Design Fidelity Report|Fidelity Score' "$DESIGN_REVIEW_FILE" 2>/dev/null || true)
    HAS_FIDELITY=${HAS_FIDELITY:-0}
    HAS_UNRESOLVED_DRIFT=$(grep -ciE '^\| .* \| DRIFT \|' "$DESIGN_REVIEW_FILE" 2>/dev/null || true)
    HAS_UNRESOLVED_DRIFT=${HAS_UNRESOLVED_DRIFT:-0}

    if [ "$LINE_COUNT" -ge 10 ] && [ "$HAS_SCREENSHOT" -gt 0 ] && [ "$HAS_FIDELITY" -gt 0 ] && [ "$HAS_UNRESOLVED_DRIFT" -eq 0 ]; then
      DESIGN_PASSED=true
    fi
  fi

  DESIGN_SECTION=$(sed -n '/^## .*Design Review/,/^## /p' "$TASKS_FILE" 2>/dev/null | sed '$d')
  if [ "$DESIGN_PASSED" = false ] && [ -n "$DESIGN_SECTION" ]; then
    DR_UNCHECKED=$(printf '%s\n' "$DESIGN_SECTION" | grep -c '^\- \[ \]' || true)
    DR_UNCHECKED=${DR_UNCHECKED:-0}
    if [ "$DR_UNCHECKED" -eq 0 ]; then
      DESIGN_PASSED=true
    fi
  fi

  if [ "$DESIGN_PASSED" = false ]; then
    BLOCKED=true

    FAIL_REASONS=()
    if [ ! -f "$DESIGN_REVIEW_FILE" ]; then
      FAIL_REASONS+=("  - 缺少 design-review.md")
    else
      if [ "${LINE_COUNT:-0}" -lt 10 ]; then
        FAIL_REASONS+=("  - design-review.md 內容不足（< 10 行）")
      fi
      if [ "${HAS_SCREENSHOT:-0}" -eq 0 ]; then
        FAIL_REASONS+=("  - design-review.md 缺少截圖證據")
      fi
      if [ "${HAS_FIDELITY:-0}" -eq 0 ]; then
        FAIL_REASONS+=("  - design-review.md 缺少 Design Fidelity Report / Fidelity Score")
      fi
      if [ "${HAS_UNRESOLVED_DRIFT:-0}" -gt 0 ]; then
        FAIL_REASONS+=("  - design-review.md 仍有未修復 DRIFT 項目")
      fi
    fi
    if [ -z "$DESIGN_SECTION" ]; then
      FAIL_REASONS+=("  - tasks.md 缺少 ## Design Review 區塊")
    fi

    MESSAGES+=("[Design Gate] UI 變更缺少足夠的設計審查證據。

$(printf '%s\n' "${FAIL_REASONS[@]}")

需要至少滿足以下任一條件：
  1. design-review.md 有實質內容（>=10 行 + 截圖證據 + Fidelity Report + 無未修復 DRIFT）
  2. tasks.md 的 ## Design Review 區塊全部完成，且人工檢查已取得使用者確認

建議流程：
  - 執行 /design improve [affected pages/components]
  - 修復 DRIFT 項目並補 screenshot review 證據
  - 更新 design-review.md
  - 逐項完成 Design Review 與人工檢查")
  fi
fi

if [ "$BLOCKED" = true ]; then
  for msg in "${MESSAGES[@]}"; do
    echo "$msg"
    echo ""
  done
  exit 2
fi

exit 0
