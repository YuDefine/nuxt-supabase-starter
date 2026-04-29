#!/usr/bin/env bash
# spectra-ux: post-edit drift detector for spectra-ingest
#
# Detects structural drift between the edited file and the active change's
# proposal. Emits stderr reminders so Claude notices it should consider
# `spectra-ingest` instead of silently continuing to implement.
#
# Signals covered (static, file-based):
#   - Schema drift: migration adds enum/column not mentioned in the proposal's
#     Affected Entity Matrix
#   - UI scope overflow: edited UI file's route fragment is not referenced by
#     the proposal's User Journeys or tasks.md
#
# Signals NOT covered (must be caught by the LLM in conversation):
#   - User verbally changes requirements
#   - Tasks structural reshape
#   - Risk plan invariants shift
#
# Usage:
#   ingest-drift-check.sh <edited-file>
#
# Exit: 0 always (informational; never blocks).

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"
sux_load_config

EDITED_FILE="${1:-}"
[ -n "$EDITED_FILE" ] || exit 0

CHANGE_DIR=$(sux_find_active_change) || exit 0
PROPOSAL="$CHANGE_DIR/proposal.md"
TASKS="$CHANGE_DIR/tasks.md"
[ -f "$PROPOSAL" ] || exit 0

CHANGE_NAME=$(basename "$CHANGE_DIR")
REPO_ROOT=$(sux_repo_root)

# Normalise edited path to repo-relative form so matches against config vars
# (which are always repo-relative) work cleanly.
REL_PATH=$EDITED_FILE
case "$REL_PATH" in
  /*)
    if [ "${REL_PATH#"$REPO_ROOT/"}" != "$REL_PATH" ]; then
      REL_PATH="${REL_PATH#"$REPO_ROOT/"}"
    fi
    ;;
esac

# Rate-limit: only warn once per (change, file) per session so back-to-back
# edits on the same file don't flood stderr.
FP="${CHANGE_NAME}__$(printf '%s' "$REL_PATH" | tr '/ .' '___')"
SEEN_FILE="/tmp/spectra-ux-ingest-drift-$(date +%Y%m%d)-${PPID:-$$}"
if [ -f "$SEEN_FILE" ] && grep -Fxq "$FP" "$SEEN_FILE" 2>/dev/null; then
  exit 0
fi

SIGNALS=()

# --- Signal A: migration adds enum/column not mentioned in Affected Entity Matrix ---
case "$REL_PATH" in
  "${SUX_MIGRATIONS_DIR}"/*.sql)
    MIG_ABS="$REPO_ROOT/$REL_PATH"
    if [ -f "$MIG_ABS" ]; then
      SQL_ADDED=$(grep -iE "ADD COLUMN|CREATE TYPE.*AS ENUM|CHECK[[:space:]]*\([^)]*IN[[:space:]]*\(" "$MIG_ABS" 2>/dev/null || true)
      if [ -n "$SQL_ADDED" ]; then
        MATRIX=$(sux_extract_section "$PROPOSAL" 'Affected Entity Matrix')
        # Pull identifiers (≥4 chars, skip common SQL keywords) from added lines
        # and check whether any show up in the matrix text.
        IDS=$(echo "$SQL_ADDED" \
          | grep -oE '[A-Za-z_][A-Za-z0-9_]{3,}' \
          | tr '[:upper:]' '[:lower:]' \
          | sort -u)
        MISSING=()
        while IFS= read -r id; do
          [ -z "$id" ] && continue
          case "$id" in
            add|column|create|type|enum|check|null|default|primary|references|unique|table|alter|constraint|foreign|index|unique|cascade|restrict|update|delete|insert|select|from|where|timestamp|varchar|integer|boolean|text|jsonb|json|serial|bigserial|uuid|numeric|decimal) continue ;;
          esac
          if [ -n "$MATRIX" ] && echo "$MATRIX" | grep -qiF "$id"; then
            continue
          fi
          MISSING+=("$id")
        done <<< "$IDS"
        if [ "${#MISSING[@]}" -gt 0 ]; then
          SIGNALS+=("schema: migration $(basename "$REL_PATH") 新增 identifier 未見於 Affected Entity Matrix (${MISSING[*]:0:5})")
        fi
      fi
    fi
    ;;
esac

# --- Signal B: UI edit whose route/file is not referenced by journeys or tasks ---
if sux_path_is_ui_related "$REL_PATH"; then
  # Derive URL fragment from the UI file path: strip UI dir prefix + extension,
  # drop trailing /index. Matches how journey URLs are written in proposals.
  URL_FRAG=""
  for ui_dir in $SUX_UI_DIRS; do
    case "$REL_PATH" in
      "$ui_dir"/*)
        inner="${REL_PATH#"$ui_dir"/}"
        inner="${inner%.*}"
        inner="${inner%/index}"
        URL_FRAG="/$inner"
        break
        ;;
    esac
  done

  FOUND=0
  if [ -n "$URL_FRAG" ]; then
    JOURNEY_URLS=$(sux_extract_journey_urls "$PROPOSAL")
    while IFS= read -r url; do
      [ -z "$url" ] && continue
      # Match prefix in either direction: edited file may be a subroute of a
      # journey URL, or the journey URL may be a subroute of an edited layout.
      if [ "$url" = "$URL_FRAG" ]; then
        FOUND=1
        break
      fi
      case "$URL_FRAG" in "$url"/*) FOUND=1; break ;; esac
      case "$url" in "$URL_FRAG"/*) FOUND=1; break ;; esac
    done <<< "$JOURNEY_URLS"
  fi

  if [ "$FOUND" -eq 0 ] && [ -f "$TASKS" ]; then
    base=$(basename "$REL_PATH")
    if grep -qF "$REL_PATH" "$TASKS" 2>/dev/null || grep -qF "$base" "$TASKS" 2>/dev/null; then
      FOUND=1
    fi
  fi

  if [ "$FOUND" -eq 0 ]; then
    SIGNALS+=("ui-scope: 動到 $REL_PATH，未被 proposal journeys 或 tasks.md 指涉")
  fi
fi

# --- Emit ---
if [ "${#SIGNALS[@]}" -gt 0 ]; then
  printf '%s\n' "$FP" >> "$SEEN_FILE" 2>/dev/null || true
  {
    echo "[Ingest Drift] active change: ${CHANGE_NAME}"
    for s in "${SIGNALS[@]}"; do
      echo "  · $s"
    done
    echo ""
    echo "若此為預期外漂移 → 依決策規則（見 proactive-skills.md → Ingest Triggers）："
    echo "  · 信號明確 → 直接跑 \`spectra-ingest\` 並口頭告知"
    echo "  · 信號模糊 → 先詢問使用者要 ingest 還是當前 tasks 微調"
    echo "若 proposal 已涵蓋但用字不同 → 可忽略此警告"
  } >&2
fi

exit 0
