#!/usr/bin/env bash
# spectra-ux: post-propose validation
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

if grep -qiE "server/api/|api/|defineEventHandler|useFetch|\\bfetch\\(|\\$fetch\\(|endpoint|handler|route rules|rpc|mutation|query" "$PROPOSAL_FILE" 2>/dev/null; then
  HAS_SERVER_SCOPE=true
fi
if [ -f "$TASKS_FILE" ] && grep -qiE "server/api/|api/|handler|endpoint|route" "$TASKS_FILE" 2>/dev/null; then
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
    FINDINGS+=("`Truth layer / invariants` 不能留空 — change 牽涉 migration / schema / auth / permission 等敏感 scope。

請寫清楚：
  - 哪個 artifact 是 single source of truth
  - 哪些 invariants 不能漂移
  - 哪些同步層必須一起更新")
  fi

  if [ "$HAS_SERVER_SCOPE" = true ] && ! printf '%s\n' "$RISK_BLOCK" | grep -qiE 'Contract / failure paths:.*[^[:space:]]'; then
    FINDINGS+=("`Contract / failure paths` 不能留空 — change 包含 API / server scope。

請至少交代 success / empty / conflict / unauthorized / upstream-failure 中哪些需要處理。")
  fi

  if [ "$HAS_UI_SCOPE" = true ] && ! printf '%s\n' "$RISK_BLOCK" | grep -qiE 'Test plan:.*(screenshot|manual|browser|journey|review)'; then
    FINDINGS+=("`Test plan` 對 UI scope 太弱 — proposal 有 UI 影響時，測試計畫至少要提到 screenshot、manual journey，或等效的瀏覽器驗證證據。")
  fi

  if [ "$HAS_DB_SCOPE" = true ] && ! printf '%s\n' "$RISK_BLOCK" | grep -qiE 'Artifact sync:.*(tasks|roadmap|report|docs|type|migration|spec|handoff|tech-debt)'; then
    FINDINGS+=("`Artifact sync` 對資料層 change 太弱 — proposal 需要先交代 tasks / roadmap / docs / report / types 等同步面，避免實作完才補文件。")
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
