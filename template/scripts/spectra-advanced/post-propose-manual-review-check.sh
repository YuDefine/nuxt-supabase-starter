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

# For a scoped sub-item at idx, find the enclosing parent's idx by walking
# backwards until is_parent_item matches. Returns the parent idx on stdout,
# or empty string if no parent found (malformed input).
parent_idx_of_child() {
  local idx=$1
  local prev=$((idx - 1))
  while [ $prev -ge 0 ]; do
    local p="${manual_block_lines[$prev]}"
    if is_parent_item "$p"; then
      printf '%s' "$prev"
      return
    fi
    prev=$((prev - 1))
  done
  printf ''
}

# Compute the group block (parent + all scoped sub-items) that the given line
# idx belongs to. Used by patterns with `requiresAbsenceOfScope: "group"` so
# parent and sub-items share a single evaluation scope.
group_block_for() {
  local idx=$1
  local line="${manual_block_lines[$idx]}"
  if is_parent_item "$line"; then
    item_block_content "$idx"
    return
  fi
  local parent_idx
  parent_idx=$(parent_idx_of_child "$idx")
  if [ -z "$parent_idx" ]; then
    printf '%s' "$line"
    return
  fi
  item_block_content "$parent_idx"
}

# v1.6.0 cross-file enrichment. For UI_URL_LOCALHOST_WITH_TUNNEL_AVAILABLE hits,
# grep the consumer's `.env*` for TUNNEL_HOSTNAME so the remediation carries the
# concrete tunnel host the author should swap in. Different model from
# run_page_display_check: this one can also SUPPRESS the hit when the consumer
# has no tunnel configured (e.g. yuntech-usr-sroi) — return exit 1 → main loop
# `continue`s past the hit. Returns evidence string on stdout + exit 0 when the
# hit should fire; exits 1 when the hit should be suppressed.
run_tunnel_check() {
  local line="$1"
  local host=""
  local source_env=""
  # Scan common env file names + any `.env.<app>` for multi-app consumers (perno).
  local candidates=("$REPO_ROOT/.env.local" "$REPO_ROOT/.env" "$REPO_ROOT/.env.development" "$REPO_ROOT/.env.dev")
  while IFS= read -r ef; do
    candidates+=("$ef")
  done < <(find "$REPO_ROOT" -maxdepth 2 -type f -name '.env.*' 2>/dev/null)
  for ef in "${candidates[@]}"; do
    [ -f "$ef" ] || continue
    local v
    v=$(grep -E '^TUNNEL_HOSTNAME=' "$ef" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
    if [ -n "$v" ]; then
      host="$v"
      source_env="$ef"
      break
    fi
  done
  if [ -z "$host" ]; then
    # No tunnel configured — suppress hit. The author legitimately needs localhost.
    return 1
  fi
  # Strip absolute path prefix from source_env for readability.
  local rel_env="${source_env#$REPO_ROOT/}"
  printf '[tunnel-check] %s 有 TUNNEL_HOSTNAME=%s → 改寫 item URL 為 `https://%s/<path>?<query>`（保留原 path + query string）' \
    "$rel_env" "$host" "$host"
  return 0
}

# Layer A page-display enrichment (v1.5.0). For VERIFY_UI_SAMPLE_KEY_DISPLAY_CHECK
# hits, reverse-grep the target .vue page so the remediation carries concrete
# evidence (which identifier columns / literal key are present). Returns a
# single-line evidence string (no pipe / newline) on stdout, or empty if node /
# the helper is unavailable (degrade gracefully — the static remediation stands).
DISPLAY_CHECK_HELPER="$SCRIPT_DIR/page-display-check.mjs"
run_page_display_check() {
  local line="$1"
  command -v node >/dev/null 2>&1 || return 0
  [ -f "$DISPLAY_CHECK_HELPER" ] || return 0
  local url key json resolved keyFound hintsFound searched literal
  url=$(printf '%s\n' "$line" | grep -oE 'https?://[^ ]+|/[a-zA-Z0-9/_-]+' | head -1)
  [ -z "$url" ] && return 0
  key=$(printf '%s\n' "$line" | grep -oiE 'EMP-[0-9]+|contract-[a-z-]+[0-9]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
  json=$(node "$DISPLAY_CHECK_HELPER" --consumer-path "$REPO_ROOT" --url "$url" --key "$key" 2>/dev/null) || return 0
  [ -z "$json" ] && return 0
  resolved=$(printf '%s' "$json" | jq -r '.resolvedFile // ""')
  keyFound=$(printf '%s' "$json" | jq -r '.keyLiteralFound')
  hintsFound=$(printf '%s' "$json" | jq -r '.columnHintsFound | join(", ")')
  searched=$(printf '%s' "$json" | jq -r '.columnHintsSearched | join(", ")')
  if [ -z "$resolved" ]; then
    printf '[page-grep] 找不到對應 page 檔（試過 app/pages、pages 標準路徑）；請手動確認 %s 是否在某 column 顯示，否則改 [review:ui]' "${key:-sample key}"
  elif [ -z "$hintsFound" ] && [ "$keyFound" != "true" ]; then
    printf '[page-grep] grep %s：無 identifier column（%s）亦無 literal %s → 該 key 很可能非直接顯示的 column，改 [review:ui] 或改指向實際顯示的 column' "$resolved" "${searched:-無 hint}" "${key:-key}"
  else
    literal=""
    [ "$keyFound" = "true" ] && literal=" + literal ${key}"
    printf '[page-grep] grep %s：找到 %s%s；若 page-load screenshot 真在該 column 顯示 %s 則保 [verify:ui]，否則改 [review:ui]' "$resolved" "${hintsFound:-}" "$literal" "${key:-key}"
  fi
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
  REQ_PRESENCE_SCOPE=$(jq -r ".patterns[$i].requiresPresenceOfScope // \"\"" "$PATTERNS_FILE")
  REQ_ABSENCE_SCOPE=$(jq -r ".patterns[$i].requiresAbsenceOfScope // \"\"" "$PATTERNS_FILE")
  APPLIES_TO=$(jq -r ".patterns[$i].appliesTo // \"\"" "$PATTERNS_FILE")
  # requiresKindIn: pipe-joined allowed kinds (e.g. "review:ui" or "review:ui|verify:ui").
  # Empty string means no kind filter.
  KIND_FILTER=$(jq -r ".patterns[$i].requiresKindIn // [] | join(\"|\")" "$PATTERNS_FILE")

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
    if ! printf '%s\n' "$line" | grep -qE '^[[:space:]]*-[[:space:]]*\[[ xX]\]'; then
      continue
    fi

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

    # Strip (verified-*: ...) annotations + trailing markers before primary regex.
    # Verified annotations are evidence/metadata recorded during verification —
    # jargon there reflects DOM truth at verify time (e.g., `dom=weekly_target
    # 尚未設定 visible` is the real screen state), not authoring drift in the
    # description. Trailing markers (@followup, @no-screenshot, @no-manual-
    # review-check) are metadata too. Patterns evaluate item description only.
    stripped_line=$(printf '%s\n' "$line" | sed -E \
      -e 's/\(verified-[a-z]+:[^)]*\)//g' \
      -e 's/@followup\[[^]]*\]//g' \
      -e 's/@no-screenshot//g' \
      -e 's/@no-manual-review-check(\[[^]]*\])?//g')

    # Primary regex match (on stripped line so annotation jargon doesn't fire).
    if ! printf '%s\n' "$stripped_line" | grep $grep_flags -q -- "$REGEX"; then
      continue
    fi

    # requiresKindIn: pattern only fires when item's leading kind marker is in the allowed list.
    # Example: MULTI_STEP_NOT_SCOPED uses requiresKindIn: ["review:ui"] so it doesn't over-fire
    # on [verify:api] / [verify:api+ui] / [verify:e2e] items (verify channels — agent runs the
    # round-trip itself, not the user; arrow chains there describe agent-verifiable evidence).
    if [ -n "$KIND_FILTER" ]; then
      # Match all legal markers: review:ui / verify:api / verify:e2e (digit) /
      # verify:e2e+ui (multi-channel) / bare discuss (no colon). The `:[a-z0-9+]+`
      # group is optional so `[discuss]` matches; `0-9` covers `e2e`. `|| true`
      # keeps an unmatched/malformed line from tripping `set -e` before the
      # `-z "$ITEM_KIND"` continue-guard below can handle it.
      ITEM_KIND=$(printf '%s\n' "$line" | grep -oE '\[(review|verify|discuss)(:[a-z0-9+]+)?\]' | head -1 | tr -d '[]' || true)
      if [ -z "$ITEM_KIND" ] || ! printf '%s\n' "$ITEM_KIND" | grep -qE "^(${KIND_FILTER})$"; then
        continue
      fi
    fi

    # For parent items, evaluate requiresPresenceOf / requiresAbsenceOf against
    # the full item block (parent + scoped children). For scoped children,
    # evaluate against the line itself by default. Patterns may opt into
    # `requiresAbsenceOfScope: "group"` / `requiresPresenceOfScope: "group"`
    # to share a single scope across parent + sub-items (e.g. UI_ITEM_NO_URL —
    # any URL in the group satisfies the rule, including continuation sub-items
    # that inherit a sibling's URL context).
    if is_parent_item "$line"; then
      scope_content=$(item_block_content "$idx")
    else
      scope_content="$line"
    fi

    # requiresPresenceOf: pattern fires when primary matches AND this regex is ABSENT from the item block.
    if [ -n "$REQ_PRESENCE" ]; then
      presence_scope="$scope_content"
      if [ "$REQ_PRESENCE_SCOPE" = "group" ]; then
        presence_scope=$(group_block_for "$idx")
      fi
      if printf '%s\n' "$presence_scope" | grep -E -q -- "$REQ_PRESENCE"; then
        continue
      fi
    fi

    # requiresAbsenceOf: pattern fires when primary matches AND this regex is ABSENT from the item block.
    if [ -n "$REQ_ABSENCE" ]; then
      absence_scope="$scope_content"
      if [ "$REQ_ABSENCE_SCOPE" = "group" ]; then
        absence_scope=$(group_block_for "$idx")
      fi
      if printf '%s\n' "$absence_scope" | grep -E -q -- "$REQ_ABSENCE"; then
        continue
      fi
    fi

    # MULTI_STEP_NOT_SCOPED: also pass if parent has scoped children.
    if [ "$CODE" = "MULTI_STEP_NOT_SCOPED" ] && parent_has_scoped_children "$idx"; then
      continue
    fi

    # Layer A: enrich VERIFY_UI_SAMPLE_KEY_DISPLAY_CHECK remediation with concrete
    # reverse page-grep evidence. Enrich-only — never suppress the hit (the
    # incident's column key lives in <script> UTable config, so a whole-file grep
    # match is not proof of render; the author decides using the grep evidence).
    eff_remediation="$REMEDIATION"
    if [ "$CODE" = "VERIFY_UI_SAMPLE_KEY_DISPLAY_CHECK" ]; then
      page_evidence=$(run_page_display_check "$line")
      if [ -n "$page_evidence" ]; then
        eff_remediation="${REMEDIATION} — ${page_evidence}"
      fi
    fi

    # v1.6.0: UI_URL_LOCALHOST_WITH_TUNNEL_AVAILABLE — cross-file env check.
    # Suppress when consumer has no TUNNEL_HOSTNAME (legitimate localhost-only
    # consumers like yuntech-usr-sroi); enrich when tunnel exists.
    if [ "$CODE" = "UI_URL_LOCALHOST_WITH_TUNNEL_AVAILABLE" ]; then
      if ! tunnel_evidence=$(run_tunnel_check "$line"); then
        continue
      fi
      if [ -n "$tunnel_evidence" ]; then
        eff_remediation="${REMEDIATION} — ${tunnel_evidence}"
      fi
    fi

    findings+=("${CODE}|${real_lineno}|${DESC}|${eff_remediation}|${ANCHOR}|${line}")
  done
done

# ---------------------------------------------------------------------------
# TD-176 Item A: verify:e2e feasibility advisory (warn-only — NEVER alters exit).
# review-gui correctly flags mis-marked verify items as "evidence missing", but
# the root is verify-channel markers authored at propose time without checking
# the channel is actually runnable. Here we catch the most mechanical case:
# a [verify:e2e] item in a consumer repo that has no e2e infrastructure. The
# proposing agent should reclassify (→ verify:api / verify:ui for assertions,
# → review:ui for interaction round-trips) or add Playwright infra before apply.
# Soft gate by design (per 5-Layer Phase 3.1 zero-soak hard-gate deferral): we
# print an advisory and leave the exit code untouched. This is a repo-state probe,
# deliberately NOT a patterns.json regex (that schema is text-only, no filesystem).
# ---------------------------------------------------------------------------
e2e_items=()
for idx in "${!manual_block_lines[@]}"; do
  line="${manual_block_lines[$idx]}"
  # Unchecked checkbox whose [verify:...] kind marker lists e2e as a channel
  # (covers [verify:e2e], [verify:e2e+ui], [verify:api+e2e], [verify:e2e+api+ui]).
  if printf '%s\n' "$line" | grep -qE '^[[:space:]]*-[[:space:]]*\[ \].*\[verify:([a-z0-9]+\+)*e2e(\+[a-z0-9]+)*\]'; then
    e2e_items+=("tasks.md:${manual_block_lineno[$idx]}")
  fi
done

if [ "${#e2e_items[@]}" -gt 0 ]; then
  # e2e infra present if ANY signal hits (lenient — avoid false-warn on consumers
  # that genuinely have e2e set up). template/ path covers monorepo consumers (starter).
  has_e2e_infra=false
  if find "$REPO_ROOT" -maxdepth 3 -name 'playwright.config.*' -not -path '*/node_modules/*' 2>/dev/null | grep -q .; then
    has_e2e_infra=true
  elif [ -f "$REPO_ROOT/package.json" ] && jq -e '(.scripts // {}) | (has("test:e2e") or has("test:e2e:verify"))' "$REPO_ROOT/package.json" >/dev/null 2>&1; then
    has_e2e_infra=true
  elif [ -f "$REPO_ROOT/e2e/fixtures/index.ts" ] || [ -f "$REPO_ROOT/template/e2e/fixtures/index.ts" ]; then
    has_e2e_infra=true
  fi

  if [ "$has_e2e_infra" = false ]; then
    echo "⚠ post-propose-manual-review-check [TD-176 verify:e2e feasibility]: ${#e2e_items[@]} item(s) marked [verify:e2e] but this repo has no e2e infra" >&2
    echo "    (no playwright.config.*, no test:e2e / test:e2e:verify script, no e2e/fixtures/index.ts)" >&2
    for it in "${e2e_items[@]}"; do
      echo "    - ${it}" >&2
    done
    echo "    Advisory (warn-only, does NOT block apply): reclassify the marker, or add Playwright infra." >&2
    echo "      · final-state visual assertion → [verify:ui]" >&2
    echo "      · API round-trip assertion     → [verify:api]" >&2
    echo "      · interaction round-trip (建立/編輯/輸入/點/存) → [review:ui]" >&2
    echo "      · genuinely needs Playwright journey → add e2e infra (playwright.config + e2e/fixtures)" >&2
    echo "    See .claude/rules/manual-review.evidence.md Kind 分類指引." >&2
    echo "" >&2
  fi
fi

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
