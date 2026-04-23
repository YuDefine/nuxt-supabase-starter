#!/usr/bin/env bash
# spectra-ux v1.5+: Follow-up Register Archive Gate
#
# Blocks spectra-archive when tasks.md contains @followup[TD-NNN] markers
# that are not registered in docs/tech-debt.md, or registered without
# Status field value.
#
# Called by:
#   - Claude hook: templates/claude-hooks/pre-archive-followup-gate.sh
#   - Non-Claude agents: manual invocation before spectra-archive
#
# Usage:
#   followup-gate.sh <change-name>

set -uo pipefail

CHANGE="${1:-}"
if [ -z "$CHANGE" ]; then
  # No change specified; nothing to gate. Exit 0.
  exit 0
fi

ROOT="${PWD}"
TASKS="$ROOT/openspec/changes/$CHANGE/tasks.md"
REGISTER="$ROOT/docs/tech-debt.md"

if [ ! -f "$TASKS" ]; then
  # Change folder not found (maybe already archived, maybe bad name). Silent exit.
  exit 0
fi

if [ ! -f "$REGISTER" ]; then
  # Register file missing. If tasks.md has markers, fail; otherwise pass.
  if grep -qE '@followup\[TD-[0-9]+\]' "$TASKS"; then
    echo "[Follow-up Gate] docs/tech-debt.md not found but tasks.md contains @followup markers" >&2
    echo "  修正：建立 docs/tech-debt.md（template 位於 spectra-ux templates/openspec/tech-debt.md）" >&2
    exit 2
  fi
  exit 0
fi

# Extract all TD-NNN IDs referenced in tasks.md
MARKERS=$(grep -oE '@followup\[TD-[0-9]+\]' "$TASKS" 2>/dev/null | sort -u | sed 's/^@followup\[//;s/\]$//')

if [ -z "$MARKERS" ]; then
  # No markers. Pass.
  exit 0
fi

MISSING=()
INCOMPLETE=()

while IFS= read -r ID; do
  [ -z "$ID" ] && continue

  # Must appear as section header in register: "## TD-NNN —"
  if ! grep -qE "^## $ID[[:space:]]+—" "$REGISTER"; then
    MISSING+=("$ID")
    continue
  fi

  # Must have Status field
  SECTION=$(awk -v id="$ID" '
    $0 ~ "^## " id "[[:space:]]+—" { in_section=1; next }
    in_section && /^## TD-/ { exit }
    in_section { print }
  ' "$REGISTER")

  if ! echo "$SECTION" | grep -qE '^\*\*Status\*\*:[[:space:]]+(open|in-progress|done|wontfix)'; then
    INCOMPLETE+=("$ID (missing or invalid Status)")
    continue
  fi

  # wontfix must have Reason
  if echo "$SECTION" | grep -qE '^\*\*Status\*\*:[[:space:]]+wontfix'; then
    if ! echo "$SECTION" | grep -qiE '^(\*\*Reason\*\*|### Reason)'; then
      INCOMPLETE+=("$ID (wontfix without Reason)")
      continue
    fi
  fi
done <<< "$MARKERS"

if [ ${#MISSING[@]} -eq 0 ] && [ ${#INCOMPLETE[@]} -eq 0 ]; then
  exit 0
fi

echo "[Follow-up Gate] archive blocked for change: $CHANGE" >&2
echo "" >&2

if [ ${#MISSING[@]} -gt 0 ]; then
  echo "未登記 docs/tech-debt.md 的 marker：" >&2
  for id in "${MISSING[@]}"; do
    echo "  - $id" >&2
  done
  echo "" >&2
fi

if [ ${#INCOMPLETE[@]} -gt 0 ]; then
  echo "register entry 不完整：" >&2
  for item in "${INCOMPLETE[@]}"; do
    echo "  - $item" >&2
  done
  echo "" >&2
fi

cat >&2 <<'EOF'
修正方式：
  - 補寫 docs/tech-debt.md 對應 entry（Status / Priority / Problem / Fix approach / Acceptance 四段）
  - Status: wontfix 必須搭配 Reason 段落
  - 或從 tasks.md 移除對應 marker（若問題已無效）

規則：.claude/rules/follow-up-register.md
EOF

exit 2
