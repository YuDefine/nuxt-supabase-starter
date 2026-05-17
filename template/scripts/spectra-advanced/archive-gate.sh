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
# Precondition (per worktree-default.md §5.5 atomic landing): spectra-archive
# Step 0 MUST run `wt-helper merge-back <change-name>` first so any session
# worktree's committed work has landed on main's working tree before these
# gates inspect `git diff`. Without that, Check 1 (Journey URL Touch) and
# Check 2 (Schema-Types Drift) would see a false-clean main and produce
# misleading "all clear" archives that miss the worktree's actual changes.
# The archive skill's Step 0 ensures this; running this gate directly without
# Step 0 first is a recipe for false positives on worktree-implemented changes.
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
# Spec: clade docs/archives/openspec-specs/manual-review-item-kind/spec.md "Archive Gate Validation By Kind"
#
# Decision matrix:
#   review:ui      [x]                 -> pass
#   review:ui      [ ]                 -> block (must be human-checked)
#   discuss        [x]                 -> pass (claude-discussed annotation optional)
#   discuss        [ ] +annotation     -> warn (issue path; user's call)
#   discuss        [ ] no-annotation   -> block (run /spectra-archive Step 2.5)
#   verify:e2e     any +annotation     -> pass (automatic channel self-completes)
#   verify:e2e     any no-annotation   -> block
#   verify:api     any +annotation     -> pass (automatic channel self-completes)
#   verify:api     any no-annotation   -> block
#   verify:ui      [x] +annotation     -> pass
#   verify:ui      [ ] +annotation     -> block (awaiting user GUI confirmation)
#   verify:ui      any no-annotation   -> block
#   verify:auto                        -> deprecated alias for verify:api+ui
#
# Missing leading kind marker:
#   apply Default Kind Derivation Rule based on proposal's User Journeys section.
if [ -f "$TASKS_FILE" ]; then
  # Detect default kind from proposal: backend-only declaration -> discuss, else review:ui
  DEFAULT_KIND='review:ui'
  if grep -qF '**No user-facing journey (backend-only)**' "$PROPOSAL_FILE" 2>/dev/null; then
    DEFAULT_KIND='discuss'
  fi

  normalize_review_kinds() {
    local rest="$1"
    local id="$2"
    local line_number="$3"
    KINDS_RESULT=("$DEFAULT_KIND")

    if [[ "$rest" =~ ^\[([^]]+)\][[:space:]] ]]; then
      local marker="${BASH_REMATCH[1]}"
      case "$marker" in
        review:ui|discuss)
          KINDS_RESULT=("$marker")
          ;;
        verify:auto)
          echo "[UX Gate] verify:auto is deprecated; prefer verify:api+ui at $TASKS_FILE:$line_number ($id)" >&2
          KINDS_RESULT=('verify:api' 'verify:ui')
          ;;
        verify:*)
          local channels="${marker#verify:}"
          local remaining="$channels"
          local token
          local seen_e2e=false
          local seen_api=false
          local seen_ui=false
          while :; do
            token="${remaining%%+*}"
            case "$token" in
              e2e) seen_e2e=true ;;
              api) seen_api=true ;;
              ui) seen_ui=true ;;
              *)
                echo "[UX Gate] warn — unknown manual-review kind marker [$marker] at $TASKS_FILE:$line_number; falling back to $DEFAULT_KIND" >&2
                KINDS_RESULT=("$DEFAULT_KIND")
                return
                ;;
            esac
            [ "$remaining" = "$token" ] && break
            remaining="${remaining#*+}"
          done

          KINDS_RESULT=()
          [ "$seen_e2e" = true ] && KINDS_RESULT+=('verify:e2e')
          [ "$seen_api" = true ] && KINDS_RESULT+=('verify:api')
          [ "$seen_ui" = true ] && KINDS_RESULT+=('verify:ui')
          return 0
          ;;
        *)
          echo "[UX Gate] warn — unknown manual-review kind marker [$marker] at $TASKS_FILE:$line_number; falling back to $DEFAULT_KIND" >&2
          ;;
      esac
    fi
    return 0
  }

  format_kind_label() {
    local has_verify=false
    local has_non_verify=false
    local channels=()
    local labels=()
    local kind

    for kind in "${KINDS_RESULT[@]}"; do
      case "$kind" in
        verify:e2e) has_verify=true; channels+=('e2e'); labels+=("$kind") ;;
        verify:api) has_verify=true; channels+=('api'); labels+=("$kind") ;;
        verify:ui) has_verify=true; channels+=('ui'); labels+=("$kind") ;;
        *) has_non_verify=true; labels+=("$kind") ;;
      esac
    done

    if [ "$has_verify" = true ] && [ "$has_non_verify" = false ]; then
      local joined=''
      local channel
      for channel in "${channels[@]}"; do
        if [ -z "$joined" ]; then
          joined="$channel"
        else
          joined="$joined+$channel"
        fi
      done
      KIND_LABEL="verify:$joined"
      return
    fi

    KIND_LABEL=''
    for kind in "${labels[@]}"; do
      if [ -z "$KIND_LABEL" ]; then
        KIND_LABEL="$kind"
      else
        KIND_LABEL="$KIND_LABEL+$kind"
      fi
    done
    return 0
  }

  has_kind() {
    local needle="$1"
    local kind
    for kind in "${KINDS_RESULT[@]}"; do
      [ "$kind" = "$needle" ] && return 0
    done
    return 1
  }

  # Extract `## 人工檢查` section content; tolerate missing section.
  # Use awk (not sux_extract_section) because the latter's `sed '$d'` trims the last
  # line — which is the actual checkbox when 人工檢查 is the file's final section.
  KIND_SECTION=$(awk '
    /^## .*人工檢查/ { in_section=1; next }
    in_section && /^## / { in_section=0 }
    in_section { print NR "\t" $0 }
  ' "$TASKS_FILE")

  if [ -n "$KIND_SECTION" ]; then
    # Pre-pass: collect parent IDs that own at least one scoped child (`#N.M`).
    # Mirrors `buildParentsWithScopedChildren` in review-gui.mts so this hook
    # shares the same notion of "parent-with-children" as the GUI's
    # `requiresUserConfirmation()` carve-out. Parents whose semantic is fully
    # aggregated from scoped children MUST NOT be flagged for unchecked-checkbox
    # or missing-annotation independently — scoped children carry the evidence.
    # Uses a space-delimited string (bash 3.2-compatible, no associative arrays
    # — macOS /usr/bin/env bash is still 3.2).
    PARENT_HAS_CHILDREN_LIST=""
    while IFS=$'\t' read -r _pre_ln _pre_line; do
      if [[ "$_pre_line" =~ ^[[:space:]]*-[[:space:]]\[[[:space:]xX]\][[:space:]]+#([0-9]+)\.[0-9]+[[:space:]] ]]; then
        PARENT_HAS_CHILDREN_LIST="$PARENT_HAS_CHILDREN_LIST ${BASH_REMATCH[1]}"
      fi
    done <<< "$KIND_SECTION"

    # Walk each checkbox line under 人工檢查. Match parent `- [ ] #N` and scoped
    # `  - [ ] #N.M` lines. Other content (prose, blank lines) silently ignored.
    MANUAL_GATE_BLOCKED=false

    while IFS=$'\t' read -r line_number line; do
      # Match parent OR scoped item; capture checkbox state + id + remainder.
      if [[ "$line" =~ ^[[:space:]]*-[[:space:]]\[([[:space:]xX])\][[:space:]]+(#[0-9]+(\.[0-9]+)?)[[:space:]]+(.*)$ ]]; then
        STATE="${BASH_REMATCH[1]}"
        ID="${BASH_REMATCH[2]}"
        SCOPED_SUFFIX="${BASH_REMATCH[3]}"
        REST="${BASH_REMATCH[4]}"
      else
        continue
      fi

      # Skip parent-with-children: semantic fully aggregated from scoped children.
      # Aligns with review-gui.mts `requiresUserConfirmation()` returning false
      # for these parents so users cannot OK / Issue / Skip them directly.
      if [ -z "$SCOPED_SUFFIX" ]; then
        _parent_num="${ID#\#}"
        case " $PARENT_HAS_CHILDREN_LIST " in
          *" $_parent_num "*) continue ;;
        esac
      fi

      # Detect leading kind marker (must be first token after id), then resolve
      # `[verify:auto]` and `[verify:<a>+<b>]` into an independent kind array.
      KINDS_RESULT=()
      KIND_LABEL=''
      normalize_review_kinds "$REST" "$ID" "$line_number"
      format_kind_label

      CHECKED=false
      if [[ "$STATE" =~ [xX] ]]; then
        CHECKED=true
      fi

      # Evidence annotations present?
      # bash [[ =~ ]] mishandles literal parens in regex — assign to a var first.
      HAS_DISCUSSED_ANNOTATION=false
      DISCUSSED_RE='\(claude-discussed:[^)]*\)'
      if [[ "$line" =~ $DISCUSSED_RE ]]; then
        HAS_DISCUSSED_ANNOTATION=true
      fi

      HAS_VERIFIED_E2E_ANNOTATION=false
      VERIFIED_E2E_RE='\(verified-e2e:[^)]*\)'
      if [[ "$line" =~ $VERIFIED_E2E_RE ]]; then
        HAS_VERIFIED_E2E_ANNOTATION=true
      fi

      HAS_VERIFIED_API_ANNOTATION=false
      VERIFIED_API_RE='\(verified-api:[^)]*\)'
      if [[ "$line" =~ $VERIFIED_API_RE ]]; then
        HAS_VERIFIED_API_ANNOTATION=true
      fi

      HAS_VERIFIED_UI_ANNOTATION=false
      VERIFIED_UI_RE='\(verified-ui:[^)]*\)'
      if [[ "$line" =~ $VERIFIED_UI_RE ]]; then
        HAS_VERIFIED_UI_ANNOTATION=true
      fi

      if has_kind 'review:ui' && [ "$CHECKED" = false ]; then
        MANUAL_GATE_BLOCKED=true
        echo "[UX Gate] review:ui item not checked by user: $ID" >&2
      fi

      if has_kind 'discuss'; then
        if [ "$HAS_DISCUSSED_ANNOTATION" = false ]; then
          if [ "$CHECKED" = false ]; then
            MANUAL_GATE_BLOCKED=true
            echo "[UX Gate] discuss item lacks (claude-discussed: ...) annotation: $ID — run /spectra-archive to invoke Step 2.5 walkthrough" >&2
          else
            echo "[UX Gate] warn — discuss item checked without (claude-discussed: ...) annotation: $ID" >&2
          fi
        elif [ "$CHECKED" = false ]; then
          echo "[UX Gate] warn — discuss item has (claude-discussed: ...) annotation but checkbox unchecked (issue path): $ID" >&2
        fi
      fi

      if has_kind 'verify:e2e' && [ "$HAS_VERIFIED_E2E_ANNOTATION" = false ]; then
        MANUAL_GATE_BLOCKED=true
        echo "[UX Gate] $KIND_LABEL item lacks (verified-e2e: ...) annotation: $ID — run pnpm test:e2e:verify $CHANGE_NAME to produce the evidence" >&2
      fi

      if has_kind 'verify:api' && [ "$HAS_VERIFIED_API_ANNOTATION" = false ]; then
        MANUAL_GATE_BLOCKED=true
        echo "[UX Gate] $KIND_LABEL item lacks (verified-api: ...) annotation: $ID" >&2
      fi

      if has_kind 'verify:ui'; then
        if [ "$HAS_VERIFIED_UI_ANNOTATION" = false ]; then
          MANUAL_GATE_BLOCKED=true
          echo "[UX Gate] $KIND_LABEL item missing (verified-ui: ...) annotation: $ID" >&2
        elif [ "$CHECKED" = false ]; then
          MANUAL_GATE_BLOCKED=true
          echo "[UX Gate] $KIND_LABEL item awaits user GUI confirmation (verify:ui channel requires checkmark): $ID" >&2
        fi
      fi
    done <<< "$KIND_SECTION"

    if [ "$MANUAL_GATE_BLOCKED" = true ]; then
      BLOCKED=true
      MESSAGES+=("[UX Gate] Manual Review Kind Validation 未通過 — 上述人工檢查項目的 kind-specific evidence 或使用者確認尚未完成。
依 stderr 的 [UX Gate] kind 原因補齊 annotation、執行 \`pnpm review:ui\`，或跑對應 verify channel 後再 archive。")
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
