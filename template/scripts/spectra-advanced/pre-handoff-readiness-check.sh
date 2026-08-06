#!/usr/bin/env bash
# spectra-advanced: pre-handoff readiness check
#
# Validates that verify channels are complete before Step 8b review-gui handoff.
# Prevents premature handoff where review-gui shows "0/N passed".
#
# Checks:
#   Check 1: Automatic verify unflipped — [verify:e2e]/[verify:api] items with
#            (verified-*:) annotation but checkbox still [ ] → MUST be auto-flipped
#            (only meaningful for unchecked items)
#   Check 2: Evidence missing — [verify:e2e]/[verify:api]/[verify:ui]/[review:ui]
#            items without corresponding evidence (inline annotation or sidecar
#            receipt) → evidence not collected. Runs on checked AND unchecked items:
#            a ticked checkbox is not evidence (per TD-419 —
#            pitfall-checked-items-exempt-from-every-pre-handoff-evidence-gate).
#   Check 2P: Parent items carrying a channel tag are exempt from their own receipt,
#            but only while at least one child supplies that channel's evidence.
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

# T7: evidence-store CLI — sidecar-first dual-track resolver
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
EVIDENCE_STORE="$SCRIPT_DIR/../lib/evidence-store.ts"
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)

has_sidecar_evidence() {
  local item_id="$1" kind="$2"
  if [ -f "$EVIDENCE_STORE" ]; then
    node "$EVIDENCE_STORE" --repo "$REPO_ROOT" --change "$CHANGE" \
      --has-evidence --kind "$kind" --item "$item_id" 2>/dev/null
    return $?
  fi
  return 1
}

# Extract ## 人工檢查 section
SECTION=$(awk '/^## 人工檢查/{found=1; next} /^## /{if(found) exit} found{print}' "$TASKS")
if [ -z "$SECTION" ]; then
  echo "✓ No ## 人工檢查 section — nothing to check" >&2
  exit 0
fi

# Pre-compute parent IDs (parents = #N items that have #N.M children).
# `|| true`: a section with no #N.M child makes grep exit 1, and under
# `set -euo pipefail` that aborted the whole script with a bare exit 1 — no output,
# and a code outside this script's documented 0/2 contract.
PARENT_IDS=$(echo "$SECTION" | grep -oE '#[0-9]+\.[0-9]+' | sed 's/\.[0-9]*$//' | sort -u | sed 's/#//' || true)

FAILS=0
WARNS=0
TOTAL=0
DONE=0

# Channel tag → (inline annotation prefix, sidecar kind). [review:ui] shares the
# verified-ui receipt kind with [verify:ui].
channel_ann() {
  case "$1" in
    'verify:e2e') echo 'verified-e2e' ;;
    'verify:api') echo 'verified-api' ;;
    'verify:ui' | 'review:ui') echo 'verified-ui' ;;
  esac
}

# True iff the item has evidence for the channel — inline annotation on the line
# OR a sidecar receipt. A ticked checkbox is NOT evidence (TD-419).
line_has_evidence() {
  local line="$1" item_id="$2" kind="$3"
  echo "$line" | grep -q "($kind:" && return 0
  has_sidecar_evidence "#$item_id" "$kind" && return 0
  return 1
}

# Parent items are checked after the loop, once every child's evidence is known.
PARENT_LINES=""
# One "<parent-id>:<sidecar-kind>" line per child that supplied that channel.
CHILD_EVIDENCE=""

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
    # Defer parents that have children — Check 2P needs the children's verdicts first.
    if echo "$PARENT_IDS" | grep -qFx "$raw_id" 2>/dev/null; then
      PARENT_LINES="${PARENT_LINES}${line}"$'\n'
      continue
    fi
    item_id="$raw_id"
  fi
  [ -z "$item_id" ] && continue

  TOTAL=$((TOTAL + 1))

  is_done=0
  if echo "$line" | grep -q '\[x\]'; then
    is_done=1
    DONE=$((DONE + 1))
  fi

  # --- Check 1: Automatic channel annotation exists but checkbox not flipped ---
  # Only meaningful while the item is still unchecked.
  if [ "$is_done" -eq 0 ]; then
    for tag in 'verify:e2e' 'verify:api'; do
      echo "$line" | grep -q "\[$tag\]" || continue
      echo "$line" | grep -q '+ui' && continue
      kind=$(channel_ann "$tag")
      if line_has_evidence "$line" "$item_id" "$kind"; then
        echo "❌ Check 1: [$tag] #$item_id has annotation but checkbox [ ] — auto-flip missing" >&2
        FAILS=$((FAILS + 1))
      fi
    done
  fi

  # --- Check 2: Verify / review items without evidence (inline OR sidecar) ---
  # Runs regardless of checkbox state — see TD-419.
  for tag in 'verify:e2e' 'verify:api' 'verify:ui' 'review:ui'; do
    echo "$line" | grep -q "\[$tag\]" || continue
    kind=$(channel_ann "$tag")
    if line_has_evidence "$line" "$item_id" "$kind"; then
      # Record for the parent's Check 2P.
      parent_id="${item_id%%.*}"
      CHILD_EVIDENCE="${CHILD_EVIDENCE}${parent_id}:${kind}"$'\n'
    else
      # A deferred item states why evidence is absent — that is a decision, not a gap.
      if echo "$line" | grep -qE '（deferred:|（deferred-user-only:|\(deferred:'; then
        continue
      fi
      echo "❌ Check 2: [$tag] #$item_id missing evidence — run Step 8a ${tag##*:} channel" >&2
      FAILS=$((FAILS + 1))
    fi
  done

  # --- Check 3: Unresolved issues (inline OR sidecar) ---
  if echo "$line" | grep -qE '（issue:|（issue：|\(issue:'; then
    has_inline_triage=false
    if echo "$line" | grep -q '(claude-analyzed:' || echo "$line" | grep -q '(awaiting-user-decision:'; then
      has_inline_triage=true
    fi
    if [ "$has_inline_triage" = false ]; then
      if ! has_sidecar_evidence "#$item_id" 'claude-analyzed' && ! has_sidecar_evidence "#$item_id" 'awaiting-user-decision'; then
        echo "⚠ Check 3: #$item_id has unresolved issue — triage before handoff" >&2
        WARNS=$((WARNS + 1))
      fi
    fi
  fi

done <<< "$SECTION"

# --- Check 2P: parent items carrying a channel tag ---
# A parent does not need its own receipt while a child supplies that channel. It
# fails only when neither the parent nor any of its children has the evidence.
while IFS= read -r line; do
  [ -z "$line" ] && continue
  parent_id=$(echo "$line" | grep -oE '#[0-9]+' | head -1 | sed 's/#//')
  [ -z "$parent_id" ] && continue
  for tag in 'verify:e2e' 'verify:api' 'verify:ui' 'review:ui'; do
    echo "$line" | grep -q "\[$tag\]" || continue
    kind=$(channel_ann "$tag")
    echo "$CHILD_EVIDENCE" | grep -qFx "${parent_id}:${kind}" && continue
    line_has_evidence "$line" "$parent_id" "$kind" && continue
    if echo "$line" | grep -qE '（deferred:|（deferred-user-only:|\(deferred:'; then
      continue
    fi
    echo "❌ Check 2P: [$tag] #$parent_id — neither the parent nor any child has $kind evidence" >&2
    FAILS=$((FAILS + 1))
  done
done <<< "$PARENT_LINES"

echo "" >&2
# "$DONE/$TOTAL checked" is a checkbox tally, NOT an evidence verdict — the verdict
# is $FAILS. Wording kept explicit per TD-419: the old "N/N passed" read as
# "everything verified" while every checked item had been skipped without a check.
echo "=== Pre-handoff readiness: $DONE/$TOTAL leaf items checked, $FAILS blockers, $WARNS warnings ===" >&2

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
