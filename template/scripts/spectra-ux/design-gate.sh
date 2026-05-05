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

  # Structural check: Design Review section must have 7-step template (N.1~N.7)
  STRUCTURAL_DRIFT=()
  DR_TASK_LINES=0
  if [ -n "$DESIGN_SECTION" ]; then
    DR_TASK_LINES=$(printf '%s\n' "$DESIGN_SECTION" | grep -cE '^\- \[[ x]\]' || true)
    DR_TASK_LINES=${DR_TASK_LINES:-0}

    printf '%s\n' "$DESIGN_SECTION" | grep -qiE 'PRODUCT\.md|DESIGN\.md|impeccable teach|impeccable document' || STRUCTURAL_DRIFT+=('N.1 PRODUCT.md / DESIGN.md 檢查')
    printf '%s\n' "$DESIGN_SECTION" | grep -qiE '/design improve|design improve|Fidelity Report' || STRUCTURAL_DRIFT+=('N.2 /design improve + Fidelity Report')
    printf '%s\n' "$DESIGN_SECTION" | grep -qiE 'DRIFT|loop|修復.*DRIFT|fix.*DRIFT' || STRUCTURAL_DRIFT+=('N.3 修復 DRIFT loop')
    printf '%s\n' "$DESIGN_SECTION" | grep -qiE 'canonical order|targeted.*skills|impeccable skills|layout.*typeset|typeset.*colorize' || STRUCTURAL_DRIFT+=('N.4 按 canonical order 跑 targeted impeccable skills')
    printf '%s\n' "$DESIGN_SECTION" | grep -qiE '/impeccable audit|impeccable audit|Critical = 0|Critical=0' || STRUCTURAL_DRIFT+=('N.5 /impeccable audit Critical = 0')
    printf '%s\n' "$DESIGN_SECTION" | grep -qiE 'review-screenshot|screenshot review|視覺 QA' || STRUCTURAL_DRIFT+=('N.6 review-screenshot 視覺 QA')
    printf '%s\n' "$DESIGN_SECTION" | grep -qiE 'Fidelity 確認|Fidelity check|無 DRIFT 項|無 DRIFT|DRIFT = 0' || STRUCTURAL_DRIFT+=('N.7 Fidelity 確認')

    # Task line count check: section exists but task count < 7 (N.1~N.7 not all present)
    if [ "$DR_TASK_LINES" -lt 7 ]; then
      STRUCTURAL_DRIFT+=("Design Review section 僅有 ${DR_TASK_LINES} 個 task line（需要 7 個 N.1~N.7 checkbox）")
    fi
  fi

  if [ "$DESIGN_PASSED" = false ] && [ -n "$DESIGN_SECTION" ]; then
    DR_UNCHECKED=$(printf '%s\n' "$DESIGN_SECTION" | grep -c '^\- \[ \]' || true)
    DR_UNCHECKED=${DR_UNCHECKED:-0}
    if [ "$DR_UNCHECKED" -eq 0 ] && [ "${#STRUCTURAL_DRIFT[@]}" -eq 0 ]; then
      DESIGN_PASSED=true
    fi
  fi

  # Block if UI change is missing the entire Design Review section
  if [ -z "$DESIGN_SECTION" ]; then
    BLOCKED=true
    MESSAGES+=("[Design Gate] UI change 的 tasks.md 缺少 \`## Design Review\` 區塊。

UI 變更（觸動 .vue / pages / components / layouts）必須包含完整 7 步 Design Review template：

  - [ ] N.1 檢查 PRODUCT.md（必要）+ DESIGN.md（建議）；缺 PRODUCT.md 跑 /impeccable teach、缺 DESIGN.md 跑 /impeccable document
  - [ ] N.2 執行 /design improve [affected pages/components]，產出 Design Fidelity Report
  - [ ] N.3 修復所有 DRIFT 項目（Fidelity Score < 8/8 時必做，loop 直到 DRIFT = 0，max 2 輪）
  - [ ] N.4 依 /design improve 計劃按 canonical order 執行 targeted impeccable skills
  - [ ] N.5 執行 /impeccable audit，確認 Critical = 0
  - [ ] N.6 執行 review-screenshot，補 design-review.md / 視覺 QA 證據
  - [ ] N.7 Fidelity 確認 — design-review.md 中無 DRIFT 項

完整規格見 \`ux-completeness.md\` Design Review Task Template。可跑 \`pnpm spectra:upgrade-design-review\` 自動補齊（若 consumer 未 wire 此 script，改跑 \`node scripts/spectra-ux/upgrade-design-review.mts\`）。")
  fi

  # Block if Design Review section structure is incomplete (independent of completion)
  if [ -n "$DESIGN_SECTION" ] && [ "${#STRUCTURAL_DRIFT[@]}" -gt 0 ]; then
    BLOCKED=true
    MESSAGES+=("[Design Gate] tasks.md 的 \`## Design Review\` 區塊不符合 7 步 template，缺以下步驟：

$(printf '  - %s\n' "${STRUCTURAL_DRIFT[@]}")

請補齊 N.1~N.7 完整 7 步 template（完整規格見 \`ux-completeness.md\` Design Review Task Template）：

  - [ ] N.1 檢查 PRODUCT.md（必要）+ DESIGN.md（建議）；缺 PRODUCT.md 跑 /impeccable teach、缺 DESIGN.md 跑 /impeccable document
  - [ ] N.2 執行 /design improve [affected pages/components]，產出 Design Fidelity Report
  - [ ] N.3 修復所有 DRIFT 項目（Fidelity Score < 8/8 時必做，loop 直到 DRIFT = 0，max 2 輪）
  - [ ] N.4 依 /design improve 計劃按 canonical order 執行 targeted impeccable skills
  - [ ] N.5 執行 /impeccable audit，確認 Critical = 0
  - [ ] N.6 執行 review-screenshot，補 design-review.md / 視覺 QA 證據
  - [ ] N.7 Fidelity 確認 — design-review.md 中無 DRIFT 項

可跑 \`pnpm spectra:upgrade-design-review\` 自動補齊既有 change（若 consumer 未 wire 此 script，改跑 \`node scripts/spectra-ux/upgrade-design-review.mts\`）。")
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
    # NOTE: tasks.md 缺少 ## Design Review 區塊的情況已在前面獨立 block 處理，
    # 這裡不再重複加 FAIL_REASON，避免訊息重複出現。

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
