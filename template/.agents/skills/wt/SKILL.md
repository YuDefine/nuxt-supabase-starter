---
name: wt
description: Orchestrate a coding task inside a fresh git worktree end-to-end. `/wt <task>` builds a worktree, dispatches a subagent into it with the task, and reports back — the worktree is preserved with its committed work until `/spectra-archive` absorbs it (per [[worktree-default]] §5.5). Supports parallel multi-task via `/wt A: ... B: ...`. The parent session's cwd never moves; the user never opens a new terminal or runs `git worktree` commands manually. Implements [[worktree-default]] §1 + §5 + §6.
license: MIT
metadata:
  author: clade
  version: "3.0"
---

# /wt — orchestrate worktree task lifecycle

`/wt` is the single entry point for "do work in a worktree". It builds the worktree, runs the task via a subagent, and reports — without squashing or cleaning up. The worktree branch holds the committed work until the corresponding spectra change is archived; `/spectra-archive` Step 0 (per [[worktree-default]] §5.5) runs `wt-helper merge-back` to atomically absorb the worktree into main, then `/commit` lands the result.

This deferred-landing model guarantees main never carries half-done features between sessions: only fully-reviewed-and-archived changes touch main. The previous v2.0 behavior — `/wt` return time squash + cleanup — accumulated cross-session WIP in main and made `/commit` impossible whenever the 人工檢查 Gate triggered.

The user's two follow-up actions are:

1. Complete 人工檢查 + run `/spectra-archive <change>` — this absorbs the worktree.
2. Run `/commit` on main — this ceremonies the accumulated diff.

## When to invoke

Whenever a coding task (write, edit, refactor, migration prep) is about to start from the main worktree. `/wt` makes per-task worktree isolation cheap; the previous "type a slug, copy a oneliner, open a new session" choreography is gone.

**Do not invoke `/wt`** in these cases:

- The work is read-only (grep, log inspection, code explanation that writes nothing).
- The skill being run is main-bound by design (`/spectra-archive`).
- cwd is already inside a session worktree (`git rev-parse --git-dir` contains `/worktrees/`). The current worktree is the workspace; do not nest.

## Invocation forms

### Form 1 — single ad-hoc task

```
/wt <task description>
```

Examples:

```
/wt refactor the cache layer to use LRU eviction
/wt add unit tests for src/parsers/csv.ts covering empty / unicode / quoted rows
/wt update Node version pin to 24 and rerun pnpm install
```

The skill derives a short slug from the task description (lowercased, kebab-case, trimmed to roughly 40 chars). If the user prefers an explicit slug, they MAY prefix the description with `<slug>:` — e.g., `/wt lru-cache: refactor the cache layer to use LRU eviction`.

### Form 2 — parallel multi-task

```
/wt
A: <task A description>
B: <task B description>
C: <task C description>
```

Or single line: `/wt A: task A B: task B`.

Each labeled task becomes its own worktree + subagent. Subagents run concurrently. As each completes, the parent squash-merges that result and cleans that worktree up. A failure in one task does not block the others.

Labels are arbitrary identifiers (A/B/C/feat-x/test-y). The skill normalizes them into slugs.

### Form 3 — dispatch a named next-skill (internal, used by `/handoff` Mode B)

```
/wt <slug>: /<next-skill> <args>
```

Example:

```
/wt fix-auth: /spectra-apply fix-auth
/wt evlog-dpattern: /spectra-ingest evlog-dpattern
```

This form is invoked by `/handoff` Mode B (per [[worktree-default]] §1 and [[handoff]] §2B.5) when the user has selected a worktree-requiring change from the outstanding-work list. The subagent inside the worktree runs `<next-skill>` as its first action.

Direct user invocation of this form is allowed but uncommon — usually the user just types `/wt <task>` and lets the subagent figure out the work.

## Per-task lifecycle

For each task in the invocation, `/wt` SHALL execute the following sequence. With parallel tasks, steps 2–3 run concurrently across tasks; step 1 runs sequentially (one `wt-helper add` at a time). **There is no squash or cleanup at `/wt` return** — those happen at archive time via `wt-helper merge-back` (per [[worktree-default]] §5.5).

### Step 1 — Build the worktree

```bash
node scripts/wt-helper.mjs add <slug>
```

Run from the main worktree's cwd. The helper:

- Normalizes the slug.
- Creates branch `session/<YYYY-MM-DD-HHMM>-<slug>` from `main`.
- Materializes the worktree at `<consumer-parent>/<consumer-name>-wt/<slug>/`.
- Merges `origin/main` if present.

Capture the worktree absolute path (the helper prints `cd <path>` and `Branch: <branch>` — parse them, or derive them from the consumer-root + slug convention).

### Step 2 — Dispatch a subagent into the worktree

Use the spawn_agent 工具 with:

- `name`: `wt-<slug>` (so a continuation pattern can `SendMessage({to: name})` later).
- `isolation`: omit (the worktree itself is the isolation; the spawn_agent 工具's built-in worktree isolation is for the *parent's* repo, which we don't want).
- `prompt`: see the subagent prompt template below.

The subagent's cwd is set via the prompt — explicit instruction `your working directory is <worktree-path>; all writes happen there`. The parent's cwd remains on the main worktree.

#### Subagent prompt template

```
Your working directory is <worktree-absolute-path>. All file reads, writes,
and shell commands MUST run there. Do NOT cd out of this directory.

Task:
<task description verbatim, or the next-skill invocation in form 3>

Contract:
1. Perform the task. Make commits inside the worktree as needed:
     git add -A
     git commit -m "wt: <slug> — <short description>"
   Multiple commits are fine; only the squash-merged result lands on main.
2. Do NOT run `git push` from the worktree. The session branch is short-lived.
3. Do NOT run `/commit` or `/spectra-commit` inside the worktree. Commit ceremony
   on main is the user's responsibility once changes accumulate.
4. When done, report back with:
   - Success: "done — commits: <SHA-list>, files: <count>". Optionally a one-line
     summary of what changed.
   - Failure: "fail — <reason>". If you abort before committing, the worktree
     branch will be preserved for the user to inspect.

Context for the task: <thin brief extracted from main session — see Parallel
Subagent Fan-out guidance in user AGENTS.md>.
```

The thin brief MUST be prepared *by the parent* before dispatching: file paths to touch, rules to follow, acceptance criteria. Do NOT spawn a subagent with only a task name and let it grep the repo cold — that violates the user's "Parallel Subagent Fan-out" rule and burns context.

For form 3 (dispatch a next-skill), the "Task" section is replaced with:

```
Task:
Invoke the Skill tool with skill="<next-skill-name>" and args="<args>".
Run that skill to completion inside this worktree. Report back per the contract above.
```

### Step 3 — Wait for subagent completion

The spawn_agent 工具 call returns when the subagent finishes. Parse its report to determine success vs. failure.

If success, the subagent has committed inside the worktree. Verify by:

```bash
git -C <worktree-path> log --oneline main..HEAD
```

The output should be non-empty.

### Step 4 — Report (no squash, no cleanup)

After all tasks in the invocation have either completed (subagent committed) or failed (worktree preserved with whatever WIP exists), emit one aggregated report:

```
✅ A (lru-cache): subagent committed — 5 files, 3 commits on branch session/<date>-lru-cache
   <one-line summary from subagent if available>
   pending: /spectra-archive <change> will absorb via wt-helper merge-back
✅ B (csv-tests): subagent committed — 2 files added on branch session/<date>-csv-tests
❌ C (node-upgrade): subagent fail — pnpm install exited 1
   worktree preserved at ~/offline/<consumer>-wt/node-upgrade/
   branch: session/<date>-node-upgrade

Pending worktrees: <N> (absorbed at /spectra-archive of matching change)
```

**Key shift from v2.0**: `/wt` no longer squashes or cleans up. Each worktree's branch carries committed work until its corresponding `/spectra-archive` run; archive Step 0 runs `wt-helper merge-back --auto-stash --noop-if-missing <change-name>` to atomically absorb + cleanup. This means main's working tree stays clean of in-progress work between sessions.

For non-spectra ad-hoc tasks (Form 1 with no corresponding change), the user runs `wt-helper merge-back <slug>` manually when ready to land.

## Failure handling

### Subagent task failure

Subagent reports failure or exits without commits. Preserve the worktree and branch; report the path. The user can inspect via `git -C <wt-path> log/diff/status` from the main session — no need to switch cwd.

When the user fixes the underlying issue, they can either:

- Re-run the subagent in the same worktree by passing the worktree path explicitly to a new Agent invocation, or
- `wt-helper cleanup <slug> --force --force-discard-unland` to discard the worktree and start fresh via `/wt`.

### Squash conflicts (no longer at `/wt` time)

Squash happens at archive time (Step 0 of `/spectra-archive`, calling `wt-helper merge-back`). Conflict handling lives there — see [[worktree-default]] §5.5 and `spectra-archive/SKILL.md` Step 0. `/wt` does not encounter squash conflicts because it never squashes.

## After `/wt` completes

Worktree(s) hold committed work on their session branches. Main's working tree is untouched.

The user's next moves:

1. (Spectra change worktree) When the change is ready to archive, run `/spectra-archive <change-name>`. Step 0 absorbs the worktree via `wt-helper merge-back --auto-stash --noop-if-missing`. Subsequent archive gates inspect the post-squash state.
2. (Ad-hoc Form-1 worktree) When ready to land, run `node scripts/wt-helper.mjs merge-back <slug> --auto-stash`. The diff lands on main's working tree; main commit ceremony via `/commit`.
3. Once one or more worktrees have been absorbed and main has accumulated diff, run `/commit` on main.

`/wt` does NOT:

- Squash to main.
- Cleanup worktrees.
- Commit on main.
- Push anywhere.

These remain explicit later actions (archive + commit).

## Edge cases

### Degenerate form: `/wt <single-token>` with no description and no `:`

If the user types just `/wt fix-auth` (no description, no `:`-prefixed next-skill), prompt the user to clarify whether they want:

- An ad-hoc task in a new worktree (ask for the task description).
- A long-lived worktree session (deprecated via `/wt`; suggest `node scripts/wt-helper.mjs add fix-auth` + opening a fresh session in the resulting path).

Do NOT silently build a worktree with no task — that's the deprecated v1 behavior and is gone.

### cwd already inside a session worktree

If `git rev-parse --git-dir` shows `/worktrees/`, refuse to invoke `/wt`. The current worktree IS the workspace. Tell the user: "Already inside worktree <name>; do the work here. Use `/wt` only from the main worktree."

### Token `--dispatch-from-handoff` appears in args

The flag from the previous `/wt` design is removed. If it appears in args, treat the token literally (it has no special meaning). Parent cwd never migrates regardless.

### Subagent commits but you can't tell if the task fully succeeded

The subagent's reported status is the authority. If it says "done", proceed to squash. If the subagent's commits exist but it failed to report cleanly, treat as failure (preserve worktree, report ambiguity).

## Related rules

- [[worktree-default]] — full rule baseline (§1 invariant, §5 mechanic, §6 tools).
- [[handoff]] — Mode B dispatch path that invokes `/wt <slug>: /<next-skill>`.
- [[session-tasks]] — shared `<YYYY-MM-DD-HHMM>-<slug>` naming convention.
- [[scope-discipline]] — when a `/wt` task drifts beyond its slug's scope, open a separate `/wt` task or escalate to `/spectra-propose`.

## Maintenance commands

```bash
node scripts/wt-helper.mjs list                              # list session worktrees
node scripts/wt-helper.mjs merge-back <slug>                 # atomically land worktree → main
node scripts/wt-helper.mjs merge-back <slug> --dry-run       # preview blockers
node scripts/wt-helper.mjs merge-back <slug> --auto-stash    # stash main blockers
node scripts/wt-helper.mjs land-pending <slug>               # alias for grandfathered worktrees
node scripts/wt-helper.mjs prune                             # remove merged ones interactively
node scripts/wt-helper.mjs cleanup <slug> --force --force-discard-unland  # discard worktree + commits
node scripts/stash-reconcile.mjs                             # plan recovery for wt-merge-block/* stashes
```

`merge-back` is the primary post-`/wt` action for ad-hoc Form-1 worktrees and for early-landing when needed. `/spectra-archive` calls it automatically as Step 0; users invoke it manually for non-spectra work.

`cleanup --force --force-discard-unland` is for discarding unwanted worktrees (subagent fail, abandoned exploration). It permanently loses the branch's commits; use `merge-back` first to preserve the work.
