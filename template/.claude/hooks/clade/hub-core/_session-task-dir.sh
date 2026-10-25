#!/usr/bin/env bash
# _session-task-dir.sh — session 清單目錄：clade home 是 `specs/sessions`，consumer 是 `tasks`。
#
# clade home 不寫 `tasks/`。判定與
# `vendor/scripts/lib/session-task-dirs.ts` 的 `isCladeSourceRepo` 同一判法：git common-dir
# 回推 main checkout，三個 clade-only marker 同時存在才算 clade home（linked worktree 也認得）。
# NEVER 改用「`specs/truth/work-lifecycle.md` 存在」——已遷 lifecycle 的 consumer 也有它。
# 判不出（非 git、git 失敗）一律回 `tasks`，行為等同加這層之前。
#
# 用法：. _session-task-dir.sh; dir=$(session_task_dir "$REPO_ROOT")

session_task_dir() {
  local root="${1:-.}" common main
  common=$(git -C "$root" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || {
    printf 'tasks'
    return 0
  }
  main=$(dirname -- "$common")
  if [ -f "$main/registry/consumers.json" ] && [ -f "$main/scripts/publish.ts" ] &&
    [ -f "$main/vendor/scripts/locked-projection.ts" ]; then
    printf 'specs/sessions'
  else
    printf 'tasks'
  fi
}
