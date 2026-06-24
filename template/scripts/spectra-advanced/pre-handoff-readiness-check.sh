#!/usr/bin/env bash
# spectra-advanced: pre-handoff readiness check
#
# Validates that verify channels are complete before Step 8b review-gui handoff.
# Prevents premature handoff where review-gui shows "0/N passed".
#
# Checks:
#   Check 1: Automatic verify unflipped — [verify:e2e]/[verify:api] items with
#            (verified-*:) annotation but checkbox still [ ] → MUST be auto-flipped
#   Check 2: Evidence missing — [verify:e2e]/[verify:api]/[verify:ui] items
#            without corresponding (verified-*:) annotation → evidence not collected
#   Check 3: Unresolved issues — items with （issue:） but no (claude-analyzed:)
#            or (awaiting-user-decision:) → issue not triaged
#
# Usage:
#   pre-handoff-readiness-check.sh <change-name>
#
# Exit codes:
#   0 = ready for review-gui handoff
#   2 = not ready (blockers found)

set -euo pipefail

CHANGE="${1:?Usage: pre-handoff-readiness-check.sh <change-name>}"
TASKS="openspec/changes/$CHANGE/tasks.md"

if [ ! -f "$TASKS" ]; then
  echo "❌ tasks.md not found: $TASKS" >&2
  exit 2
fi

# Extract ## 人工檢查 section
SECTION=$(awk '/^## 人工檢查/{found=1; next} /^## /{if(found) exit} found{print}' "$TASKS")
if [ -z "$SECTION" ]; then
  echo "✓ No ## 人工檢查 section — nothing to check" >&2
  exit 0
fi

# Pre-compute parent IDs (parents = #N items that have #N.M children)
PARENT_IDS=$(echo "$SECTION" | grep -oE '#[0-9]+\.[0-9]+' | sed 's/\.[0-9]*$//' | sort -u | sed 's/#//')

FAILS=0
WARNS=0
TOTAL=0
DONE=0

while IFS= read -r line; do
  # Skip empty/non-checkbox lines
  [ -z "$line" ] && continue
  echo "$line" | grep -qE '^\s*- \[[ x]\]' || continue

  # Extract item id
  item_id=""
  if echo "$line" | grep -qoE '#[0-9]+\.[0-9]+'; then
    item_id=$(echo "$line" | grep -oE '#[0-9]+\.[0-9]+' | head -1 | sed 's/#//')
  elif echo "$line" | grep -qoE '#[0-9]+'; then
    raw_id=$(echo "$line" | grep -oE '#[0-9]+' | head -1 | sed 's/#//')
    # Skip parent items that have children
    if echo "$PARENT_IDS" | grep -qFx "$raw_id" 2>/dev/null; then
      continue
    fi
    item_id="$raw_id"
  fi
  [ -z "$item_id" ] && continue

  TOTAL=$((TOTAL + 1))

  # Extract checkbox state
  is_done=0
  if echo "$line" | grep -q '\[x\]'; then
    is_done=1
    DONE=$((DONE + 1))
    continue
  fi

  # --- Check 1: Automatic channel annotation exists but checkbox not flipped ---
  # verify:e2e without +ui
  if echo "$line" | grep -q '\[verify:e2e\]' && ! echo "$line" | grep -q '+ui'; then
    if echo "$line" | grep -q '(verified-e2e:'; then
      echo "❌ Check 1: [verify:e2e] #$item_id has annotation but checkbox [ ] — auto-flip missing" >&2
      FAILS=$((FAILS + 1))
    fi
  fi
  # verify:api without +ui
  if echo "$line" | grep -q '\[verify:api\]' && ! echo "$line" | grep -q '+ui'; then
    if echo "$line" | grep -q '(verified-api:'; then
      echo "❌ Check 1: [verify:api] #$item_id has annotation but checkbox [ ] — auto-flip missing" >&2
      FAILS=$((FAILS + 1))
    fi
  fi

  # --- Check 2: Verify items without evidence annotation ---
  if echo "$line" | grep -q '\[verify:e2e\]' && ! echo "$line" | grep -q '(verified-e2e:'; then
    echo "❌ Check 2: [verify:e2e] #$item_id missing evidence — run Step 8a e2e channel" >&2
    FAILS=$((FAILS + 1))
  fi
  if echo "$line" | grep -q '\[verify:api\]' && ! echo "$line" | grep -q '(verified-api:'; then
    echo "❌ Check 2: [verify:api] #$item_id missing evidence — run Step 8a api channel" >&2
    FAILS=$((FAILS + 1))
  fi
  if echo "$line" | grep -q '\[verify:ui\]' && ! echo "$line" | grep -q '(verified-ui:'; then
    echo "❌ Check 2: [verify:ui] #$item_id missing evidence — run Step 8a ui channel" >&2
    FAILS=$((FAILS + 1))
  fi

  # --- Check 3: Unresolved issues ---
  if echo "$line" | grep -qE '（issue:|（issue：|\(issue:'; then
    if ! echo "$line" | grep -q '(claude-analyzed:' && ! echo "$line" | grep -q '(awaiting-user-decision:'; then
      echo "⚠ Check 3: #$item_id has unresolved issue — triage before handoff" >&2
      WARNS=$((WARNS + 1))
    fi
  fi

done <<< "$SECTION"

echo "" >&2
echo "=== Pre-handoff readiness: $DONE/$TOTAL leaf items passed, $FAILS blockers, $WARNS warnings ===" >&2

if [ "$FAILS" -gt 0 ]; then
  echo "" >&2
  echo "❌ NOT READY for review-gui handoff." >&2
  echo "   Complete Step 8a verify channel pass + auto-flip before Step 8b." >&2
  exit 2
fi

if [ "$WARNS" -gt 0 ]; then
  echo "" >&2
  echo "⚠ Warnings present but not blocking. Proceed with caution." >&2
fi

echo "✓ pre-handoff-readiness-check passed ($DONE/$TOTAL)" >&2
exit 0
