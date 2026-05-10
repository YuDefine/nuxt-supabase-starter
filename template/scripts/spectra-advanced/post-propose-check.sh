#!/usr/bin/env bash
# spectra-advanced: post-propose validation
#
# Validates a freshly created proposal:
#   1. Has ## User Journeys (or backend-only declaration)
#   2. Has ## Affected Entity Matrix when DB schema is touched
#   3. Each journey URL maps to a tasks.md reference
#   4. Migration with enum expansion has shared/types task
#
# Usage:
#   post-propose-check.sh                  → finds latest active change
#   post-propose-check.sh <change-name>    → checks specific change
#
# Exit: 0 always (informational); findings on stdout

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"

sux_manual_review_schema_violations() {
  local file=$1
  [ -f "$file" ] || return 0

  local in_manual=false line line_no=0
  while IFS= read -r line || [ -n "$line" ]; do
    line_no=$((line_no + 1))

    if printf '%s\n' "$line" | grep -Eq '^##[[:space:]].*人工檢查[[:space:]]*$'; then
      in_manual=true
      continue
    fi

    if [ "$in_manual" = true ] && printf '%s\n' "$line" | grep -Eq '^##[[:space:]]'; then
      in_manual=false
    fi

    [ "$in_manual" = true ] || continue

    if printf '%s\n' "$line" | grep -Eq '^[[:space:]]*- \[[ x]\] '; then
      if printf '%s\n' "$line" | grep -Eq '^(- \[[ x]\] #[1-9][0-9]* .+|  - \[[ x]\] #[1-9][0-9]*\.[1-9][0-9]* .+)$'; then
        continue
      fi
      printf '%s\t%s\n' "$line_no" "$line"
    fi
  done < "$file"
}

sux_run_check7_self_test() {
  local tmp valid legacy missing no_manual count
  tmp=$(mktemp -d)
  trap "rm -rf '$tmp'" EXIT

  valid="$tmp/valid.md"
  legacy="$tmp/legacy.md"
  missing="$tmp/missing.md"
  no_manual="$tmp/no-manual.md"

  cat > "$valid" <<'EOF_VALID'
## 9. 人工檢查

- [ ] #1 Parent pending
- [x] #2 Parent checked
  - [ ] #2.1 Scoped pending
  - [x] #2.2 Scoped checked（skip）
EOF_VALID

  cat > "$legacy" <<'EOF_LEGACY'
## 8. 人工檢查

- [ ] 8.1 Legacy id
EOF_LEGACY

  cat > "$missing" <<'EOF_MISSING'
## 8. 人工檢查

- [ ] Missing id
EOF_MISSING

  cat > "$no_manual" <<'EOF_NO_MANUAL'
## 1. Implementation

- [ ] 1.1 No manual section
EOF_NO_MANUAL

  count=$(sux_manual_review_schema_violations "$valid" | wc -l | tr -d ' ')
  [ "$count" = "0" ] || { echo "Check 7 self-test failed: valid fixture produced findings" >&2; return 1; }

  count=$(sux_manual_review_schema_violations "$legacy" | wc -l | tr -d ' ')
  [ "$count" = "1" ] || { echo "Check 7 self-test failed: legacy fixture did not produce exactly one finding" >&2; return 1; }

  count=$(sux_manual_review_schema_violations "$missing" | wc -l | tr -d ' ')
  [ "$count" = "1" ] || { echo "Check 7 self-test failed: missing-id fixture did not produce exactly one finding" >&2; return 1; }

  count=$(sux_manual_review_schema_violations "$no_manual" | wc -l | tr -d ' ')
  [ "$count" = "0" ] || { echo "Check 7 self-test failed: no-manual fixture produced findings" >&2; return 1; }

  echo "✓ Check 7 self-test passed"
}

if [ "${1:-}" = "--self-test-check7" ]; then
  sux_run_check7_self_test
  exit $?
fi

if [ "${1:-}" = "--check7-only" ]; then
  sux_load_config
  target=${2:-}
  [ -n "$target" ] || { echo "Usage: post-propose-check.sh --check7-only <change-name|tasks.md>" >&2; exit 2; }
  if [ -f "$target" ]; then
    TASKS_FILE=$target
    CHANGE_NAME=$(basename "$(dirname "$target")")
  else
    CHANGE_DIR=$(sux_find_change_by_name "$target") || {
      echo "Check 7: change not found: $target" >&2
      exit 2
    }
    TASKS_FILE="$CHANGE_DIR/tasks.md"
    CHANGE_NAME=$(basename "$CHANGE_DIR")
  fi

  count=0
  while IFS=$'\t' read -r line_no offending_line; do
    [ -n "${line_no:-}" ] || continue
    count=$((count + 1))
    echo "Manual Review schema violation — change ${CHANGE_NAME}, tasks.md:${line_no}"
    echo "  offending: ${offending_line}"
    echo "  expected: #N parent or two-space indented #N.M scoped item"
  done < <(sux_manual_review_schema_violations "$TASKS_FILE")
  if [ "$count" -gt 0 ]; then
    exit 1
  fi
  echo "✓ Check 7 passed (${CHANGE_NAME})"
  exit 0
fi

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
TASKS_FILE="$CHANGE_DIR/tasks.md"
SPECS_DIR="$CHANGE_DIR/specs"

[ -f "$PROPOSAL_FILE" ] || exit 0

FINDINGS=()

# --- Check 1: User Journeys section ---
if ! grep -q '^## User Journeys' "$PROPOSAL_FILE" 2>/dev/null; then
  HAS_UI_SCOPE=false
  if [ -f "$TASKS_FILE" ] && grep -qiE "${SUX_UI_EXT_RE}|pages/|components/|layouts/" "$TASKS_FILE" 2>/dev/null; then
    HAS_UI_SCOPE=true
  fi
  if grep -qiE "${SUX_UI_EXT_RE}|pages/|components/|layouts/" "$PROPOSAL_FILE" 2>/dev/null; then
    HAS_UI_SCOPE=true
  fi

  if [ "$HAS_UI_SCOPE" = true ]; then
    FINDINGS+=("缺 \`## User Journeys\` 區塊 — change 包含 UI scope 但 proposal 沒列 user journey。

請在 proposal.md 加入：

\`\`\`markdown
## User Journeys

### <Entity or Flow>

- **<Role>** 在 \`<URL>\` <動作> → <預期結果>
\`\`\`

若純後端，明確寫：

\`\`\`markdown
## User Journeys

**No user-facing journey (backend-only)**

理由：<具體說明>
\`\`\`")
  fi
fi

# --- Check 2: Affected Entity Matrix ---
HAS_DB_SCOPE=false
if grep -qiE "${SUX_MIGRATIONS_DIR}|\.sql|ALTER TABLE|ADD COLUMN|CREATE TABLE|CHECK.*IN|${SUX_TYPES_PRIMARY}" "$PROPOSAL_FILE" 2>/dev/null; then
  HAS_DB_SCOPE=true
fi
if [ -f "$TASKS_FILE" ] && grep -qiE "${SUX_MIGRATIONS_DIR}|${SUX_TYPES_PRIMARY}/" "$TASKS_FILE" 2>/dev/null; then
  HAS_DB_SCOPE=true
fi

if [ "$HAS_DB_SCOPE" = true ]; then
  if ! grep -q '^## Affected Entity Matrix' "$PROPOSAL_FILE" 2>/dev/null; then
    FINDINGS+=("缺 \`## Affected Entity Matrix\` 區塊 — change 觸動 DB schema 或 types。

請在 proposal.md 加入矩陣：

\`\`\`markdown
## Affected Entity Matrix

### Entity: <table_name>

| Dimension | Values |
| --- | --- |
| Columns touched | ... |
| Roles | ... |
| Actions | create, read, update, delete, filter |
| States | empty, loading, error, success, unauthorized |
| Surfaces | \`/path1\`, \`/path2\` |
\`\`\`")
  fi
fi

# --- Check 3: Implementation Risk Plan ---
HAS_SERVER_SCOPE=false
HAS_UI_SCOPE=false
HAS_SENSITIVE_SCOPE=false

if grep -qiE "${SUX_UI_EXT_RE}|pages/|components/|layouts/" "$PROPOSAL_FILE" 2>/dev/null; then
  HAS_UI_SCOPE=true
fi
if [ -f "$TASKS_FILE" ] && sux_tasks_has_ui_scope "$TASKS_FILE"; then
  HAS_UI_SCOPE=true
fi

if grep -qiE 'server/api/|api/|defineEventHandler|useFetch|\bfetch\(|\$fetch\(|endpoint|handler|route rules|rpc|mutation|query' "$PROPOSAL_FILE" 2>/dev/null; then
  HAS_SERVER_SCOPE=true
fi
if [ -f "$TASKS_FILE" ] && grep -qiE 'server/api/|api/|handler|endpoint|route' "$TASKS_FILE" 2>/dev/null; then
  HAS_SERVER_SCOPE=true
fi

if grep -qiE "${SUX_MIGRATIONS_DIR}|\\.sql|ALTER TABLE|ADD COLUMN|CREATE TABLE|CHECK.*IN|${SUX_TYPES_PRIMARY}|auth|permission|rbac|role|policy|raw sql|view\\b|trigger\\b" "$PROPOSAL_FILE" 2>/dev/null; then
  HAS_SENSITIVE_SCOPE=true
fi
if [ -f "$TASKS_FILE" ] && grep -qiE "${SUX_MIGRATIONS_DIR}|${SUX_TYPES_PRIMARY}/|auth|permission|rbac|role|policy|raw sql" "$TASKS_FILE" 2>/dev/null; then
  HAS_SENSITIVE_SCOPE=true
fi

RISK_BLOCK=$(sux_extract_section "$PROPOSAL_FILE" 'Implementation Risk Plan')
if [ -z "$RISK_BLOCK" ]; then
  FINDINGS+=("缺 \`## Implementation Risk Plan\` 區塊 — proposal 沒先回答 implementation 前提，這些通常會拖到 \`/commit\` 才被打回。

請在 proposal.md 加入：

\`\`\`markdown
## Implementation Risk Plan

- Truth layer / invariants:
- Review tier:
- Contract / failure paths:
- Test plan:
- Artifact sync:
\`\`\`

保持精簡，但五行都要有內容。")
else
  MISSING_FIELDS=()

  if ! printf '%s\n' "$RISK_BLOCK" | grep -qi 'Truth layer / invariants:'; then
    MISSING_FIELDS+=('Truth layer / invariants')
  fi
  if ! printf '%s\n' "$RISK_BLOCK" | grep -qi 'Review tier:'; then
    MISSING_FIELDS+=('Review tier')
  fi
  if ! printf '%s\n' "$RISK_BLOCK" | grep -qi 'Contract / failure paths:'; then
    MISSING_FIELDS+=('Contract / failure paths')
  fi
  if ! printf '%s\n' "$RISK_BLOCK" | grep -qi 'Test plan:'; then
    MISSING_FIELDS+=('Test plan')
  fi
  if ! printf '%s\n' "$RISK_BLOCK" | grep -qi 'Artifact sync:'; then
    MISSING_FIELDS+=('Artifact sync')
  fi

  if [ "${#MISSING_FIELDS[@]}" -gt 0 ]; then
    FINDINGS+=("\`## Implementation Risk Plan\` 缺欄位：
$(printf '  - %s\n' "${MISSING_FIELDS[@]}")

請補齊固定五行，避免 scope / review / sync 前提漏掉。")
  fi

  if [ "$HAS_SENSITIVE_SCOPE" = true ] && ! printf '%s\n' "$RISK_BLOCK" | grep -qiE 'Truth layer / invariants:.*[^[:space:]]'; then
    FINDINGS+=("\`Truth layer / invariants\` 不能留空 — change 牽涉 migration / schema / auth / permission 等敏感 scope。

請寫清楚：
  - 哪個 artifact 是 single source of truth
  - 哪些 invariants 不能漂移
  - 哪些同步層必須一起更新")
  fi

  if [ "$HAS_SERVER_SCOPE" = true ] && ! printf '%s\n' "$RISK_BLOCK" | grep -qiE 'Contract / failure paths:.*[^[:space:]]'; then
    FINDINGS+=("\`Contract / failure paths\` 不能留空 — change 包含 API / server scope。

請至少交代 success / empty / conflict / unauthorized / upstream-failure 中哪些需要處理。")
  fi

  if [ "$HAS_UI_SCOPE" = true ] && ! printf '%s\n' "$RISK_BLOCK" | grep -qiE 'Test plan:.*(screenshot|manual|browser|journey|review)'; then
    FINDINGS+=("\`Test plan\` 對 UI scope 太弱 — proposal 有 UI 影響時，測試計畫至少要提到 screenshot、manual journey，或等效的瀏覽器驗證證據。")
  fi

  if [ "$HAS_DB_SCOPE" = true ] && ! printf '%s\n' "$RISK_BLOCK" | grep -qiE 'Artifact sync:.*(tasks|roadmap|report|docs|type|migration|spec|handoff|tech-debt)'; then
    FINDINGS+=("\`Artifact sync\` 對資料層 change 太弱 — proposal 需要先交代 tasks / roadmap / docs / report / types 等同步面，避免實作完才補文件。")
  fi
fi

# --- Check 4: Journey URL → task mapping ---
if [ -f "$TASKS_FILE" ] && grep -q '^## User Journeys' "$PROPOSAL_FILE" 2>/dev/null; then
  JOURNEY_URLS=$(sux_extract_journey_urls "$PROPOSAL_FILE")

  UNMAPPED=()
  while IFS= read -r url; do
    [ -z "$url" ] && continue
    url_frag="${url#/}"
    if ! grep -qE "(${SUX_UI_DIRS%% *}${url}|${url_frag}${SUX_UI_EXT_RE}|${url}\b)" "$TASKS_FILE" 2>/dev/null; then
      UNMAPPED+=("$url")
    fi
  done <<< "$JOURNEY_URLS"

  if [ "${#UNMAPPED[@]}" -gt 0 ]; then
    FINDINGS+=("Journey URL 未對應到 task — 以下 URL 在 proposal 出現但 tasks.md 沒對應：
$(printf '  - %s\n' "${UNMAPPED[@]}")

為每個 URL 加入對應 task（具體檔案路徑 + 人工檢查項目），或在 Non-Goals 排除並移除該 journey。")
  fi
fi

# --- Check 4b: Design Review section structural completeness (7-step template) ---
if [ -f "$TASKS_FILE" ] && [ "$HAS_UI_SCOPE" = true ]; then
  DESIGN_SECTION=$(sed -n '/^## .*Design Review/,/^## /p' "$TASKS_FILE" 2>/dev/null | sed '$d')

  if [ -z "$DESIGN_SECTION" ]; then
    FINDINGS+=("缺 \`## N. Design Review\` 區塊 — change 包含 UI scope，但 tasks.md 沒有 Design Review section。

請在最後一個功能區塊之後、\`## 人工檢查\` 之前加入完整 7 步 template：

\`\`\`markdown
## N. Design Review

- [ ] N.1 檢查 PRODUCT.md（必要）+ DESIGN.md（建議）；缺 PRODUCT.md 跑 /impeccable teach、缺 DESIGN.md 跑 /impeccable document
- [ ] N.2 執行 /design improve [affected pages/components]，產出 Design Fidelity Report
- [ ] N.3 修復所有 DRIFT 項目（Fidelity Score < 8/8 時必做，loop 直到 DRIFT = 0，max 2 輪）
- [ ] N.4 依 /design improve 計劃按 canonical order 執行 targeted impeccable skills（layout / typeset / clarify / harden / colorize 等）
- [ ] N.5 執行 /impeccable audit，確認 Critical = 0
- [ ] N.6 執行 review-screenshot，補 design-review.md / 視覺 QA 證據
- [ ] N.7 Fidelity 確認 — design-review.md 中無 DRIFT 項
\`\`\`")
  else
    DR_TASK_LINES=$(printf '%s\n' "$DESIGN_SECTION" | grep -cE '^\- \[[ x]\]' || true)
    DR_TASK_LINES=${DR_TASK_LINES:-0}

    # Parse N.k task lines into per-step text so each grep only sees its own line.
    # Using whole DESIGN_SECTION causes cross-step false negatives — e.g. N.7's "無 DRIFT"
    # makes N.3's "DRIFT" matcher pass even when N.3 is actually missing.
    DR_STEP_TEXT=()
    while IFS= read -r line; do
      if [[ "$line" =~ ^-\ \[[\ x]\]\ [0-9]+\.([0-9]+)\ (.+)$ ]]; then
        DR_STEP_TEXT[${BASH_REMATCH[1]}]="${BASH_REMATCH[2]}"
      fi
    done <<< "$DESIGN_SECTION"

    DR_MISSING=()
    echo "${DR_STEP_TEXT[1]:-}" | grep -qiE 'PRODUCT\.md|DESIGN\.md|impeccable teach|impeccable document' || DR_MISSING+=('N.1 PRODUCT.md / DESIGN.md 檢查')
    echo "${DR_STEP_TEXT[2]:-}" | grep -qiE '/design improve|design improve|Fidelity Report' || DR_MISSING+=('N.2 /design improve + Fidelity Report')
    echo "${DR_STEP_TEXT[3]:-}" | grep -qiE 'DRIFT|loop|修復.*DRIFT|fix.*DRIFT' || DR_MISSING+=('N.3 修復 DRIFT loop')
    echo "${DR_STEP_TEXT[4]:-}" | grep -qiE 'canonical order|targeted.*skills|impeccable skills|layout.*typeset|typeset.*colorize' || DR_MISSING+=('N.4 按 canonical order 跑 targeted impeccable skills')
    echo "${DR_STEP_TEXT[5]:-}" | grep -qiE '/impeccable audit|impeccable audit|Critical = 0|Critical=0' || DR_MISSING+=('N.5 /impeccable audit Critical = 0')
    echo "${DR_STEP_TEXT[6]:-}" | grep -qiE 'review-screenshot|screenshot review|視覺 QA' || DR_MISSING+=('N.6 review-screenshot 視覺 QA')
    echo "${DR_STEP_TEXT[7]:-}" | grep -qiE 'Fidelity 確認|Fidelity check|無 DRIFT 項|無 DRIFT|DRIFT = 0' || DR_MISSING+=('N.7 Fidelity 確認')

    if [ "${#DR_MISSING[@]}" -gt 0 ]; then
      FINDINGS+=("\`## Design Review\` 區塊缺 7 步 template 中的：
$(printf '  - %s\n' "${DR_MISSING[@]}")

完整 7 步 template 見 \`ux-completeness.md\` 的 Design Review Task Template 段落。**MUST** 全部 N.1~N.7，不可裁減。")
    fi

    if [ "$DR_TASK_LINES" -lt 7 ]; then
      FINDINGS+=("\`## Design Review\` 區塊只有 ${DR_TASK_LINES} 個 checkbox（應有 7 個）。

請補齊 N.1~N.7 完整 7 步 template — 完整規格見 \`ux-completeness.md\`。")
    fi
  fi
fi

# --- Check 4c: Phase Purity (UI view vs 非 view 必須切成獨立 phase) ---
# Trigger: HAS_UI_SCOPE=true，掃所有 `## N. <title>` phase，跳過 Design Review / Fixtures / 人工檢查
# 違規：同 phase 同時 hit view 與非 view 關鍵字（spectra-apply Phase Dispatch 仰賴 phase purity）
if [ -f "$TASKS_FILE" ] && [ "$HAS_UI_SCOPE" = true ]; then
  # 抽出所有 `## ` heading（functional phases）
  PHASE_HEADINGS=$(grep -nE '^## ' "$TASKS_FILE" 2>/dev/null || true)
  MIXED_PHASES=()

  # 用 awk 把每個 `## ` heading 之間的內容切片，逐一檢查
  while IFS= read -r heading_line; do
    [ -z "$heading_line" ] && continue
    # heading_line 形如 "12:## 3. UI Implementation"
    line_no=${heading_line%%:*}
    title=${heading_line#*:## }

    # 跳過不需要 purity 檢查的 phase
    case "$title" in
      *Design\ Review*|*Fixtures*|*Seed\ Plan*|*人工檢查*|*Manual\ Review*) continue ;;
    esac

    # 抽出該 phase body：從本 heading 後到下一個 `## ` 之前
    phase_body=$(awk -v start="$line_no" 'NR>start { if (/^## /) exit; print }' "$TASKS_FILE")
    [ -z "$phase_body" ] && continue

    # has_view：phase body 提到 view 層檔案 / 目錄
    has_view=0
    if printf '%s\n' "$phase_body" | grep -qiE "(${SUX_UI_EXT_RE})|\.tsx\b|\.jsx\b|\.css\b|\.scss\b|app/pages/|app/components/|(^|[^/])pages/|(^|[^/])components/|views/|layouts/" 2>/dev/null; then
      has_view=1
    fi

    # has_nonview：phase body 提到非 view 工作（backend / store / hook / API client / type / migration / util）
    has_nonview=0
    if printf '%s\n' "$phase_body" | grep -qiE "server/api/|server/utils/|server/middleware/|composables/|stores/|pinia/|shared/types/|${SUX_TYPES_PRIMARY}/|${SUX_MIGRATIONS_DIR}|\.sql\b|drizzle/|prisma/|defineEventHandler|useFetch\(|\\\$fetch\(|api/.*\.ts" 2>/dev/null; then
      has_nonview=1
    fi

    if [ "$has_view" -eq 1 ] && [ "$has_nonview" -eq 1 ]; then
      MIXED_PHASES+=("\`## $title\` (line $line_no)")
    fi
  done <<< "$PHASE_HEADINGS"

  if [ "${#MIXED_PHASES[@]}" -gt 0 ]; then
    MIXED_LIST=$(printf -- '- %s\n' "${MIXED_PHASES[@]}")
    FINDINGS+=("Phase Purity 違規 — 以下 phase 同時混雜 UI view 與非 view 工作：

${MIXED_LIST}

spectra-apply Phase Dispatch 規則仰賴 phase purity：UI view phase（component / page / view / layout / styling）由主線 Claude Code 自己做、非 view phase 派 codex GPT-5.5 high。混雜 phase 會破壞 dispatch 邊界。

**MUST** 把 view 層改動（\`.vue\` / \`.tsx\` / \`.jsx\` / \`pages/\` / \`components/\` / \`views/\` / \`layouts/\` / \`.css\` / \`.scss\`）切成獨立 phase（建議命名 \`## N. UI / View Implementation\`），其他工作（schema / migration / API server / store / hook / API client / type / util）放別的 phase。

例：
\`\`\`markdown
## 1. Database Schema       (純 migration)
## 2. API Endpoints         (純 server/api/)
## 3. Pinia Store + Composables  (純 store / composable / type，frontend 但非 view)
## 4. UI / View Implementation  (純 .vue / app/pages/ / app/components/)
## 5. Fixtures / Seed Plan
## 6. Design Review
\`\`\`")
  fi
fi

# --- Check 5: Enum expansion needs types sync ---
if [ -f "$TASKS_FILE" ]; then
  HAS_MIGRATION_TASK=$(grep -cE "${SUX_MIGRATIONS_DIR}|migration new|ADD COLUMN|CHECK.*IN" "$TASKS_FILE" 2>/dev/null || true)
  HAS_MIGRATION_TASK=${HAS_MIGRATION_TASK:-0}
  HAS_TYPES_TASK=$(grep -cE "${SUX_TYPES_PRIMARY}/" "$TASKS_FILE" 2>/dev/null || true)
  HAS_TYPES_TASK=${HAS_TYPES_TASK:-0}

  if [ "$HAS_MIGRATION_TASK" -gt 0 ] && [ "$HAS_TYPES_TASK" -eq 0 ]; then
    ENUM_HINT=0
    if [ -d "$SPECS_DIR" ]; then
      ENUM_HINT=$(grep -rciE 'enum|new type' "$SPECS_DIR" 2>/dev/null | awk -F: '{s+=$2} END {print s+0}')
    fi
    if [ "$ENUM_HINT" -gt 0 ]; then
      FINDINGS+=("tasks 有 migration 但缺 ${SUX_TYPES_PRIMARY} 同步 task — spec 提到 enum / type 擴張，tasks 沒列對應更新任務。

TypeScript enum 不會從 DB 自動衍生，需要手動同步。")
    fi
  fi
fi

# --- Check 6: Fixtures / Seed Plan ---
# Trigger: HAS_UI_SCOPE=true 且 proposal 有 ## Affected Entity Matrix（=有 entity 動）
# 完整規則見 ux-completeness.md 「必填 Fixtures / Seed Plan」段落
if [ -f "$TASKS_FILE" ] \
  && [ "$HAS_UI_SCOPE" = true ] \
  && grep -q '^## Affected Entity Matrix' "$PROPOSAL_FILE" 2>/dev/null; then

  HAS_FIXTURES_SECTION=$(grep -cE '^## .*Fixtures' "$TASKS_FILE" 2>/dev/null || true)
  HAS_FIXTURES_SECTION=${HAS_FIXTURES_SECTION:-0}

  # 偵測專案 seed 慣例位置（給 finding 範本當提示用）
  SEED_HINT=""
  REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
  for candidate in "supabase/seed.sql" "db/seed.sql" "prisma/seed.ts" "drizzle/seed.ts"; do
    if [ -f "$REPO_ROOT/$candidate" ]; then
      SEED_HINT="$candidate"
      break
    fi
  done
  SEED_HINT_TXT="${SEED_HINT:-<偵測不到專案 seed 慣例位置，請手動指定>}"

  if [ "$HAS_FIXTURES_SECTION" -eq 0 ]; then
    FINDINGS+=("缺 \`## Fixtures / Seed Plan\` 區塊 — change 包含 UI scope 且 \`Affected Entity Matrix\` 列了 entity，但 tasks.md 沒列 fixtures 規劃。

UI 展示頁面在 dev / staging 沒有持久化 mock 會導致 review 拍照空畫面、無效檢視。請在最後一個功能區塊之後、\`## Design Review\` 之前加入：

\`\`\`markdown
## N. Fixtures / Seed Plan

- [ ] N.1 \`<entity_a>\` — happy path 至少 3 筆（含關聯 entity X / Y）+ edge case 1 筆 → 寫進 \`${SEED_HINT_TXT}\`
- [ ] N.2 跑 \`<reset-or-seed-command>\` 重建本機 DB 並驗證 list / detail 頁面非空
\`\`\`

完整 template + 例外宣告（\`**Existing seed sufficient**\`）見 \`ux-completeness.md\` 的「必填 Fixtures / Seed Plan」段落。")
  else
    FIXTURES_SECTION=$(sed -n '/^## .*Fixtures/,/^## /p' "$TASKS_FILE" 2>/dev/null | sed '$d')
    FIXTURES_TASK_LINES=$(printf '%s\n' "$FIXTURES_SECTION" | grep -cE '^\- \[[ x]\]' || true)
    FIXTURES_TASK_LINES=${FIXTURES_TASK_LINES:-0}
    HAS_EXISTING_DECLARATION=$(printf '%s\n' "$FIXTURES_SECTION" | grep -ciE 'Existing seed sufficient' || true)
    HAS_EXISTING_DECLARATION=${HAS_EXISTING_DECLARATION:-0}

    if [ "$FIXTURES_TASK_LINES" -eq 0 ] && [ "$HAS_EXISTING_DECLARATION" -eq 0 ]; then
      FINDINGS+=("\`## Fixtures / Seed Plan\` 區塊內容不完整 — 沒有任何 task checkbox、也沒有 \`**Existing seed sufficient**\` 宣告。

請至少補一條 task：

\`\`\`markdown
- [ ] N.1 \`<entity>\` — happy path 至少 N 筆 → 寫進 \`${SEED_HINT_TXT}\`
\`\`\`

或若既有 seed 已足夠，明確宣告 \`**Existing seed sufficient**\` 並寫一行理由（哪些頁面靠哪些既有 row 撐住）。")
    fi
  fi
fi

# --- Check 7: Manual Review schema ---
if [ -f "$TASKS_FILE" ]; then
  while IFS=$'\t' read -r line_no offending_line; do
    [ -n "${line_no:-}" ] || continue
    FINDINGS+=("Manual Review schema violation — change \`${CHANGE_NAME}\`, tasks.md:${line_no}

Offending line:
\`\`\`markdown
${offending_line}
\`\`\`

Expected:
- parent item: \`- [ ] #N description\` or \`- [x] #N description\`
- scoped item: \`  - [ ] #N.M description\` or \`  - [x] #N.M description\`")
  done < <(sux_manual_review_schema_violations "$TASKS_FILE")
fi

# --- Output ---
if [ "${#FINDINGS[@]}" -eq 0 ]; then
  exit 0
fi

cat <<EOF
[UX Completeness] post-propose 檢查發現 ${#FINDINGS[@]} 項需要處理（change: ${CHANGE_NAME}）：

EOF

i=1
for finding in "${FINDINGS[@]}"; do
  echo "── ${i}. ──"
  echo "$finding"
  echo ""
  i=$((i + 1))
done

cat <<EOF
請當場修正 proposal.md / tasks.md 再繼續。若 skill 已結束：
  1. 直接編輯對應檔案
  2. 或重新跑 /spectra-ingest <change-name>

禁止繞過此檢查 — 完整體驗的起點就是完整的 proposal。
EOF

exit 0
