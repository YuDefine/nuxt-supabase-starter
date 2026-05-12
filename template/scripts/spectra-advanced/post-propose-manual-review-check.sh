#!/usr/bin/env bash
# spectra-advanced: post-propose manual-review item enforcement
#
# Layer B of the three-layer defense for Pre-Review Data Readiness hard rule
# (manual-review.md). Runs after post-propose-check.sh in the Final Verification
# Check chain of /spectra-propose.
#
# Validates ## 人工檢查 items against 4 regex patterns sourced from
# vendor/snippets/manual-review-enforcement/patterns.json (single source-of-truth
# shared with vendor/scripts/review-gui.mts).
#
# Usage:
#   post-propose-manual-review-check.sh                  → finds latest active change
#   post-propose-manual-review-check.sh <change-name>    → checks specific change
#
# Exit:
#   0 — all items pass
#   2 — one or more findings (block /spectra-apply)
#   1 — script error (missing patterns.json / jq / tasks.md)
#
# Bypass:
#   Items containing `@no-manual-review-check[<reason>]` trailing marker
#   skip regex evaluation. The reason is emitted to stderr as an info log.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"

# Locate patterns.json relative to repo root.
REPO_ROOT=$(sux_repo_root)
PATTERNS_FILE="${REPO_ROOT}/vendor/snippets/manual-review-enforcement/patterns.json"

if [ ! -f "$PATTERNS_FILE" ]; then
  echo "✗ post-propose-manual-review-check: patterns.json not found at $PATTERNS_FILE" >&2
  echo "  This file is the single source-of-truth shared with review-gui.mts." >&2
  echo "  See vendor/snippets/manual-review-enforcement/README.md" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "✗ post-propose-manual-review-check: \`jq\` is required to read patterns.json" >&2
  exit 1
fi

# Locate change.
CHANGE_NAME="${1:-}"
if [ -z "$CHANGE_NAME" ]; then
  CHANGE_NAME=$(sux_find_active_change || true)
  if [ -z "$CHANGE_NAME" ]; then
    echo "✗ post-propose-manual-review-check: no active change and no name argument given" >&2
    exit 1
  fi
fi

CHANGE_DIR=$(sux_find_change_by_name "$CHANGE_NAME" || true)
if [ -z "$CHANGE_DIR" ] || [ ! -d "$CHANGE_DIR" ]; then
  echo "✗ post-propose-manual-review-check: change \"$CHANGE_NAME\" not found" >&2
  exit 1
fi

TASKS_FILE="${CHANGE_DIR}/tasks.md"
if [ ! -f "$TASKS_FILE" ]; then
  echo "✗ post-propose-manual-review-check: tasks.md not found at $TASKS_FILE" >&2
  exit 1
fi

# Extract ## 人工檢查 block. Lines kept with original 1-indexed line numbers
# (relative to tasks.md) so findings can cite line numbers.
declare -a manual_block_lines=()
declare -a manual_block_lineno=()
in_manual=false
line_no=0
while IFS= read -r raw_line || [ -n "$raw_line" ]; do
  line_no=$((line_no + 1))
  if [[ "$raw_line" =~ ^\#\#[[:space:]].*人工檢查[[:space:]]*$ ]]; then
    in_manual=true
    continue
  fi
  if $in_manual && [[ "$raw_line" =~ ^\#\#[[:space:]] ]]; then
    in_manual=false
    continue
  fi
  if $in_manual; then
    manual_block_lines+=("$raw_line")
    manual_block_lineno+=("$line_no")
  fi
done < "$TASKS_FILE"

if [ "${#manual_block_lines[@]}" -eq 0 ]; then
  echo "✓ post-propose-manual-review-check: no ## 人工檢查 block (skipping)" >&2
  exit 0
fi

# Bypass marker detection. Per canonical schema (manual-review.md), the marker
# MUST be a trailing token at end-of-line, optionally followed by @no-screenshot.
# Empty reason `@no-manual-review-check[]` and bare `@no-manual-review-check`
# without brackets are invalid (treated as if no marker present).
BYPASS_PATTERN=$(jq -r '.bypass.marker' "$PATTERNS_FILE")
BYPASS_REGEX="${BYPASS_PATTERN}\\[([^][]+)\\]([[:space:]]+@no-screenshot)?[[:space:]]*\$"

# Per-line bypass evaluation.
# Returns the bypass reason on stdout if the line is bypassed, else empty.
extract_bypass_reason() {
  local line="$1"
  if [[ "$line" =~ ${BYPASS_REGEX} ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
  fi
}

# Detect whether a parent line has scoped sub-items in the block.
# Args: parent line index (0-based into manual_block_lines)
# Returns: 0 if has children, 1 if not.
parent_has_scoped_children() {
  local idx=$1
  local parent="${manual_block_lines[$idx]}"
  # Extract parent id (e.g. #7).
  if ! [[ "$parent" =~ \#([0-9]+)[^.0-9] ]]; then
    return 1
  fi
  local parent_id="${BASH_REMATCH[1]}"
  local next=$((idx + 1))
  while [ $next -lt "${#manual_block_lines[@]}" ]; do
    local n="${manual_block_lines[$next]}"
    # Stop at next parent item.
    if [[ "$n" =~ ^-[[:space:]]*\[[[:space:]x]\][[:space:]]+\#[0-9]+[^.0-9] ]]; then
      break
    fi
    if [[ "$n" =~ \#${parent_id}\.[0-9]+ ]]; then
      return 0
    fi
    next=$((next + 1))
  done
  return 1
}

# Detect whether a line is a #N.M scoped sub-item.
is_scoped_child() {
  [[ "$1" =~ \#[0-9]+\.[0-9]+ ]]
}

# Detect whether a line is a parent item line (`- [ ] #N [marker] ...`).
is_parent_item() {
  [[ "$1" =~ ^-[[:space:]]*\[[[:space:]x]\][[:space:]]+\#[0-9]+[^.0-9] ]]
}

# Returns parent's #N id, or empty if not a parent.
parent_id_of() {
  local line="$1"
  if [[ "$line" =~ \#([0-9]+)[^.0-9] ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
  fi
}

# Build the full item block content (parent + scoped children) starting at idx.
# Joins lines with newlines so multi-line regex evaluation works.
item_block_content() {
  local idx=$1
  local parent="${manual_block_lines[$idx]}"
  local pid
  pid=$(parent_id_of "$parent")
  if [ -z "$pid" ]; then
    printf '%s' "$parent"
    return
  fi
  local content="$parent"
  local next=$((idx + 1))
  while [ $next -lt "${#manual_block_lines[@]}" ]; do
    local n="${manual_block_lines[$next]}"
    if is_parent_item "$n"; then
      break
    fi
    if [[ "$n" =~ \#${pid}\.[0-9]+ ]]; then
      content="${content}"$'\n'"${n}"
    fi
    next=$((next + 1))
  done
  printf '%s' "$content"
}

# Load pattern count.
PATTERN_COUNT=$(jq '.patterns | length' "$PATTERNS_FILE")

# Findings buffer.
declare -a findings=()

for i in $(seq 0 $((PATTERN_COUNT - 1))); do
  CODE=$(jq -r ".patterns[$i].code" "$PATTERNS_FILE")
  REGEX=$(jq -r ".patterns[$i].regex" "$PATTERNS_FILE")
  REGEX_FLAGS=$(jq -r ".patterns[$i].regexFlags // \"\"" "$PATTERNS_FILE")
  DESC=$(jq -r ".patterns[$i].description" "$PATTERNS_FILE")
  REMEDIATION=$(jq -r ".patterns[$i].remediation" "$PATTERNS_FILE")
  ANCHOR=$(jq -r ".patterns[$i].anchor" "$PATTERNS_FILE")
  REQ_PRESENCE=$(jq -r ".patterns[$i].requiresPresenceOf // \"\"" "$PATTERNS_FILE")
  REQ_ABSENCE=$(jq -r ".patterns[$i].requiresAbsenceOf // \"\"" "$PATTERNS_FILE")
  APPLIES_TO=$(jq -r ".patterns[$i].appliesTo // \"\"" "$PATTERNS_FILE")

  # Build grep flags. `i` flag → case-insensitive.
  grep_flags='-E'
  if [[ "$REGEX_FLAGS" == *i* ]]; then
    grep_flags="$grep_flags -i"
  fi

  for idx in "${!manual_block_lines[@]}"; do
    line="${manual_block_lines[$idx]}"
    real_lineno="${manual_block_lineno[$idx]}"

    # Skip blank or non-checkbox lines for pattern checks unless pattern explicitly targets them.
    [ -z "$(printf '%s' "$line" | tr -d '[:space:]')" ] && continue

    # Apply appliesTo restriction.
    if [ "$APPLIES_TO" = "parentLineOnly" ] && is_scoped_child "$line"; then
      continue
    fi

    # Bypass check — skip evaluation and emit info log once per line (across all patterns).
    bypass_reason=$(extract_bypass_reason "$line")
    if [ -n "$bypass_reason" ]; then
      # Emit once per line — but here we iterate patterns × lines, so guard.
      if [ "$i" -eq 0 ]; then
        echo "[info] tasks.md:${real_lineno} bypass: ${bypass_reason}" >&2
      fi
      continue
    fi

    # Primary regex match.
    if ! printf '%s\n' "$line" | grep $grep_flags -q -- "$REGEX"; then
      continue
    fi

    # For parent items, evaluate requiresPresenceOf / requiresAbsenceOf against
    # the full item block (parent + scoped children). For scoped children,
    # evaluate against the line itself.
    if is_parent_item "$line"; then
      scope_content=$(item_block_content "$idx")
    else
      scope_content="$line"
    fi

    # requiresPresenceOf: pattern fires when primary matches AND this regex is ABSENT from the item block.
    if [ -n "$REQ_PRESENCE" ]; then
      if printf '%s\n' "$scope_content" | grep -E -q -- "$REQ_PRESENCE"; then
        continue
      fi
    fi

    # requiresAbsenceOf: pattern fires when primary matches AND this regex is ABSENT from the item block.
    if [ -n "$REQ_ABSENCE" ]; then
      if printf '%s\n' "$scope_content" | grep -E -q -- "$REQ_ABSENCE"; then
        continue
      fi
    fi

    # MULTI_STEP_NOT_SCOPED: also pass if parent has scoped children.
    if [ "$CODE" = "MULTI_STEP_NOT_SCOPED" ] && parent_has_scoped_children "$idx"; then
      continue
    fi

    findings+=("${CODE}|${real_lineno}|${DESC}|${REMEDIATION}|${ANCHOR}|${line}")
  done
done

# Output.
if [ "${#findings[@]}" -eq 0 ]; then
  echo "✓ post-propose-manual-review-check passed (${#manual_block_lines[@]} items in ## 人工檢查 block)"
  exit 0
fi

echo "✗ post-propose-manual-review-check: ${#findings[@]} finding(s) in $TASKS_FILE" >&2
echo "" >&2
for f in "${findings[@]}"; do
  IFS='|' read -r code lineno desc remediation anchor item <<< "$f"
  echo "  [${code}] tasks.md:${lineno}" >&2
  echo "    Item: ${item}" >&2
  echo "    Issue: ${desc}" >&2
  echo "    Fix: ${remediation}" >&2
  echo "    Anchor: ${anchor}" >&2
  echo "" >&2
done

cat >&2 <<'EOF'
Resolution paths:

1. Rewrite item per .claude/rules/manual-review.md「Pre-Review Data Readiness」 +「[review:ui] 純功能驗證 step actionability」:
   - Inline specific sample identifier (UID / business key / PK) from docs/FIXTURES.md
   - Split arrow chains into #N.M scoped sub-items (one atomic action per line)
   - Add concrete URL (e.g., /kiosk/workstation) instead of generic page names
   - Replace vague verbs (「正常」「正確」「能用」) with falsifiable observations

2. If a finding is a legitimate false positive (e.g., SMS verification with no dev replay endpoint),
   add `@no-manual-review-check[<reason>]` to the item:

     - [ ] #N [review:ui] 真機掃 SMS 驗證碼 @no-manual-review-check[SMS gateway 無 dev replay endpoint]

3. Or run `/spectra-ingest` to rewrite ## 人工檢查 from scratch.

EOF

exit 2
