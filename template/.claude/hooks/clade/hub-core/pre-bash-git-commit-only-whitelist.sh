#!/usr/bin/env bash
# PreToolUse:Bash hook — block ad-hoc `git commit --only` of non-whitelist
# paths on main/master.
#
# /commit itself lands with `git commit --only -- <files>` plus a
# `Via: /commit` trailer (SKILL.md Step 4). That path MUST pass.
# Work-loop HANDOFF / tech-debt short commits are the whitelist.
# Product landings on main without Via are the 2026-08-24/25 <consumer-a>
# incident (5 commits, push blocked by provenance-gate).
#
# Session branches (worktree deferred-landing) pass — not main.
# Fail-open on parse errors (no -C / no cwd repo). Quoted -C and
# `cd <dir> &&` that cannot be resolved are fail-closed.

set -euo pipefail

input=$(cat)

command=""
if command -v jq >/dev/null 2>&1; then
  command=$(printf '%s' "$input" | jq -r '.tool_input.command // ""' 2>/dev/null || printf '')
fi

# Match git commit anywhere in the command (`cd x && git commit`, not just
# a command that *starts* with git). Bare `git commit` without --only is a
# different hazard (index swallow) and is already forbidden in prose.
if ! printf '%s' "$command" | grep -qE '(^|[[:space:];|&])(rtk[[:space:]]+)?git[[:space:]]+'; then
  exit 0
fi
if ! printf '%s' "$command" | grep -qE '\bcommit\b'; then
  exit 0
fi
if ! printf '%s' "$command" | grep -qE '(^|[[:space:]])--only([[:space:]]|$)'; then
  exit 0
fi

# /commit Step 4 puts `Via: /commit` in the message body. A shell comment
# (`# Via: /commit`) must NOT count — it never reaches the commit trailer.
via_haystack=$(printf '%s' "$command" | sed 's/#.*//')
if printf '%s' "$via_haystack" | grep -qE 'Via: /commit'; then
  exit 0
fi

# Resolve which checkout this commit targets (`git -C <dir>`).
git_dir=""
if printf '%s' "$command" | grep -qE '(^|[[:space:]])-C[[:space:]]+'; then
  git_dir=$(printf '%s' "$command" | sed -n 's/.*[[:space:]]-C[[:space:]]\+\([^[:space:]]*\).*/\1/p' | tail -1)
  git_dir="${git_dir%\"}"
  git_dir="${git_dir#\"}"
  git_dir="${git_dir%\'}"
  git_dir="${git_dir#\'}"
fi
# `cd <main> && git commit --only` — hook cwd is the session, not the cd target.
if [ -z "$git_dir" ]; then
  cd_dir=$(printf '%s' "$command" | sed -n 's/^[[:space:]]*cd[[:space:]]\+\([^[:space:];&]*\)[[:space:]]*&&.*/\1/p')
  cd_dir="${cd_dir%\"}"
  cd_dir="${cd_dir#\"}"
  cd_dir="${cd_dir%\'}"
  cd_dir="${cd_dir#\'}"
  if [ -n "$cd_dir" ]; then
    git_dir="$cd_dir"
  fi
fi

branch=""
if [ -n "$git_dir" ]; then
  branch=$(git -C "$git_dir" rev-parse --abbrev-ref HEAD 2>/dev/null || printf '')
  if [ -z "$branch" ]; then
    cat >&2 <<EOF
⛔ Commit blocked: \`git commit --only -C ${git_dir}\` but the checkout could not be resolved

Quoted or unreadable -C is fail-closed on this gate — invoke \`/commit\`
or pass an unquoted existing path.
EOF
    exit 2
  fi
else
  branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || printf '')
fi

# Deferred-landing session branches are allowed to --only product files.
# Unresolvable cwd (empty branch, no -C) stays fail-open.
if [ -n "$branch" ] && [ "$branch" != "main" ] && [ "$branch" != "master" ]; then
  exit 0
fi
if [ -z "$branch" ]; then
  exit 0
fi

# Pathspec is everything after the last ` -- ` of the commit command.
# `git commit --only HANDOFF.md` (no ` -- `) is valid git; on main without
# Via that form is the bypass. Fail closed — spell the pathspec after `--`
# or invoke /commit.
case "$command" in
  *' -- '*) ;;
  *)
    cat >&2 <<EOF
⛔ Commit blocked: \`git commit --only\` on ${branch} without a \` -- <paths>\` pathspec

Ad-hoc --only on main/master MUST list whitelist paths after \` -- \`.
Product landings MUST invoke \`/commit\` (adds \`Via: /commit\`).
EOF
    exit 2
    ;;
esac
pathspec=${command##* -- }
# Compound Bash (`commit -- HANDOFF.md\ngit show` or `&& git show`) must
# not treat the next command as pathspec — that false-blocked work-loop 7.4.
pathspec=$(printf '%s' "$pathspec" | head -n 1)
pathspec=${pathspec%% && *}
pathspec=${pathspec%% || *}
pathspec=${pathspec%%;*}
pathspec=${pathspec%%|*}
if [ -z "$pathspec" ]; then
  exit 0
fi

whitelisted() {
  local p="$1"
  p="${p#./}"
  p="${p%\"}"
  p="${p#\"}"
  p="${p%\'}"
  p="${p#\'}"
  [ -z "$p" ] && return 0
  # `tasks/../packages/foo.ts` matches `tasks/*` before git normalizes.
  case "$p" in
    *..*) return 1 ;;
  esac
  case "$p" in
    HANDOFF.md|ROADMAP.md|docs/tech-debt.md) return 0 ;;
    tasks/*|docs/discussions/*|docs/digests/*|docs/pitfalls/*|docs/archives/*) return 0 ;;
  esac
  if [ "${p#vendor/snippets/}" != "$p" ] && [ "${p%.md}" != "$p" ]; then
    return 0
  fi
  return 1
}

blocked=""
# shellcheck disable=SC2086
set -- $pathspec
for p in "$@"; do
  case "$p" in
    -*) continue ;;  # stray flag after --, ignore
  esac
  if ! whitelisted "$p"; then
    blocked="${blocked}  ${p}\n"
  fi
done

if [ -z "$blocked" ]; then
  exit 0
fi

cat >&2 <<EOF
⛔ Commit blocked: \`git commit --only\` on ${branch} with paths outside the ad-hoc whitelist

Ad-hoc \`--only\` on main/master is limited to the path whitelist in
rules/core/commit.detail.md § \`--only\` 適用範圍. These paths are not on it:

$(printf '%b' "$blocked")
Fix: invoke \`/commit\` (adds \`Via: /commit\` and runs 0-A).
Do NOT add a fake Via trailer to this command.

Whitelist (HANDOFF / tech-debt / tasks / artifact-tick / …) still uses
\`git commit --only\`. Session-branch commits inside a worktree are not
this gate — only main/master.

Work-loop is not an exception. Packaging if /commit hits 人工檢查;
NEVER --only around 0-A.
EOF
  exit 2
