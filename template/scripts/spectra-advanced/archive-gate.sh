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
#            schema-valid, and free of exploration/debug spillover.
#            When verify-channel annotations are missing, emits [AUTO-REMEDIATE]
#            directive telling Claude to self-collect evidence per Step 8a
#            fallback chain, NOT ask the user.
#   Check 6: Stale Verified-UI Screenshot — verified-ui annotation timestamp
#            must be AFTER the last commit on the depicted .vue file.
#            Catches: ingest adds UI polish → old screenshots survive → user
#            sees pre-polish UI in review GUI.
#   Check 6b: Seed Baseline Advisory — verify annotations may reference entity
#            IDs (UUIDs, integers in API paths) created ephemerally via API for
#            evidence screenshots. After `supabase db reset` those entities vanish
#            and screenshots become stale. Cross-checks IDs against seed.sql;
#            advisory-only (never blocks). TD-196.
#   Check 7: Pre-handoff Verdict Presence — the Layer E.1 self-analysis verdict
#            (spectra-apply Step 8a.6) must be recorded to the pre-handoff
#            ledger before archive. Mechanical backstop so the soft self-record
#            step actually fires (it landed 0 rows in 9 days of soak); fail-open
#            when the ledger file is absent (pre-propagation / no soak history).
#   Check 8: Residency Decision Presence — an Orchestration Residency decision
#            (codex-primary vs claude-primary, agent-routing § Orchestration
#            Residency) must be recorded to the residency ledger before archive.
#            Mechanical backstop for the soft classify-before-apply step
#            (adoption audit: 1/3 fire rate); fail-open when the ledger file is
#            absent (gradual onset).
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
#   archive-gate.sh [--pre-skill] <change-name>
#
# Flags:
#   --pre-skill   Skip Check 4 (Manual Review Kind Validation). Use when the
#                 gate runs as a PreToolUse:Skill hook for spectra-archive
#                 BEFORE the skill's Step 3.5 Discuss Items Walkthrough has
#                 populated `(claude-discussed: ...)` annotations. Without
#                 this flag, an unchecked `[discuss]` item with no annotation
#                 would block the very skill that populates the annotation
#                 (chicken-and-egg). Post-walkthrough validation runs the
#                 gate again without this flag at SKILL.md Step 5.5.
#                 Checks 1/2/3/5/6/7/8 (real pre-conditions) always run.
#
# Exit:
#   0 = pass
#   2 = block (one or more checks failed)

set -euo pipefail

PRE_SKILL=false
POSITIONAL=()
while [ $# -gt 0 ]; do
  case "$1" in
    --pre-skill) PRE_SKILL=true; shift ;;
    --) shift; while [ $# -gt 0 ]; do POSITIONAL+=("$1"); shift; done ;;
    -*) echo "[UX Gate] unknown flag: $1" >&2; exit 2 ;;
    *) POSITIONAL+=("$1"); shift ;;
  esac
done
set -- "${POSITIONAL[@]+"${POSITIONAL[@]}"}"

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
    # TD-190: 用 SUX_TYPES_DIRS_RE（含 monorepo packages/*/shared/{types,schemas}
    # 加廣路徑）比對，不只 repo-root 的 SUX_TYPES_PRIMARY — monorepo consumer 的
    # types 同步在 packages/ 下時不該 false positive。
    TYPES_MATCH=$(echo "$MIG_TOUCHED" | grep -cE "^(${SUX_TYPES_DIRS_RE})/.*\.ts$" || true)
    TYPES_MATCH=${TYPES_MATCH:-0}
    BYPASS_DRIFT=$(sux_count_marker "$TASKS_FILE" 'schema-drift: intentional')

    if [ "$TYPES_MATCH" -eq 0 ] && [ "$BYPASS_DRIFT" -eq 0 ]; then
      BLOCKED=true
      MESSAGES+=("[UX Gate] Schema-Types Drift 未通過 — migration 新增了欄位/enum，但 types 目錄（${SUX_TYPES_DIRS}）沒同步更新。

涉及的 migration：
$(printf '  - %s\n' "${ALL_MIGS_ARR[@]}")

選項：
  1. 同步更新 types 目錄（${SUX_TYPES_DIRS}）內對應的 enum / schema / interface
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
# Skipped under --pre-skill (see header comment): annotations are populated by
# spectra-archive SKILL.md Step 3.5 walkthrough, which runs AFTER this hook.
# Post-walkthrough validation re-runs the gate without --pre-skill at Step 5.5.
if [ "$PRE_SKILL" != "true" ]; then
# Spec: clade docs/archives/openspec-specs/manual-review-item-kind/spec.md "Archive Gate Validation By Kind"
#
# Decision matrix:
#   review:ui      [x]                 -> pass
#   review:ui      [ ]                 -> block (must be human-checked)
#   discuss        [x] +claude-discussed -> pass (walkthrough evidence trail)
#   discuss        [x] +deferred-to-handoff -> pass (External signal pending; entry in HANDOFF.md)
#   discuss        [x] no-annotation   -> warn (legacy / pre-rule check)
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

      HAS_DEFERRED_ANNOTATION=false
      DEFERRED_RE='\(deferred-to-handoff:[^)]*\)'
      if [[ "$line" =~ $DEFERRED_RE ]]; then
        HAS_DEFERRED_ANNOTATION=true
      fi

      HAS_VERIFIED_E2E_ANNOTATION=false
      VERIFIED_E2E_MALFORMED=false
      VERIFIED_E2E_RE='\(verified-e2e:[^)]*\)'
      if [[ "$line" =~ $VERIFIED_E2E_RE ]]; then
        VERIFIED_E2E_BODY="${BASH_REMATCH[0]}"
        # Require both spec= and trace= tokens inside the annotation body.
        # Without this the gate accepts spec-only annotations that silently
        # degrade the evidence trail (replayable Playwright trace missing).
        if [[ "$VERIFIED_E2E_BODY" == *"spec="* && "$VERIFIED_E2E_BODY" == *"trace="* ]]; then
          HAS_VERIFIED_E2E_ANNOTATION=true
        else
          VERIFIED_E2E_MALFORMED=true
        fi
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
        # Valid evidence trail: (claude-discussed:) OR (deferred-to-handoff:) — either counts.
        # deferred path means External signal pending; entry lives in HANDOFF.md awaiting signal,
        # archive proceeds. Resume mode (re-run /spectra-archive after signal occurs) will
        # translate (deferred-to-handoff:) → (claude-discussed:) / (issue) / (skip).
        HAS_VALID_DISCUSS_ANNOTATION=false
        if [ "$HAS_DISCUSSED_ANNOTATION" = true ] || [ "$HAS_DEFERRED_ANNOTATION" = true ]; then
          HAS_VALID_DISCUSS_ANNOTATION=true
        fi

        if [ "$HAS_VALID_DISCUSS_ANNOTATION" = false ]; then
          if [ "$CHECKED" = false ]; then
            MANUAL_GATE_BLOCKED=true
            echo "[UX Gate] discuss item lacks (claude-discussed: ...) or (deferred-to-handoff: ...) annotation: $ID — run /spectra-archive to invoke Step 2.5 walkthrough" >&2
          else
            echo "[UX Gate] warn — discuss item checked without (claude-discussed: ...) or (deferred-to-handoff: ...) annotation: $ID" >&2
          fi
        elif [ "$CHECKED" = false ]; then
          echo "[UX Gate] warn — discuss item has evidence annotation but checkbox unchecked (issue path): $ID" >&2
        fi
      fi

      if has_kind 'verify:e2e' && [ "$HAS_VERIFIED_E2E_ANNOTATION" = false ]; then
        MANUAL_GATE_BLOCKED=true
        if [ "$VERIFIED_E2E_MALFORMED" = true ]; then
          echo "[UX Gate] $KIND_LABEL item has malformed (verified-e2e: ...) — must contain both spec=<path> and trace=<path>: $ID" >&2
        else
          echo "[UX Gate] $KIND_LABEL item lacks (verified-e2e: ...) annotation: $ID — run pnpm test:e2e:verify $CHANGE_NAME to produce the evidence" >&2
        fi
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
fi  # end Check 4 PRE_SKILL guard

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
  if command -v node >/dev/null 2>&1; then
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
    # Extract verify-channel-specific missing annotations from audit output for auto-remediation hint
    VERIFY_MISSING=""
    if echo "$SCREENSHOT_AUDIT_OUTPUT" | grep -qE 'missing_verify_(api|ui|e2e)_annotation'; then
      VERIFY_MISSING=$(echo "$SCREENSHOT_AUDIT_OUTPUT" | grep -E 'missing_verify_(api|ui|e2e)_annotation' | sed 's/^- \[critical\] /  /')
    fi

    if [ -n "$VERIFY_MISSING" ]; then
      MESSAGES+=("[UX Gate] Screenshot Quality Audit 未通過 — verify channel evidence 缺失。

[AUTO-REMEDIATE] Claude MUST 自己補 evidence，不要問 user：
依 spectra-apply Step 8a Verify Channel Pass + main-self-collect-fallback-chain (a)(b)(c)(d) 對以下 items 收集 evidence，全失敗才寫 deferred annotation：
$VERIFY_MISSING

完成後重跑 archive。per [[agent-self-verification]] + [[pitfall-verify-evidence-handoff-instead-of-self-collect]]：evidence collection 是 agent 預設職責，review-gui 補 evidence prompt 是 fallback 不是 default。")
    else
      MESSAGES+=("[UX Gate] Screenshot Quality Audit 未通過 — review pipeline 截圖存在 warning / critical 或 audit script error。
跑 \`node --experimental-strip-types scripts/spectra-advanced/audit-screenshot-quality.mts $CHANGE_NAME\` 查看完整報告；整理 final-state 截圖、移動探索圖到 _exploration/，或為 round-trip-only item 加上 @no-screenshot 後再 archive。")
    fi
  fi
fi

# --- Check 6: Stale Verified-UI Screenshot Detection ---
# Screenshots taken before the latest code change to the depicted page are stale.
# Catches the recurring pattern: ingest adds UI polish → old verified-ui annotations
# and screenshots survive → user sees pre-polish screenshots in review GUI.
if [ -f "$TASKS_FILE" ]; then
  STALE_ITEMS=()

  # Helper: resolve URL path to on-disk .vue file, echo path or empty
  _resolve_url_to_vue() {
    local url_path="$1" root ui_dir ext candidate
    root=$(sux_repo_root)
    # strip leading slash for path join
    url_path="${url_path#/}"
    for ui_dir in $SUX_UI_DIRS; do
      for ext in $SUX_UI_EXTS; do
        candidate="$root/${ui_dir}/${url_path}${ext}"
        [ -f "$candidate" ] && { echo "${ui_dir}/${url_path}${ext}"; return 0; }
        candidate="$root/${ui_dir}/${url_path}/index${ext}"
        [ -f "$candidate" ] && { echo "${ui_dir}/${url_path}/index${ext}"; return 0; }
      done
    done
    # Try dynamic route segments: /admin/foo/mock-emp-1 → /admin/foo/[employee].vue
    local parent dir_candidate
    parent=$(dirname "$url_path")
    for ui_dir in $SUX_UI_DIRS; do
      for ext in $SUX_UI_EXTS; do
        # glob for [param].ext in the parent dir
        for dir_candidate in "$root/${ui_dir}/${parent}/"[*]"${ext}"; do
          [ -f "$dir_candidate" ] && {
            echo "${dir_candidate#$root/}"
            return 0
          }
        done
      done
    done
    return 1
  }

  # Extract manual-review section and scan for verified-ui annotations
  IN_MR=false
  LINE_NUM=0
  while IFS= read -r line; do
    LINE_NUM=$((LINE_NUM + 1))
    # Enter manual review section
    if [[ "$line" =~ ^##[[:space:]]+人工檢查 ]]; then
      IN_MR=true
      continue
    fi
    # Exit on next H2
    if [ "$IN_MR" = true ] && [[ "$line" =~ ^##[[:space:]] ]] && ! [[ "$line" =~ ^##[[:space:]]+人工檢查 ]]; then
      break
    fi
    [ "$IN_MR" = true ] || continue

    # Only process lines with verified-ui annotation
    [[ "$line" =~ \(verified-ui:[[:space:]]*([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]+Z?) ]] || continue
    local_annotation_ts="${BASH_REMATCH[1]}"

    # Extract item id (#N or #N.M)
    item_id=""
    if [[ "$line" =~ \#([0-9]+(\.[0-9]+)?) ]]; then
      item_id="#${BASH_REMATCH[1]}"
    fi

    # Extract URL from description (strip host, keep path before query/backtick)
    url_path=""
    if [[ "$line" =~ https?://[^/]+(/[^\`\?[:space:]]+) ]]; then
      url_path="${BASH_REMATCH[1]}"
      # strip trailing backtick/quote artifacts
      url_path="${url_path%\`}"
      url_path="${url_path%\"}"
      url_path="${url_path%\'}"
    fi

    [ -n "$url_path" ] || continue

    # Resolve URL to .vue file
    vue_file=$(_resolve_url_to_vue "$url_path") || continue
    [ -n "$vue_file" ] || continue

    # Get last commit time of the .vue file
    vue_commit_ts=$(cd "$REPO_ROOT" && git log -1 --format='%aI' -- "$vue_file" 2>/dev/null)
    [ -n "$vue_commit_ts" ] || continue

    # Compare timestamps — use node for reliable timezone-aware epoch conversion.
    # macOS `date -j` cannot parse ISO 8601 with timezone offset (+08:00);
    # stripping the offset (old approach) compares local time against UTC → false positive.
    ann_epoch=$(node -e "const d=Date.parse(process.argv[1]);isNaN(d)||process.stdout.write(String(d/1000))" "$local_annotation_ts" 2>/dev/null)
    vue_epoch=$(node -e "const d=Date.parse(process.argv[1]);isNaN(d)||process.stdout.write(String(d/1000))" "$vue_commit_ts" 2>/dev/null)

    [ -n "$ann_epoch" ] && [ -n "$vue_epoch" ] || continue

    if [ "$ann_epoch" -lt "$vue_epoch" ]; then
      STALE_ITEMS+=("${item_id:-?} — screenshot ${local_annotation_ts} < code ${vue_commit_ts} (${vue_file})")
    fi
  done < "$TASKS_FILE"

  if [ "${#STALE_ITEMS[@]}" -gt 0 ]; then
    BLOCKED=true
    MESSAGES+=("[UX Gate] Stale Screenshot Detection 未通過 — ${#STALE_ITEMS[@]} 張 verified-ui 截圖早於對應 .vue 檔的最後 commit，可能顯示舊版 UI。

需重拍的項目：
$(printf '  - %s\n' "${STALE_ITEMS[@]}")

修正方式：重跑 verify:ui channel 對這些 items 拍 fresh screenshot（從 worktree 起 dev server + 重新截圖），更新 (verified-ui: <新 ISO>) annotation timestamp。完成後重跑 archive。")
  fi
fi

# --- Check 6b: Seed Baseline Advisory (TD-196) ---
# Advisory-only: never sets BLOCKED=true.
# Runs independently of --pre-skill (not gated by PRE_SKILL).
if [ -f "$TASKS_FILE" ]; then
  _SEED_FILE=""
  for _seed_candidate in "supabase/seed.sql" "db/seed.sql" "server/database/seed.sql" "prisma/seed.sql"; do
    if [ -f "$REPO_ROOT/$_seed_candidate" ]; then
      _SEED_FILE="$REPO_ROOT/$_seed_candidate"
      break
    fi
  done

  if [ -z "$_SEED_FILE" ]; then
    echo "[UX Gate] info — no seed.sql found; skipping Check 6b seed baseline advisory." >&2
  else
    _SEED_CONTENT=$(cat "$_SEED_FILE")
    _EPHEMERAL_ITEMS=()

    _IN_MR_6B=false
    while IFS= read -r _line_6b; do
      if [[ "$_line_6b" =~ ^##[[:space:]]+人工檢查 ]]; then
        _IN_MR_6B=true
        continue
      fi
      if [ "$_IN_MR_6B" = true ] && [[ "$_line_6b" =~ ^##[[:space:]] ]] && ! [[ "$_line_6b" =~ ^##[[:space:]]+人工檢查 ]]; then
        break
      fi
      [ "$_IN_MR_6B" = true ] || continue

      _item_id_6b=""
      if [[ "$_line_6b" =~ \#([0-9]+(\.[0-9]+)?) ]]; then
        _item_id_6b="#${BASH_REMATCH[1]}"
      fi

      # Extract integers from verified-api URL path segments
      _VAPI_RE='\(verified-api:[[:space:]]*[^ ]+[[:space:]]+[A-Z-]+[[:space:]]+(/[^[:space:]]+)[[:space:]]'
      if [[ "$_line_6b" =~ $_VAPI_RE ]]; then
        _api_url="${BASH_REMATCH[1]}"
        _api_ids=$(echo "$_api_url" | grep -oE '/[0-9]+' | grep -oE '[0-9]+' || true)
        for _aid in $_api_ids; do
          [ "${#_aid}" -ge 1 ] || continue
          if ! echo "$_SEED_CONTENT" | grep -qF "$_aid"; then
            _EPHEMERAL_ITEMS+=("${_item_id_6b:-?} — API path ID ${_aid} (${_api_url}) not in $(basename "$_SEED_FILE")")
          fi
        done
      fi

      # Extract UUIDs from any verify annotation
      _uuids=$(echo "$_line_6b" | grep -oE '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}' || true)
      for _uuid in $_uuids; do
        [ -n "$_uuid" ] || continue
        if ! echo "$_SEED_CONTENT" | grep -qiF "$_uuid"; then
          _EPHEMERAL_ITEMS+=("${_item_id_6b:-?} — UUID ${_uuid} not in $(basename "$_SEED_FILE")")
        fi
      done
    done < "$TASKS_FILE"

    if [ "${#_EPHEMERAL_ITEMS[@]}" -gt 0 ]; then
      echo "[UX Gate] advisory — ${#_EPHEMERAL_ITEMS[@]} entity ID(s) in verify annotations not found in $(basename "$_SEED_FILE"). These may be ephemeral (created via API, lost after db:reset):" >&2
      printf '  - %s\n' "${_EPHEMERAL_ITEMS[@]}" >&2
      echo "修正方式：把 fixture INSERT 寫進 $(basename "$_SEED_FILE") → db:reset → 重拍 screenshot。若 ID 確為非 seed 資料（runtime-generated），可忽略。" >&2
    fi
  fi
fi

# --- Check 7: Pre-handoff Verdict Presence ---
# Mechanical backstop for the Layer E.1 self-analysis verdict (spectra-apply
# Step 8a.6). E.1/E.2 records are agent-self-recorded; the soft step landed 0
# rows in 9 days of soak, so this gate makes "an E.1 verdict was recorded" a
# mechanical precondition of archive — otherwise Phase 3.1 hard-gate evaluation
# never accumulates data. The ledger is written by pre-handoff-ledger.mjs to the
# MAIN consumer root's .spectra/ (worktree cwd normalized via git-common-dir);
# archive-gate runs post-merge-back from that same main root, so
# $REPO_ROOT/.spectra is the exact read path. Records are single-line JSON with
# fixed field order ("change":"X"..."layer":"E.1"), so an ordered two-literal
# grep is exact. Fail-open when the ledger file is absent (pre-propagation
# consumer / no soak history) so a freshly-propagated gate never flag-day-blocks.
PREHANDOFF_LEDGER="$REPO_ROOT/.spectra/pre-handoff-ledger.jsonl"
if [ ! -f "$PREHANDOFF_LEDGER" ]; then
  echo "[UX Gate] warn — pre-handoff ledger 不存在 ($PREHANDOFF_LEDGER)；跳過 Check 7 (fail-open，無 soak 歷史)。" >&2
else
  BYPASS_PREHANDOFF=$(sux_count_marker "$TASKS_FILE" 'pre-handoff-verdict: intentional')
  # Escape regex metachars in the change name before embedding in the grep pattern.
  ESC_CHANGE=$(printf '%s' "$CHANGE_NAME" | sed 's/[][\\.*^$()|?+{}/]/\\&/g')
  E1_PATTERN="\"change\":\"${ESC_CHANGE}\".*\"layer\":\"E\\.1\""
  if [ "$BYPASS_PREHANDOFF" -eq 0 ] && ! grep -qE "$E1_PATTERN" "$PREHANDOFF_LEDGER" 2>/dev/null; then
    BLOCKED=true
    MESSAGES+=("[UX Gate] Pre-handoff Verdict Presence 未通過 — 找不到 change '$CHANGE_NAME' 的 Layer E.1 verdict record。

spectra-apply Step 8a.6 的 5-dimension self-analysis verdict 從未落到 ledger
（${PREHANDOFF_LEDGER}）。沒有 record → Phase 3.1 soak 無資料 → hard-gate 無法評估。

補救（擇一）：
  1. 跑 Step 8a.6 self-analysis，然後執行：
     node <clade-vendor>/scripts/pre-handoff-ledger.mjs record \\
       --consumer-path . --change $CHANGE_NAME --layer E.1 \\
       --status <pass|fail> --findings-json '[...]'
  2. backend-only / 無 pre-handoff 適用情境 → 加
     <!-- pre-handoff-verdict: intentional, reason: ... --> 到 tasks.md 繞過")
  fi
fi

# --- Check 8: Residency Decision Presence ---
# Mechanical backstop for the Orchestration Residency decision (agent-routing
# § Orchestration Residency: classify the change codex-primary vs claude-primary
# BEFORE spectra-apply dispatches). The soft step is agent-self-fired and the
# adoption audit measured a 1/3 fire rate, so this gate makes "a residency
# decision was recorded" a mechanical precondition of archive. The ledger is
# written by residency-classify.mjs `record` to the MAIN consumer root's
# .spectra/ (worktree cwd normalized via git-common-dir); archive-gate runs
# post-merge-back from that same main root, so $REPO_ROOT/.spectra is the exact
# read path. Records are single-line JSON with fixed field order
# ("change":"X"..."verdict":"..."), so an ordered two-literal grep is exact.
# Fail-open when the ledger file is absent (pre-propagation consumer / gradual
# onset) so a freshly-propagated gate never flag-day-blocks.
RESIDENCY_LEDGER="$REPO_ROOT/.spectra/residency-ledger.jsonl"
if [ ! -f "$RESIDENCY_LEDGER" ]; then
  echo "[UX Gate] warn — residency ledger 不存在 ($RESIDENCY_LEDGER)；跳過 Check 8 (fail-open，gradual onset)。" >&2
else
  BYPASS_RESIDENCY=$(sux_count_marker "$TASKS_FILE" 'residency-decision: intentional')
  # Escape regex metachars in the change name before embedding in the grep pattern.
  ESC_CHANGE_RES=$(printf '%s' "$CHANGE_NAME" | sed 's/[][\\.*^$()|?+{}/]/\\&/g')
  RES_PATTERN="\"change\":\"${ESC_CHANGE_RES}\".*\"verdict\""
  if [ "$BYPASS_RESIDENCY" -eq 0 ] && ! grep -qE "$RES_PATTERN" "$RESIDENCY_LEDGER" 2>/dev/null; then
    BLOCKED=true
    MESSAGES+=("[UX Gate] Residency Decision Presence 未通過 — 找不到 change '$CHANGE_NAME' 的 residency decision record。

Orchestration Residency 判定（codex-primary vs claude-primary）從未落到 ledger
（${RESIDENCY_LEDGER}）。沒有 record → residency adoption 無資料 → enforcement 無法評估。

補救（擇一）：
  1. 跑 classifier 取得 verdict，然後記錄決策：
     node <clade-vendor>/scripts/residency-classify.mjs classify \\
       --change openspec/changes/$CHANGE_NAME
     node <clade-vendor>/scripts/residency-classify.mjs record \\
       --consumer-path . --change $CHANGE_NAME \\
       --verdict <codex-primary|claude-primary> --executor <codex|claude> \\
       [--reason <verdict 與 executor 不一致時必填>]
  2. 不適用 residency 判定的情境 → 加
     <!-- residency-decision: intentional, reason: ... --> 到 tasks.md 繞過")
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
