#!/usr/bin/env bash
# spectra-advanced common functions — sourced by the gate scripts.
#
# (Function/var prefix `sux_` / `SUX_` retained from the legacy `spectra-ux`
#  package name — internal API, not renamed in this rename change to keep the
#  diff focused on the directory + path rename.)
#
# Provides:
#   sux_repo_root            — find the project root (cwd-aware, agent-agnostic)
#   sux_load_config          — load spectra-advanced.config.json (or legacy spectra-ux.config.json) into env vars
#   sux_find_active_change   — locate the most recent active spectra change
#   sux_find_change_by_name  — locate a change by name
#   sux_extract_journey_urls — extract URLs from a proposal's User Journeys
#   sux_extract_section      — extract a ## Section from a markdown file
#   sux_touched_files        — list git-tracked files touched in working tree + index
#   sux_change_touched_files — list files touched for a specific change
#   sux_count_marker         — count bypass markers in a file, defaults to 0
#   sux_check_url_touched    — check if a URL's page file was touched in git diff
#   sux_url_has_page         — check if a URL maps to any existing page file
#   sux_path_is_ui_related   — check if a file path points at a configured UI file
#   sux_tasks_has_ui_scope   — check if tasks.md text mentions configured UI files/dirs

# Idempotent guard so multiple sources don't redefine.
if [ -n "${SUX_COMMON_LOADED:-}" ]; then
  return 0
fi
SUX_COMMON_LOADED=1

# Find the project root. Precedence:
#   1. SPECTRA_UX_PROJECT_DIR (agent-agnostic, explicit opt-in)
#   2. CLAUDE_PROJECT_DIR (Claude Code convention, must point to a git root)
#   3. git rev-parse from cwd (universal fallback)
#   4. pwd (last resort)
sux_repo_root() {
  if [ -n "${SPECTRA_UX_PROJECT_DIR:-}" ] && [ -d "$SPECTRA_UX_PROJECT_DIR" ]; then
    echo "$SPECTRA_UX_PROJECT_DIR"
    return 0
  fi
  if [ -n "${CLAUDE_PROJECT_DIR:-}" ] && [ -d "$CLAUDE_PROJECT_DIR/.git" ]; then
    echo "$CLAUDE_PROJECT_DIR"
    return 0
  fi
  git rev-parse --show-toplevel 2>/dev/null || pwd
}

# Load spectra-advanced.config.json paths into SUX_* env vars.
# Legacy fallback: if the new file is absent, read spectra-ux.config.json
# (the pre-rename filename). Consumers migrate naturally on the next propagate
# (propagate.mjs renames the file) so the fallback can be removed in a future
# major bump.
# Falls back to sensible defaults (Nuxt convention) for any missing field.
sux_load_config() {
  local root config
  root=$(sux_repo_root)
  config="$root/spectra-advanced.config.json"
  if [ ! -f "$config" ] && [ -f "$root/spectra-ux.config.json" ]; then
    config="$root/spectra-ux.config.json"
  fi

  # Defaults
  SUX_TYPES_DIRS="shared/types"
  SUX_UI_DIRS="app/pages app/components"
  SUX_UI_EXTS=".vue"
  SUX_MIGRATIONS_DIR="supabase/migrations"
  SUX_NAV_FILES="app/layouts/default.vue"
  SUX_SCRIPTS_DIR="scripts"
  SUX_OPENSPEC_DIR="openspec"

  if [ -f "$config" ] && command -v jq >/dev/null 2>&1; then
    # Batch all fields in a single jq invocation to avoid ~7× spawn cost.
    # Output is tab-separated; empty fields fall back to the defaults above.
    # uiExtensions is joined with spaces to support multi-extension projects
    # (e.g. Nuxt + Vite + React hybrid reading both .vue and .tsx).
    local raw
    raw=$(jq -r '
      [
        (.paths.types       | if type=="array" then join(" ") else (. // "") end),
        (.paths.ui          | if type=="array" then join(" ") else (. // "") end),
        (.paths.uiExtensions| if type=="array" then join(" ") else (. // "") end),
        (.paths.migrations  // ""),
        (.paths.navigation  | if type=="array" then join(" ") else (. // "") end),
        (.paths.scripts     // ""),
        (.paths.openspec    // "")
      ] | @tsv
    ' "$config" 2>/dev/null)
    if [ -n "$raw" ]; then
      IFS=$'\t' read -r _f1 _f2 _f3 _f4 _f5 _f6 _f7 <<< "$raw"
      [ -n "${_f1:-}" ] && SUX_TYPES_DIRS=$_f1
      [ -n "${_f2:-}" ] && SUX_UI_DIRS=$_f2
      [ -n "${_f3:-}" ] && SUX_UI_EXTS=$_f3
      [ -n "${_f4:-}" ] && SUX_MIGRATIONS_DIR=$_f4
      [ -n "${_f5:-}" ] && SUX_NAV_FILES=$_f5
      [ -n "${_f6:-}" ] && SUX_SCRIPTS_DIR=$_f6
      [ -n "${_f7:-}" ] && SUX_OPENSPEC_DIR=$_f7
    fi
  fi

  # Primary (first) values — common shorthand for "the main type dir"
  # and "the primary UI extension". Many checks only need to act on the
  # first entry and were repeating `${VAR%% *}` inline before.
  SUX_TYPES_PRIMARY="${SUX_TYPES_DIRS%% *}"
  SUX_UI_EXT="${SUX_UI_EXTS%% *}"

  # Regex-safe form of each UI extension — escape `.` so grep -E uses them
  # as literals. Without this, `.vue$` would also match `avue`, `xvue`.
  # For multi-extension configs, join with `|` to produce an alternation:
  # `\.vue|\.tsx`.
  local ext escaped parts=""
  for ext in $SUX_UI_EXTS; do
    escaped=$(printf '%s' "$ext" | sed 's/[][\\.*^$()|?+{}]/\\&/g')
    if [ -z "$parts" ]; then
      parts=$escaped
    else
      parts="${parts}|${escaped}"
    fi
  done
  SUX_UI_EXT_RE="$parts"

  export SUX_TYPES_DIRS SUX_TYPES_PRIMARY SUX_UI_DIRS SUX_UI_EXTS SUX_UI_EXT SUX_UI_EXT_RE SUX_MIGRATIONS_DIR SUX_NAV_FILES SUX_SCRIPTS_DIR SUX_OPENSPEC_DIR
}

# Find the most recently modified active change directory.
sux_find_active_change() {
  local root openspec
  root=$(sux_repo_root)
  openspec="$root/${SUX_OPENSPEC_DIR:-openspec}/changes"
  [ -d "$openspec" ] || return 1

  local latest="" latest_mtime=0 dir mtime
  for dir in "$openspec"/*/; do
    [ -d "$dir" ] || continue
    [[ "$(basename "$dir")" == "archive" ]] && continue
    [ -f "$dir/proposal.md" ] || continue

    # macOS BSD stat / Linux GNU stat — first call fails on Linux, second on macOS.
    mtime=$(stat -f %m "$dir/proposal.md" 2>/dev/null || stat -c %Y "$dir/proposal.md" 2>/dev/null || echo 0)
    [[ "$mtime" =~ ^[0-9]+$ ]] || mtime=0
    if [ "$mtime" -gt "$latest_mtime" ]; then
      latest_mtime=$mtime
      latest="$dir"
    fi
  done

  [ -n "$latest" ] && echo "$latest" || return 1
}

# Find a change directory by name.
sux_find_change_by_name() {
  local name=$1 root openspec
  root=$(sux_repo_root)
  openspec="$root/${SUX_OPENSPEC_DIR:-openspec}/changes"
  if [ -d "$openspec/$name" ]; then
    echo "$openspec/$name"
    return 0
  fi
  return 1
}

# List files touched in the working tree + index. Computed once per script
# invocation and cached in SUX_TOUCHED_FILES to avoid repeated git calls.
# Call explicitly with `sux_touched_files --refresh` to invalidate.
sux_touched_files() {
  if [ "${1:-}" = "--refresh" ] || [ -z "${SUX_TOUCHED_FILES:-}" ]; then
    SUX_TOUCHED_FILES=$(git diff --name-only HEAD 2>/dev/null; git diff --cached --name-only 2>/dev/null)
    export SUX_TOUCHED_FILES
  fi
  printf '%s\n' "${SUX_TOUCHED_FILES:-}"
}

# List files touched for a spectra change, broadening sux_touched_files to also
# include commits since the change directory was first introduced.
sux_change_touched_files() {
  local change_dir=$1
  local repo_root first_commit base rel_path
  repo_root=$(sux_repo_root)
  rel_path=${change_dir#"$repo_root/"}

  first_commit=$(git -C "$repo_root" log --format=%H -- "$rel_path/" 2>/dev/null | tail -1)

  if [ -n "$first_commit" ] && base=$(git -C "$repo_root" rev-parse --verify "${first_commit}^" 2>/dev/null); then
    {
      git -C "$repo_root" diff --name-only "$base" HEAD 2>/dev/null
      git -C "$repo_root" diff --name-only HEAD 2>/dev/null
      git -C "$repo_root" diff --cached --name-only 2>/dev/null
    } | sort -u
  else
    {
      git -C "$repo_root" diff --name-only HEAD 2>/dev/null
      git -C "$repo_root" diff --cached --name-only 2>/dev/null
    } | sort -u
  fi
}

# Extract a `## Section` block from a markdown file. The block starts at
# the matching heading and ends before the next `## ` heading (exclusive).
sux_extract_section() {
  local file=$1 heading=$2
  [ -f "$file" ] || return 0
  sed -n "/^## ${heading}/,/^## /p" "$file" 2>/dev/null | sed '$d'
}

# Check whether a tasks / proposal file appears to include UI scope.
# This is a lightweight heuristic used by design-related gates and reminders.
sux_tasks_has_ui_scope() {
  local file=$1 ui_dir
  [ -f "$file" ] || return 1

  if grep -qiE "(${SUX_UI_EXT_RE})|pages/|components/|layouts/" "$file" 2>/dev/null; then
    return 0
  fi

  for ui_dir in $SUX_UI_DIRS; do
    if grep -qiF "${ui_dir}/" "$file" 2>/dev/null; then
      return 0
    fi
  done

  return 1
}

# Count occurrences of a bypass marker in tasks.md (or any file), defaulting
# to 0 if the file is missing or the marker is absent. Avoids the repetitive
# `grep -c ... 2>/dev/null || true; VAR=${VAR:-0}` idiom.
sux_count_marker() {
  local file=$1 marker=$2 count
  [ -f "$file" ] || { echo 0; return 0; }
  count=$(grep -c "$marker" "$file" 2>/dev/null || true)
  echo "${count:-0}"
}

# Extract relative URLs (e.g. /nfc-cards) from the User Journeys section.
sux_extract_journey_urls() {
  local proposal=$1
  [ -f "$proposal" ] || return 0
  sux_extract_section "$proposal" 'User Journeys' \
    | grep -oE '`/[a-z0-9_/-]+`' \
    | sort -u \
    | tr -d '`'
}

# Test whether a URL maps to a touched UI path in current git diff.
# Reuses SUX_TOUCHED_FILES cache. Returns 0 if touched, 1 if untouched.
sux_check_url_touched() {
  local url=$1
  local ui_dir ext touched
  touched=$(sux_touched_files)

  for ui_dir in $SUX_UI_DIRS; do
    for ext in $SUX_UI_EXTS; do
      local page_path="${ui_dir}${url}${ext}"
      local index_path="${ui_dir}${url}/index${ext}"
      if echo "$touched" | grep -qE "^(${page_path}|${index_path})$"; then
        return 0
      fi
    done
  done
  return 1
}

# Check whether a URL maps to any existing page file in any UI dir.
sux_url_has_page() {
  local url=$1 root ui_dir ext page_path index_path
  root=$(sux_repo_root)
  for ui_dir in $SUX_UI_DIRS; do
    for ext in $SUX_UI_EXTS; do
      page_path="$root/${ui_dir}${url}${ext}"
      index_path="$root/${ui_dir}${url}/index${ext}"
      if [ -f "$page_path" ] || [ -f "$index_path" ]; then
        return 0
      fi
    done
  done
  return 1
}

# Check whether a file path points to a configured UI file or directory.
sux_path_is_ui_related() {
  local path=$1 ui_dir
  [ -n "$path" ] || return 1

  case "$path" in
    *".md"|*".json"|*".yml"|*".yaml") ;;
  esac

  if echo "$path" | grep -qE "(${SUX_UI_EXT_RE})$" 2>/dev/null; then
    return 0
  fi

  for ui_dir in $SUX_UI_DIRS; do
    case "$path" in
      "$ui_dir"/*|*/"$ui_dir"/*) return 0 ;;
    esac
  done

  return 1
}

# Check whether a tasks file appears to include UI work based on configured
# UI dirs/extensions. This is text-based on purpose: propose-time tasks.md
# often references target files before they exist on disk.
sux_tasks_has_ui_scope() {
  local file=$1 ui_dir base
  [ -f "$file" ] || return 1

  if grep -qiE "(${SUX_UI_EXT_RE})" "$file" 2>/dev/null; then
    return 0
  fi

  for ui_dir in $SUX_UI_DIRS; do
    base=${ui_dir##*/}
    if grep -qiE "${ui_dir}/|${base}/" "$file" 2>/dev/null; then
      return 0
    fi
  done

  return 1
}
