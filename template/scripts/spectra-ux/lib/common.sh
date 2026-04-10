#!/usr/bin/env bash
# spectra-ux common functions — sourced by the gate scripts.
#
# Provides:
#   sux_repo_root            — find the project root (cwd-aware)
#   sux_load_config          — load spectra-ux.config.json into env vars
#   sux_find_active_change   — locate the most recent active spectra change
#   sux_find_change_by_name  — locate a change by name
#   sux_extract_journey_urls — extract URLs from a proposal's User Journeys
#   sux_check_url_touched    — check if a URL's .vue path was touched in git diff

# Idempotent guard so multiple sources don't redefine.
if [ -n "${SUX_COMMON_LOADED:-}" ]; then
  return 0
fi
SUX_COMMON_LOADED=1

sux_repo_root() {
  if [ -n "${CLAUDE_PROJECT_DIR:-}" ] && [ -d "$CLAUDE_PROJECT_DIR/.git" ]; then
    echo "$CLAUDE_PROJECT_DIR"
    return 0
  fi
  git rev-parse --show-toplevel 2>/dev/null || pwd
}

# Load spectra-ux.config.json paths into SUX_* env vars.
# Falls back to sensible defaults (Nuxt convention).
sux_load_config() {
  local root config
  root=$(sux_repo_root)
  config="$root/spectra-ux.config.json"

  # Defaults
  SUX_TYPES_DIRS="shared/types"
  SUX_UI_DIRS="app/pages app/components"
  SUX_UI_EXT=".vue"
  SUX_MIGRATIONS_DIR="supabase/migrations"
  SUX_NAV_FILES="app/layouts/default.vue"
  SUX_SCRIPTS_DIR="scripts"
  SUX_OPENSPEC_DIR="openspec"

  if [ -f "$config" ] && command -v jq >/dev/null 2>&1; then
    SUX_TYPES_DIRS=$(jq -r '.paths.types | if type=="array" then join(" ") else . end // "shared/types"' "$config" 2>/dev/null)
    SUX_UI_DIRS=$(jq -r '.paths.ui | if type=="array" then join(" ") else . end // "app/pages app/components"' "$config" 2>/dev/null)
    SUX_UI_EXT=$(jq -r '.paths.uiExtensions | if type=="array" then .[0] else . end // ".vue"' "$config" 2>/dev/null)
    SUX_MIGRATIONS_DIR=$(jq -r '.paths.migrations // "supabase/migrations"' "$config" 2>/dev/null)
    SUX_NAV_FILES=$(jq -r '.paths.navigation | if type=="array" then join(" ") else . end // "app/layouts/default.vue"' "$config" 2>/dev/null)
    SUX_SCRIPTS_DIR=$(jq -r '.paths.scripts // "scripts"' "$config" 2>/dev/null)
    SUX_OPENSPEC_DIR=$(jq -r '.paths.openspec // "openspec"' "$config" 2>/dev/null)
  fi

  export SUX_TYPES_DIRS SUX_UI_DIRS SUX_UI_EXT SUX_MIGRATIONS_DIR SUX_NAV_FILES SUX_SCRIPTS_DIR SUX_OPENSPEC_DIR
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

# Extract relative URLs (e.g. /nfc-cards) from the User Journeys section.
sux_extract_journey_urls() {
  local proposal=$1
  [ -f "$proposal" ] || return 0
  sed -n '/^## User Journeys/,/^## /p' "$proposal" 2>/dev/null \
    | grep -oE '`/[a-z0-9_/-]+`' \
    | sort -u \
    | tr -d '`'
}

# Test whether a URL maps to a touched .vue path in current git diff.
# Returns 0 if touched, 1 if untouched.
sux_check_url_touched() {
  local url=$1
  local ui_dir page_path index_path touched
  touched=$(git diff --name-only HEAD 2>/dev/null; git diff --cached --name-only 2>/dev/null)

  for ui_dir in $SUX_UI_DIRS; do
    page_path="${ui_dir}${url}${SUX_UI_EXT}"
    index_path="${ui_dir}${url}/index${SUX_UI_EXT}"
    if echo "$touched" | grep -qE "^(${page_path}|${index_path})$"; then
      return 0
    fi
  done
  return 1
}

# Check whether a path actually exists in the project (any UI dir).
sux_url_has_page() {
  local url=$1 root ui_dir page_path index_path
  root=$(sux_repo_root)
  for ui_dir in $SUX_UI_DIRS; do
    page_path="$root/${ui_dir}${url}${SUX_UI_EXT}"
    index_path="$root/${ui_dir}${url}/index${SUX_UI_EXT}"
    if [ -f "$page_path" ] || [ -f "$index_path" ]; then
      return 0
    fi
  done
  return 1
}
