#!/usr/bin/env bash
# 🔒 LOCKED — managed by clade · Source: vendor/scripts/cbm-project.sh · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/cbm-project.sh
# Shared identity for bootstrap, refresh, and explicit index calls. Source this file.
cbm_resolve_project() {
  CBM_REPO=$(cd "${1:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}" 2>/dev/null && pwd -P) || return 1
  local repository_root
  repository_root=$(git -C "$CBM_REPO" rev-parse --show-toplevel 2>/dev/null) || repository_root=""
  [[ -z "$repository_root" ]] || CBM_REPO=$(cd "$repository_root" && pwd -P)
  CBM_CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/codebase-memory-mcp"
  CBM_PATH_ID=${CBM_REPO#/}
  CBM_PATH_ID=${CBM_PATH_ID//\//-}
  CBM_PROJECT=$CBM_PATH_ID
  CBM_NODES=0
  local git_dir git_common short_name cid
  git_dir=$(git -C "$CBM_REPO" rev-parse --path-format=absolute --git-dir 2>/dev/null) || git_dir=""
  git_common=$(git -C "$CBM_REPO" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || git_common=""
  if [[ -z "$git_dir" || "$git_dir" == "$git_common" ]]; then
    short_name=$(basename "$CBM_REPO")
    if [[ -f "$CBM_REPO/.claude/consumer-meta.json" ]]; then
      cid=$(jq -r '.consumerId // empty' "$CBM_REPO/.claude/consumer-meta.json" 2>/dev/null) || cid=""
      [[ "$cid" =~ ^[A-Za-z0-9._-]+$ ]] && short_name=$cid
    fi
    # A populated alias is safe only when its stored root identifies this repo.
    if [[ "$short_name" =~ ^[A-Za-z0-9._-]+$ ]] && cbm_alias_matches "$short_name"; then
      CBM_PROJECT=$short_name
    elif [[ ! -e "$CBM_CACHE/$short_name.db" && ! -e "$CBM_CACHE/$CBM_PATH_ID.db" && "$short_name" =~ ^[A-Za-z0-9._-]+$ ]]; then
      CBM_PROJECT=$short_name
    fi
  fi
  CBM_DB="$CBM_CACHE/$CBM_PROJECT.db"
  if [[ -f "$CBM_DB" ]] && command -v sqlite3 >/dev/null 2>&1; then
    CBM_NODES=$(sqlite3 -readonly "$CBM_DB" 'SELECT count(*) FROM nodes;' 2>/dev/null) || CBM_NODES=0
  fi
  [[ "$CBM_NODES" =~ ^[0-9]+$ ]] || CBM_NODES=0
}

cbm_alias_matches() {
  local db="$CBM_CACHE/$1.db" column root nodes
  [[ -f "$db" ]] && command -v sqlite3 >/dev/null 2>&1 || return 1
  nodes=$(sqlite3 -readonly "$db" 'SELECT count(*) FROM nodes;' 2>/dev/null) || return 1
  [[ "$nodes" =~ ^[0-9]+$ && "$nodes" -gt 0 ]] || return 1
  column=$(sqlite3 -readonly "$db" "SELECT name FROM pragma_table_info('projects') WHERE name IN ('root_path','repo_path') ORDER BY name LIMIT 1;" 2>/dev/null) || return 1
  [[ "$column" == root_path || "$column" == repo_path ]] || return 1
  root=$(sqlite3 -readonly "$db" "SELECT $column FROM projects LIMIT 1;" 2>/dev/null) || return 1
  [[ "$root" == "$CBM_REPO" ]]
}

cbm_is_temporary() {
  case "$CBM_REPO" in /tmp|/tmp/*|"$HOME"/.tmp|"$HOME"/.tmp/*|"$HOME"/.cache/clade-publish-tmp|"$HOME"/.cache/clade-publish-tmp/*) return 0 ;; *) return 1 ;; esac
}
