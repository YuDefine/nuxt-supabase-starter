#!/usr/bin/env bash
# PreToolUse:Bash hook — provenance gate on `git push` to origin/main
#
# Blocks pushes to origin/main (or origin/master) when new commits lack
# /commit provenance (`Via: /commit` trailer) AND are substantive
# (>5 files changed, touching code files).
#
# Ad-hoc commits (≤5 files, or doc/config-only) pass without provenance.
# Fail-open on errors — avoids blocking normal push when infra breaks.
#
# TD-248: mechanical enforcement for rules/core/commit.md § 隔離 worktree
# ≠ 繞過 /commit. Ref: pitfall-isolated-worktree-raw-commit-push-bypasses-commit-gate

set -euo pipefail

input=$(cat)

command=""
if command -v jq >/dev/null 2>&1; then
  command=$(printf '%s' "$input" | jq -r '.tool_input.command // ""' 2>/dev/null || printf '')
fi

# Not a git push → pass
if ! printf '%s' "$command" | grep -qE '^\s*(git|rtk\s+git)\s+push\b'; then
  exit 0
fi

# Determine target branch
current_branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

# Explicit target: `git push origin main`
if printf '%s' "$command" | grep -qE '\borigin\s+(main|master)\b'; then
  target_branch=$(printf '%s' "$command" | grep -oE '\borigin\s+(main|master)\b' | awk '{print $2}')
elif [ "$current_branch" = "main" ] || [ "$current_branch" = "master" ]; then
  # Bare `git push` on main/master — check remote is origin
  push_remote=$(git config --get "branch.${current_branch}.remote" 2>/dev/null || echo "")
  if [ "$push_remote" != "origin" ] && [ -n "$push_remote" ]; then
    exit 0
  fi
  target_branch="$current_branch"
else
  exit 0  # Not pushing to main/master
fi

remote_ref="origin/${target_branch}"
if ! git rev-parse "${remote_ref}" >/dev/null 2>&1; then
  exit 0  # No remote ref to compare — first push or missing remote
fi

# Find new commits being pushed.
#
# Default range is `origin/main..HEAD`, but that makes the gate unusable once a
# repo's remote falls far behind: every unpushed commit is re-judged on every
# push attempt, so a handful of pre-existing provenance gaps block the branch
# permanently — including commits authored before this gate existed, and commits
# from other sessions that this session must not rewrite. The gate is meant to
# stop *new* work from bypassing /commit, not to hold a branch hostage to its
# own history.
#
# `refs/clade/provenance-baseline` lets a human draw that line explicitly:
# commits at or before it are treated as accepted history, everything after is
# judged normally. Setting it is a deliberate, auditable act (a ref, visible in
# `git for-each-ref`), never something a hook or an agent does on its own.
#
# The ref is ignored unless it is an ancestor of HEAD — a stale baseline left
# behind by a rebase must not silently widen what passes.
baseline_ref="refs/clade/provenance-baseline"
range_start="$remote_ref"
baseline_note=""
if baseline_sha=$(git rev-parse --verify --quiet "${baseline_ref}" 2>/dev/null) \
   && [ -n "$baseline_sha" ] \
   && git merge-base --is-ancestor "$baseline_sha" HEAD 2>/dev/null; then
  # Only narrow the range. If the baseline is behind the remote, the remote is
  # already the tighter bound and the baseline has nothing left to forgive.
  if git merge-base --is-ancestor "$remote_ref" "$baseline_sha" 2>/dev/null; then
    range_start="$baseline_sha"
    baseline_note="(judging ${baseline_sha:0:8}..HEAD — provenance baseline in effect)"
  fi
fi

new_commits=$(git rev-list "${range_start}..HEAD" 2>/dev/null || echo "")
if [ -z "$new_commits" ]; then
  exit 0  # Nothing new
fi

blocked_commits=""
for sha in $new_commits; do
  # Check for Via: /commit trailer in commit body
  if git log -1 --format='%b' "$sha" 2>/dev/null | grep -qE '^Via: /commit$'; then
    continue
  fi

  # Count files changed by this commit
  file_count=$(git diff-tree --no-commit-id --name-only -r "$sha" 2>/dev/null | wc -l | tr -d ' ')

  # Small commits (≤5 files) → ad-hoc, pass without provenance
  if [ "$file_count" -le 5 ]; then
    continue
  fi

  # Check if any code files are touched (not just docs/config).
  #
  # clade-managed LOCKED projections are excluded: consumers cannot author them
  # (chmod 444, checksum-gated) and their content is reviewed in clade before
  # propagate. Counting them makes every `pnpm hub:upgrade` commit unblockable
  # in every consumer, since projection bumps always carry .ts / .sh files.
  #
  # `|| true` (not `|| echo 0`): `grep -c` prints "0" *and* exits 1 on no match,
  # so `|| echo "0"` yields "0\n0" → `[ -eq ]` errors out → the doc-only pass
  # below never fires.
  # `scripts/` is a *mixed* directory: it holds both consumer-authored scripts (which MUST
  # be reviewed here) and clade-projected ones (which MUST NOT be edited here at all).
  # A static exclusion cannot tell them apart and drifts every time clade adds a script —
  # that drift is what made `pnpm hub:upgrade` commits block pushes again: the list covered
  # one projected `scripts/` subdirectory but not `scripts/wt-helper.ts` and ~20 siblings.
  #
  # Ask clade what it projects instead of maintaining a copy of the answer. The plugin lives
  # at <clade>/capabilities/core, so vendor/scripts is two levels up. Unset/missing → the
  # filter degrades to the static prefixes below, which is the pre-existing behaviour.
  # Native delivery (`.claude/hooks/clade/hub-core/`) has no CLAUDE_PLUGIN_ROOT, so the clade
  # checkout is the second candidate — without it the filter would silently fall back to the
  # static prefixes the moment a consumer leaves the plugin install.
  clade_scripts=""
  for clade_vendor in \
    "${CLAUDE_PLUGIN_ROOT:+${CLAUDE_PLUGIN_ROOT}/../../vendor/scripts}" \
    "${CLADE_HOME:-$HOME/offline/clade}/vendor/scripts"; do
    [ -n "$clade_vendor" ] && [ -d "$clade_vendor" ] || continue
    clade_scripts=$(cd "$clade_vendor" && ls -1 2>/dev/null || true)
    break
  done

  has_code=$(git diff-tree --no-commit-id --name-only -r "$sha" 2>/dev/null \
    | grep -vE '^(\.claude|\.agents|\.codex|\.clade|\.spectra|vendor)/' \
    | while IFS= read -r path; do
        # Drop `scripts/<name>` when clade projects a `vendor/scripts/<name>` of the same name.
        # Only the first path segment under scripts/ is compared, so `scripts/lib/foo.ts` is
        # matched by clade's `vendor/scripts/lib` directory entry.
        case "$path" in
          scripts/*)
            seg=${path#scripts/}
            seg=${seg%%/*}
            if [ -n "$clade_scripts" ] && printf '%s\n' "$clade_scripts" | grep -qxF "$seg"; then
              continue
            fi
            ;;
        esac

        # LOCKED projections declare themselves in their own header. Asking the file
        # beats maintaining a list of where projections live: the static prefixes above
        # already drifted once (they covered one projected `scripts/` subdirectory but not
        # the ~20 `scripts/` siblings), and every new projection location repeats that failure —
        # `.github/actions/<name>` (from vendor/actions/) and a root `commitlint.config.ts`
        # (from vendor/commitlint/) are the two that got through on 2026-08-22.
        # Read the blob at $sha, not the worktree: the point is what this commit contains.
        if git show "$sha:$path" 2>/dev/null | head -5 | grep -qF 'LOCKED — managed by clade'; then
          continue
        fi

        printf '%s\n' "$path"
      done \
    | grep -cE '\.(tsx?|vue|mjs|js|sh|mts)$' || true)
  if [ "${has_code:-0}" -eq 0 ]; then
    continue  # Doc/config/projection only → pass
  fi

  # Substantive commit without provenance → block candidate
  subject=$(git log -1 --format='%s' "$sha" 2>/dev/null || echo "(unknown)")
  blocked_commits="${blocked_commits}  ${sha:0:8} (${file_count} files) — ${subject}\n"
done

if [ -n "$blocked_commits" ]; then
  cat >&2 <<EOF
⛔ Push blocked: substantive commits without /commit provenance

The following commits change >5 files (including code) but lack the
\`Via: /commit\` trailer, meaning they bypassed /commit's 0-A cross-model
review gate:

$(printf '%b' "$blocked_commits")
${baseline_note}
Fix: run \`/commit\` (or in a clean worktree: \`/wt <slug>: /commit\`).
The \`Via: /commit\` trailer is added automatically by /commit Step 4/5.

Ad-hoc commits (≤5 files or doc-only) do not need /commit provenance.
See rules/core/commit.md § 隔離 worktree ≠ 繞過 /commit.

If the commits above are pre-existing history nobody is going to rewrite
(authored before this gate, or owned by another session), a line can be drawn
under them — but only on a human's explicit say-so, never on an agent's own
judgement that the gate is inconvenient:

  git update-ref refs/clade/provenance-baseline <sha>

Commits at or before <sha> are then treated as accepted history; everything
after it is still judged. Pick the newest commit you are accepting, never
HEAD itself — that would forgive the very commit you are pushing.
EOF
  exit 2
fi

exit 0
