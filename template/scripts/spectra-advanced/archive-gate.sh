#!/usr/bin/env bash
# spectra-advanced: archive gate
#
# Validates a change before archive:
#   Check 1: Journey URL Touch — proposal's journey URLs map to touched files
#   Check 2: Schema-Types Drift — migration enum/column changes need shared types sync
#   Check 3: Exhaustiveness Drift — audit-ux-drift reports (warn only)
#   Check 4: Manual Review Kind Validation — `## 人工檢查` items must be checked or
#            (for `[discuss]` kind) carry a `(claude-discussed: <ISO>)` evidence trail
#   Check 5: Screenshot Quality Audit — review screenshots must be final-state,
#            schema-valid, and free of exploration/debug spillover
#
# Usage:
#   archive-gate.sh <change-name>
#
# Exit:
#   0 = pass
#   2 = block (one or more checks failed)

set -euo pipefail

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
# Prime the cache once so all subsequent git-diff consumers reuse it.
sux_touched_files --refresh >/dev/null

BLOCKED=false
MESSAGES=()

# --- Check 1: Journey URL Touch ---
if grep -q '^## User Journeys' "$PROPOSAL_FILE"; then
  BACKEND_ONLY=$(sux_extract_section "$PROPOSAL_FILE" 'User Journeys' \
    | grep -c 'No user-facing journey' 2>/dev/null || true)
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

    BYPASS_JOURNEY=$(sux_count_marker "$TASKS_FILE" 'journey-touch: intentional')

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
MIG_TOUCHED=$(sux_touched_files)
# bash 3.2 compatible array read (no mapfile/readarray).
ALL_MIGS_ARR=()
while IFS= read -r mig; do
  [ -n "$mig" ] && ALL_MIGS_ARR+=("$mig")
done < <(echo "$MIG_TOUCHED" | grep -E "^${SUX_MIGRATIONS_DIR}/.*\.sql$" | sort -u || true)

if [ "${#ALL_MIGS_ARR[@]}" -gt 0 ]; then
  HAS_ENUM_OR_COL=false
  for mig in "${ALL_MIGS_ARR[@]}"; do
    [ -z "$mig" ] && continue
    [ -f "$REPO_ROOT/$mig" ] || continue
    if grep -qiE "CHECK[[:space:]]*\([^)]*IN[[:space:]]*\(|ADD COLUMN|CREATE TYPE.*AS ENUM" "$REPO_ROOT/$mig" 2>/dev/null; then
      HAS_ENUM_OR_COL=true
      break
    fi
  done

  if [ "$HAS_ENUM_OR_COL" = true ]; then
    TYPES_MATCH=$(echo "$MIG_TOUCHED" | grep -cE "^${SUX_TYPES_PRIMARY}/.*\.ts$" || true)
    TYPES_MATCH=${TYPES_MATCH:-0}
    BYPASS_DRIFT=$(sux_count_marker "$TASKS_FILE" 'schema-drift: intentional')

    if [ "$TYPES_MATCH" -eq 0 ] && [ "$BYPASS_DRIFT" -eq 0 ]; then
      BLOCKED=true
      MESSAGES+=("[UX Gate] Schema-Types Drift 未通過 — migration 新增了欄位/enum，但 ${SUX_TYPES_PRIMARY}/ 沒同步更新。

涉及的 migration：
$(printf '  - %s\n' "${ALL_MIGS_ARR[@]}")

選項：
  1. 同步更新 ${SUX_TYPES_PRIMARY}/*.ts 對應的 enum / schema / interface
  2. 純 DB 操作不需 app 層變動 → 加 <!-- schema-drift: intentional, reason: ... --> 到 tasks.md")
    fi
  fi
fi

# --- Check 3: Exhaustiveness Drift (warn only) ---
AUDIT_SCRIPT="$REPO_ROOT/${SUX_SCRIPTS_DIR}/audit-ux-drift.mts"
if command -v node >/dev/null 2>&1 && [ -f "$AUDIT_SCRIPT" ]; then
  TOUCHED_TYPES=$(echo "$MIG_TOUCHED" | grep -cE "^${SUX_TYPES_PRIMARY}/.*\.ts$" || true)
  TOUCHED_TYPES=${TOUCHED_TYPES:-0}
  TOUCHED_UI=$(echo "$MIG_TOUCHED" | grep -cE "(${SUX_UI_EXT_RE})$" || true)
  TOUCHED_UI=${TOUCHED_UI:-0}

  if [ "$TOUCHED_TYPES" -gt 0 ] || [ "$TOUCHED_UI" -gt 0 ]; then
    # Use --json for robust parsing instead of grepping text output format.
    AUDIT_JSON=$(cd "$REPO_ROOT" && node "$AUDIT_SCRIPT" --json 2>/dev/null || true)
    if [ -n "$AUDIT_JSON" ] && command -v jq >/dev/null 2>&1; then
      DRIFT_COUNT=$(echo "$AUDIT_JSON" | jq -r '.findings | length' 2>/dev/null || echo 0)
      DRIFT_COUNT=${DRIFT_COUNT:-0}
      if [ "$DRIFT_COUNT" -gt 0 ]; then
        echo "[UX Gate] warn — audit-ux-drift 偵測到 ${DRIFT_COUNT} 個 enum exhaustiveness 漂移點（含既有）。" >&2
        echo "跑 \`pnpm audit:ux-drift\` 查看完整報告。" >&2
      fi
    fi
  fi
fi

# --- Check 4: Manual Review Kind Validation ---
# Spec: openspec/specs/manual-review-item-kind/spec.md "Archive Gate Validation By Kind"
#
# Decision matrix:
#   review:ui   [x]    -> pass
#   review:ui   [ ]    -> block (must be human-checked)
#   discuss     [x]    -> pass (claude-discussed annotation optional but expected)
#   discuss     [ ] +annotation -> warn (issue path; user's call)
#   discuss     [ ] no-annotation -> block (run /spectra-archive Step 2.5)
#   verify:auto [x]    -> pass
#   verify:auto [ ] +annotation -> warn (agent ran round-trip; user 還沒在 GUI 點 OK)
#   verify:auto [ ] no-annotation -> block (agent 沒跑或失敗；回 /spectra-apply Step 8a 重跑)
#
# Missing leading kind marker:
#   apply Default Kind Derivation Rule based on proposal's User Journeys section.
if [ -f "$TASKS_FILE" ]; then
  # Detect default kind from proposal: backend-only declaration -> discuss, else review:ui
  DEFAULT_KIND='review:ui'
  if grep -qF '**No user-facing journey (backend-only)**' "$PROPOSAL_FILE" 2>/dev/null; then
    DEFAULT_KIND='discuss'
  fi

  # Extract `## 人工檢查` section content; tolerate missing section.
  # Use awk (not sux_extract_section) because the latter's `sed '$d'` trims the last
  # line — which is the actual checkbox when 人工檢查 is the file's final section.
  KIND_SECTION=$(awk '
    /^## .*人工檢查/ { in_section=1; next }
    in_section && /^## / { in_section=0 }
    in_section { print }
  ' "$TASKS_FILE")

  if [ -n "$KIND_SECTION" ]; then
    # Walk each checkbox line under 人工檢查. Match parent `- [ ] #N` and scoped
    # `  - [ ] #N.M` lines. Other content (prose, blank lines) silently ignored.
    REVIEW_UI_BLOCKED=()
    DISCUSS_BLOCKED=()
    DISCUSS_WARN=()
    VERIFY_AUTO_BLOCKED=()
    VERIFY_AUTO_WARN=()

    while IFS= read -r line; do
      # Match parent OR scoped item; capture checkbox state + id + remainder.
      if [[ "$line" =~ ^[[:space:]]*-[[:space:]]\[([[:space:]xX])\][[:space:]]+(#[0-9]+(\.[0-9]+)?)[[:space:]]+(.*)$ ]]; then
        STATE="${BASH_REMATCH[1]}"
        ID="${BASH_REMATCH[2]}"
        REST="${BASH_REMATCH[4]}"
      else
        continue
      fi

      # Detect leading kind marker (must be first token after id).
      ITEM_KIND="$DEFAULT_KIND"
      if [[ "$REST" =~ ^\[(review:ui|discuss|verify:auto)\][[:space:]] ]]; then
        ITEM_KIND="${BASH_REMATCH[1]}"
      fi

      CHECKED=false
      if [[ "$STATE" =~ [xX] ]]; then
        CHECKED=true
      fi

      # claude-discussed / verified-auto annotations present?
      # bash [[ =~ ]] mishandles literal parens in regex — assign to a var first.
      HAS_DISCUSSED_ANNOTATION=false
      DISCUSSED_RE='\(claude-discussed:[^)]*\)'
      if [[ "$line" =~ $DISCUSSED_RE ]]; then
        HAS_DISCUSSED_ANNOTATION=true
      fi

      HAS_VERIFIED_AUTO_ANNOTATION=false
      VERIFIED_AUTO_RE='\(verified-auto:[^)]*\)'
      if [[ "$line" =~ $VERIFIED_AUTO_RE ]]; then
        HAS_VERIFIED_AUTO_ANNOTATION=true
      fi

      if [ "$ITEM_KIND" = 'review:ui' ]; then
        if [ "$CHECKED" = false ]; then
          REVIEW_UI_BLOCKED+=("$ID")
        fi
      elif [ "$ITEM_KIND" = 'verify:auto' ]; then
        if [ "$CHECKED" = false ]; then
          if [ "$HAS_VERIFIED_AUTO_ANNOTATION" = true ]; then
            VERIFY_AUTO_WARN+=("$ID")
          else
            VERIFY_AUTO_BLOCKED+=("$ID")
          fi
        fi
        # verify:auto [x]: pass (user 在 GUI 點過 OK = 雙層保險完成)
      else
        # discuss
        if [ "$CHECKED" = false ]; then
          if [ "$HAS_DISCUSSED_ANNOTATION" = true ]; then
            DISCUSS_WARN+=("$ID")
          else
            DISCUSS_BLOCKED+=("$ID")
          fi
        fi
        # discuss [x] (with or without annotation): pass (annotation expected but warn-only handled by other tooling)
      fi
    done <<< "$KIND_SECTION"

    if [ "${#REVIEW_UI_BLOCKED[@]}" -gt 0 ]; then
      BLOCKED=true
      for id in "${REVIEW_UI_BLOCKED[@]}"; do
        echo "[UX Gate] review:ui item not checked by user: $id" >&2
      done
      MESSAGES+=("[UX Gate] Manual Review Kind Validation 未通過 — 上述 [review:ui] 項目尚未經使用者親自勾選。
跑 \`pnpm review:ui\` 完成 round-trip 驗收後再 archive。")
    fi

    if [ "${#DISCUSS_BLOCKED[@]}" -gt 0 ]; then
      BLOCKED=true
      for id in "${DISCUSS_BLOCKED[@]}"; do
        echo "[UX Gate] discuss item lacks claude-discussed evidence trail: $id — run /spectra-archive to invoke Step 2.5 walkthrough" >&2
      done
      MESSAGES+=("[UX Gate] Manual Review Kind Validation 未通過 — 上述 [discuss] 項目尚未取得 (claude-discussed: <ISO>) evidence trail。
跑 \`/spectra-archive\` 觸發 Step 2.5 Discuss Items Walkthrough 後再 archive。")
    fi

    if [ "${#DISCUSS_WARN[@]}" -gt 0 ]; then
      for id in "${DISCUSS_WARN[@]}"; do
        echo "[UX Gate] warn — discuss item has claude-discussed annotation but checkbox unchecked (issue path): $id" >&2
      done
    fi

    if [ "${#VERIFY_AUTO_BLOCKED[@]}" -gt 0 ]; then
      BLOCKED=true
      for id in "${VERIFY_AUTO_BLOCKED[@]}"; do
        echo "[UX Gate] verify:auto item lacks verified-auto evidence trail: $id — agent 沒跑或 round-trip 失敗；run /spectra-apply to invoke Step 8a Verify-Auto Pass" >&2
      done
      MESSAGES+=("[UX Gate] Manual Review Kind Validation 未通過 — 上述 [verify:auto] 項目尚未取得 (verified-auto: <ISO> ...) evidence trail。
跑 \`/spectra-apply\` 觸發 Step 8a Verify-Auto Pass 後再 archive。")
    fi

    if [ "${#VERIFY_AUTO_WARN[@]}" -gt 0 ]; then
      for id in "${VERIFY_AUTO_WARN[@]}"; do
        echo "[UX Gate] warn — verify:auto item has verified-auto annotation but user 未在 review GUI 點 OK: $id" >&2
      done
    fi
  fi
fi

# --- Check 5: Screenshot Quality Audit ---
SCREENSHOT_AUDIT_SCRIPT="$REPO_ROOT/${SUX_SCRIPTS_DIR}/spectra-advanced/audit-screenshot-quality.mts"
if [ ! -f "$SCREENSHOT_AUDIT_SCRIPT" ] && [ -f "$REPO_ROOT/vendor/scripts/spectra-advanced/audit-screenshot-quality.mts" ]; then
  # clade source checkout verification path; consumers use scripts/spectra-advanced.
  SCREENSHOT_AUDIT_SCRIPT="$REPO_ROOT/vendor/scripts/spectra-advanced/audit-screenshot-quality.mts"
fi

if [ ! -f "$SCREENSHOT_AUDIT_SCRIPT" ]; then
  echo "[UX Gate] warn — screenshot quality audit script not found; skipping Check 5 (fail-open for pre-propagate consumers)." >&2
else
  SCREENSHOT_AUDIT_OUTPUT=""
  SCREENSHOT_AUDIT_STATUS=0
  if command -v pnpm >/dev/null 2>&1 && (cd "$REPO_ROOT" && pnpm exec tsx --version >/dev/null 2>&1); then
    SCREENSHOT_AUDIT_OUTPUT=$(cd "$REPO_ROOT" && pnpm exec tsx "$SCREENSHOT_AUDIT_SCRIPT" "$CHANGE_NAME" --fail-on-issues 2>&1) || SCREENSHOT_AUDIT_STATUS=$?
  elif command -v node >/dev/null 2>&1; then
    SCREENSHOT_AUDIT_OUTPUT=$(cd "$REPO_ROOT" && node --experimental-strip-types "$SCREENSHOT_AUDIT_SCRIPT" "$CHANGE_NAME" --fail-on-issues 2>&1) || SCREENSHOT_AUDIT_STATUS=$?
  else
    SCREENSHOT_AUDIT_STATUS=2
    SCREENSHOT_AUDIT_OUTPUT="node runtime not found"
  fi

  if [ "$SCREENSHOT_AUDIT_STATUS" -ne 0 ]; then
    BLOCKED=true
    if [ -n "$SCREENSHOT_AUDIT_OUTPUT" ]; then
      echo "$SCREENSHOT_AUDIT_OUTPUT" >&2
    fi
    MESSAGES+=("[UX Gate] Screenshot Quality Audit 未通過 — review pipeline 截圖存在 warning / critical 或 audit script error。
跑 \`node --experimental-strip-types scripts/spectra-advanced/audit-screenshot-quality.mts $CHANGE_NAME\` 查看完整報告；整理 final-state 截圖、移動探索圖到 _exploration/，或為 round-trip-only item 加上 @no-screenshot 後再 archive。")
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
