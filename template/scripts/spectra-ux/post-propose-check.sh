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
  if [ -f "$TASKS_FILE" ] && grep -qiE "${SUX_UI_EXT}|pages/|components/|layouts/" "$TASKS_FILE" 2>/dev/null; then
    HAS_UI_SCOPE=true
  fi
  if grep -qiE "${SUX_UI_EXT}|pages/|components/|layouts/" "$PROPOSAL_FILE" 2>/dev/null; then
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
if grep -qiE "${SUX_MIGRATIONS_DIR}|\.sql|ALTER TABLE|ADD COLUMN|CREATE TABLE|CHECK.*IN|${SUX_TYPES_DIRS%% *}" "$PROPOSAL_FILE" 2>/dev/null; then
  HAS_DB_SCOPE=true
fi
if [ -f "$TASKS_FILE" ] && grep -qiE "${SUX_MIGRATIONS_DIR}|${SUX_TYPES_DIRS%% *}/" "$TASKS_FILE" 2>/dev/null; then
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

# --- Check 3: Journey URL → task mapping ---
if [ -f "$TASKS_FILE" ] && grep -q '^## User Journeys' "$PROPOSAL_FILE" 2>/dev/null; then
  JOURNEY_URLS=$(sux_extract_journey_urls "$PROPOSAL_FILE")

  UNMAPPED=()
  while IFS= read -r url; do
    [ -z "$url" ] && continue
    url_frag="${url#/}"
    if ! grep -qE "(${SUX_UI_DIRS%% *}${url}|${url_frag}${SUX_UI_EXT}|${url}\b)" "$TASKS_FILE" 2>/dev/null; then
      UNMAPPED+=("$url")
    fi
  done <<< "$JOURNEY_URLS"

  if [ "${#UNMAPPED[@]}" -gt 0 ]; then
    FINDINGS+=("Journey URL 未對應到 task — 以下 URL 在 proposal 出現但 tasks.md 沒對應：
$(printf '  - %s\n' "${UNMAPPED[@]}")

為每個 URL 加入對應 task（具體檔案路徑 + 人工檢查項目），或在 Non-Goals 排除並移除該 journey。")
  fi
fi

# --- Check 4: Enum expansion needs types sync ---
if [ -f "$TASKS_FILE" ]; then
  HAS_MIGRATION_TASK=$(grep -cE "${SUX_MIGRATIONS_DIR}|migration new|ADD COLUMN|CHECK.*IN" "$TASKS_FILE" 2>/dev/null || true)
  HAS_MIGRATION_TASK=${HAS_MIGRATION_TASK:-0}
  HAS_TYPES_TASK=$(grep -cE "${SUX_TYPES_DIRS%% *}/" "$TASKS_FILE" 2>/dev/null || true)
  HAS_TYPES_TASK=${HAS_TYPES_TASK:-0}

  if [ "$HAS_MIGRATION_TASK" -gt 0 ] && [ "$HAS_TYPES_TASK" -eq 0 ]; then
    ENUM_HINT=0
    if [ -d "$SPECS_DIR" ]; then
      ENUM_HINT=$(grep -rciE 'enum|new type' "$SPECS_DIR" 2>/dev/null | awk -F: '{s+=$2} END {print s+0}')
    fi
    if [ "$ENUM_HINT" -gt 0 ]; then
      FINDINGS+=("tasks 有 migration 但缺 ${SUX_TYPES_DIRS%% *} 同步 task — spec 提到 enum / type 擴張，tasks 沒列對應更新任務。

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
