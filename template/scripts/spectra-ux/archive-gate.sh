#!/usr/bin/env bash
# spectra-ux: archive gate
#
# Validates a change before archive:
#   Check 1: Journey URL Touch — proposal's journey URLs map to touched files
#   Check 2: Schema-Types Drift — migration enum/column changes need shared types sync
#   Check 3: Exhaustiveness Drift — audit-ux-drift reports
#
# Usage:
#   archive-gate.sh <change-name>
#
# Exit:
#   0 = pass
#   2 = block (one or more checks failed)

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"
sux_load_config

CHANGE_NAME="${1:-}"
if [ -z "$CHANGE_NAME" ]; then
  CHANGE_DIR=$(sux_find_active_change) || exit 0
  CHANGE_NAME=$(basename "$CHANGE_DIR")
else
  CHANGE_DIR=$(sux_find_change_by_name "$CHANGE_NAME") || {
    echo "[UX Gate] change '$CHANGE_NAME' not found" >&2
    exit 0
  }
fi

PROPOSAL_FILE="$CHANGE_DIR/proposal.md"
TASKS_FILE="$CHANGE_DIR/tasks.md"
[ -f "$PROPOSAL_FILE" ] || exit 0

REPO_ROOT=$(sux_repo_root)
BLOCKED=false
MESSAGES=()

# --- Check 1: Journey URL Touch ---
if grep -q '^## User Journeys' "$PROPOSAL_FILE"; then
  BACKEND_ONLY=$(sed -n '/^## User Journeys/,/^## /p' "$PROPOSAL_FILE" 2>/dev/null | grep -c 'No user-facing journey' 2>/dev/null || true)
  BACKEND_ONLY=${BACKEND_ONLY:-0}

  if [ "$BACKEND_ONLY" -eq 0 ]; then
    JOURNEY_URLS=$(sux_extract_journey_urls "$PROPOSAL_FILE")

    MISSING=()
    while IFS= read -r url; do
      [ -z "$url" ] && continue
      sux_url_has_page "$url" || continue
      if ! sux_check_url_touched "$url"; then
        MISSING+=("$url")
      fi
    done <<< "$JOURNEY_URLS"

    BYPASS_JOURNEY=0
    if [ -f "$TASKS_FILE" ]; then
      BYPASS_JOURNEY=$(grep -c 'journey-touch: intentional' "$TASKS_FILE" 2>/dev/null || true)
      BYPASS_JOURNEY=${BYPASS_JOURNEY:-0}
    fi

    if [ "${#MISSING[@]}" -gt 0 ] && [ "$BYPASS_JOURNEY" -eq 0 ]; then
      BLOCKED=true
      MESSAGES+=("[UX Gate] Journey URL Touch 未通過 — proposal 列出的 User Journey URL 沒對應到 git diff 中的 UI 檔案。

未觸動的 URL：
$(printf '  - %s\n' "${MISSING[@]}")

選項：
  1. 實作這些頁面的改動
  2. 在 proposal Non-Goals 排除並移除 journey
  3. 加入 <!-- journey-touch: intentional, reason: ... --> 到 tasks.md 繞過")
    fi
  fi
fi

# --- Check 2: Schema-Types Drift ---
MIG_TOUCHED=$(git diff --name-only HEAD 2>/dev/null; git diff --cached --name-only 2>/dev/null)
ALL_MIGS=$(echo "$MIG_TOUCHED" | grep -E "^${SUX_MIGRATIONS_DIR}/.*\.sql$" | sort -u || true)

if [ -n "$ALL_MIGS" ]; then
  HAS_ENUM_OR_COL=false
  while IFS= read -r mig; do
    [ -z "$mig" ] && continue
    [ -f "$REPO_ROOT/$mig" ] || continue
    if grep -qiE "CHECK[[:space:]]*\([^)]*IN[[:space:]]*\(|ADD COLUMN|CREATE TYPE.*AS ENUM" "$REPO_ROOT/$mig" 2>/dev/null; then
      HAS_ENUM_OR_COL=true
      break
    fi
  done <<< "$ALL_MIGS"

  if [ "$HAS_ENUM_OR_COL" = true ]; then
    TYPES_PRIMARY="${SUX_TYPES_DIRS%% *}"
    TYPES_MATCH=$(echo "$MIG_TOUCHED" | grep -cE "^${TYPES_PRIMARY}/.*\.ts$" || true)
    TYPES_MATCH=${TYPES_MATCH:-0}

    BYPASS_DRIFT=0
    if [ -f "$TASKS_FILE" ]; then
      BYPASS_DRIFT=$(grep -c 'schema-drift: intentional' "$TASKS_FILE" 2>/dev/null || true)
      BYPASS_DRIFT=${BYPASS_DRIFT:-0}
    fi

    if [ "$TYPES_MATCH" -eq 0 ] && [ "$BYPASS_DRIFT" -eq 0 ]; then
      BLOCKED=true
      MESSAGES+=("[UX Gate] Schema-Types Drift 未通過 — migration 新增了欄位/enum，但 ${TYPES_PRIMARY}/ 沒同步更新。

涉及的 migration：
$(printf '  - %s\n' $ALL_MIGS)

選項：
  1. 同步更新 ${TYPES_PRIMARY}/*.ts 對應的 enum / schema / interface
  2. 純 DB 操作不需 app 層變動 → 加 <!-- schema-drift: intentional, reason: ... --> 到 tasks.md")
    fi
  fi
fi

# --- Check 3: Exhaustiveness Drift (warn only) ---
AUDIT_SCRIPT="$REPO_ROOT/${SUX_SCRIPTS_DIR}/audit-ux-drift.mts"
if command -v node >/dev/null 2>&1 && [ -f "$AUDIT_SCRIPT" ]; then
  TOUCHED_TYPES=$(echo "$MIG_TOUCHED" | grep -cE "^${SUX_TYPES_DIRS%% *}/.*\.ts$" || true)
  TOUCHED_TYPES=${TOUCHED_TYPES:-0}
  TOUCHED_VUE=$(echo "$MIG_TOUCHED" | grep -cE "${SUX_UI_EXT}$" || true)
  TOUCHED_VUE=${TOUCHED_VUE:-0}

  if [ "$TOUCHED_TYPES" -gt 0 ] || [ "$TOUCHED_VUE" -gt 0 ]; then
    AUDIT_OUT=$(cd "$REPO_ROOT" && node "$AUDIT_SCRIPT" 2>&1 || true)
    if echo "$AUDIT_OUT" | grep -q '^✗'; then
      DRIFT_COUNT=$(echo "$AUDIT_OUT" | grep -c '^  [^ ]' || true)
      DRIFT_COUNT=${DRIFT_COUNT:-0}
      echo "[UX Gate] warn — audit-ux-drift 偵測到 ${DRIFT_COUNT} 個 enum exhaustiveness 漂移點（含既有）。" >&2
      echo "跑 \`pnpm audit:ux-drift\` 查看完整報告。" >&2
    fi
  fi
fi

# --- Output ---
if [ "$BLOCKED" = true ]; then
  for msg in "${MESSAGES[@]}"; do
    echo "$msg"
    echo ""
  done
  exit 2
fi

exit 0
