---
name: spectra-archive
description: "Archive a completed change"
effort: low
license: MIT
compatibility: Requires spectra CLI.
metadata:
  author: spectra
  version: "1.0"
  generatedBy: "Spectra"
---
<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/spectra-archive/
Edit at: <clade-central-repo>
Local edits will be reverted by the next sync.
-->


Archive a completed change.

**Input**: Optionally specify a change name after `/spectra-archive` (e.g., `/spectra-archive add-auth`). If omitted, check if it can be inferred from conversation context. If vague or ambiguous you MUST prompt for available changes.

**Prerequisites**: This skill requires the `spectra` CLI. If any `spectra` command fails with "command not found" or similar, report the error and STOP.

## Change Disposition Decision (clade fork addition)

Before running archive, classify the change into one of four dispositions. Pick the wrong path and you either (a) burn user time on a review that doesn't apply, (b) write spec for a feature that won't ship, or (c) abandon work that's actually still pending.

| Disposition | Trigger | spec sync | manual review | CLI |
|---|---|---|---|---|
| **Park** | Change is **postponed but still planned**. Premise still valid. | — | — | `spectra park <name>` (NOT this skill) |
| **Standard archive** | Implementation `[x]` complete + `## 人工檢查` `[x]` complete | applied | already done | `spectra archive <name>` (default flow) |
| **Skip-archive (A)** | **Won't be implemented.** Premise dissolved (decision changed / concept removed / change became redundant). | **skipped** | **skipped** | `spectra archive <name> --mark-tasks-complete --skip-specs --no-validate -y` |
| **In-main-done archive (B)** | Implementation `[x]` complete (built directly on main, no session worktree). Only `## 人工檢查` items remain unchecked. | applied | **skipped** | `spectra archive <name> --mark-tasks-complete --no-validate -y` |
| **Apply-required (block)** | Non-`## 人工檢查` items still `[ ]` + change is still wanted. | — | — | **STOP** — run `/spectra-apply <name>` first, then re-classify |

### Hard rules

- **NEVER** use Park for "won't implement" — Park's contract is "future work pending"; abandoned changes pollute the parked queue and look like a backlog. Use Skip-archive (A) instead.
- **NEVER** use Skip-archive (A) when implementation work is actually done — that drops the spec delta and leaves the codebase with shipped behavior that has no spec record. Use In-main-done archive (B) instead.
- **NEVER** run In-main-done archive (B) without first verifying that non-`## 人工檢查` task sections are fully `[x]`. Use the inspection check below.
- **NEVER** auto-batch multiple changes into Skip-archive (A) without per-change user confirmation — abandoning work is destructive (spec delta thrown away, future readers lose the why).
- **MUST** record the disposition reason (1 line) in the archive commit message when using Skip-archive (A) or In-main-done archive (B), so future readers can tell why standard flow was bypassed:
  - A: `archive: <name>; skip — <reason premise dissolved>`
  - B: `archive: <name>; in-main-done — <reason no worktree, e.g. built directly on main>`

### Inspection check (before B vs Apply-required)

To distinguish In-main-done archive (B) from Apply-required, parse `openspec/changes/<name>/tasks.md`:

```bash
awk '/^## 人工檢查/{mr=1; next} /^## /{mr=0} !mr && /^- \[ \]/{print NR": "$0}' \
  openspec/changes/<name>/tasks.md
```

- **Empty output** → all non-manual-review items are `[x]` → eligible for In-main-done archive (B)
- **Non-empty output** → there are unchecked implementation tasks → MUST be either:
  1. **Apply-required**: run `/spectra-apply <name>` to finish them, then re-classify
  2. **Skip-archive (A)**: explicit user confirmation that the unchecked work won't be done (premise dissolved)
  - **NEVER** silently auto-`--mark-tasks-complete` non-manual-review tasks without classifying — that hides incomplete implementation behind a green archive.

### Worktree handling per disposition

- **Skip-archive (A)**: change has no implementation to land. If a session worktree exists (typically with only ingest / sync commits, no real implementation), run `node scripts/wt-helper.mjs cleanup <name> --force --force-discard-unland` to drop branch + worktree; do **NOT** run `merge-back` (nothing meaningful to merge).
- **In-main-done archive (B)**: change was built on main, no worktree to absorb. Step 0 `wt-helper merge-back ... --noop-if-missing` becomes silent no-op — proceed.
- **Standard archive**: Step 0 absorbs the matching worktree as documented below.

### When user asks for "skip 人工檢查 and archive"

"Skip 人工檢查 + archive" is ambiguous between A and B. **MUST** disambiguate with the user before running:

- "這條的功能會做嗎？" → No → A
- "已經在 main 做完了，只是沒走 worktree？" → Yes → B (after passing the Inspection check)
- Both ambiguous → walk through Inspection check output with the user, then pick.

**Worktree exemption (clade fork addition)**: This skill is exempt from the [[worktree-default]] §1 worktree requirement. Archive is main-bound — every output (delta sync into `openspec/specs/<capability>/spec.md`, move into `openspec/changes/archive/`, screenshot sweep) targets main, so running inside a worktree adds a mandatory merge-back with no isolation benefit. The skill SHALL proceed regardless of whether cwd is on the main worktree or inside a session worktree; the orchestrator (e.g., `/handoff` Mode B Step 2B.5) SHALL dispatch this skill directly without routing through `/wt`. Do NOT add prose instructing the user to "open a worktree first" — that contradicts the §1 exemption.

**Atomic merge-back contract (clade fork addition)**: Per [[worktree-default]] §5.5, worktree branches do NOT squash back to main at `/wt` return time — they wait until archive. Step 0 below absorbs any slug-matching session worktree into main BEFORE the archive gates run, so gates inspect the post-squash state and so main never carries half-done work between sessions.

**Steps**

0. **Atomic merge-back from active worktree** (clade fork addition)

   Per [[worktree-default]] §5.5, any session worktree whose slug matches this change-name MUST be absorbed into main before archive gates run. If gates run on un-absorbed main, they would see a false-clean diff (worktree changes never landed) and produce a misleading archive.

   ```bash
   node scripts/wt-helper.mjs merge-back <change-name> --auto-stash --noop-if-missing
   ```

   - `--noop-if-missing` makes this a silent no-op when no matching worktree exists (solo archive path — change implemented directly on main).
   - `--auto-stash` stashes any main-worktree blockers as `wt-merge-block/<change-name>/<ISO>` for later reconciliation via `node scripts/stash-reconcile.mjs`.
   - On conflict, the squash aborts, the worktree + branch are preserved, and the stash is popped back. Surface the error and **STOP** the archive — the change cannot be archived until the conflict is resolved.

   **Skip condition**: if `scripts/wt-helper.mjs` does not exist (consumer hasn't propagated the merge-back subcommand yet), skip this step silently with a one-line note: `Step 0: skipped — wt-helper merge-back not available (consumer pre-propagate)`.

   **Output (when worktree absorbed)**:
   - `merge-back: <change-name> absorbed into main` — proceed to Step 1
   - `merge-back: <change-name> absorbed into main (blockers stashed as wt-merge-block/<name>/<ISO>) + worktree cleaned` — proceed; remind user in Step 8 summary that stash entry needs reconciliation

1. **If no change name provided, prompt for selection**

   Run `spectra list --json` to get available changes. Use the **request_user_input 工具** to let the user select.

   Show only active changes (not already archived).
   Include the schema used for each change if available.

   **IMPORTANT**: Do NOT guess or auto-select a change. Always let the user choose.

2. **Check artifact completion status**

   Run `spectra status --change "<name>" --json` to check artifact completion.

   Parse the JSON to understand:
   - `schemaName`: The workflow being used
   - `artifacts`: List of artifacts with their status (`done` or other)

   **If any artifacts are not `done`:**
   - Display warning listing incomplete artifacts
   - Prompt user for confirmation to continue
   - Proceed if user confirms

3. **Check task completion status**

   Read the tasks file (typically `tasks.md`) to check for incomplete tasks.

   Count **leaf** tasks marked with `- [ ]` (incomplete) vs `- [x]` (complete). For `## 人工檢查` items, parent `#N` lines that own scoped `#N.M` children have state derived from children (see `rules/core/manual-review.md`「Parent State Derivation」) — never count those parent lines directly.

   **If incomplete tasks found:**
   - Display warning showing count of incomplete tasks
   - Prompt user for confirmation to continue
   - Proceed if user confirms

   **If no tasks file exists:** Proceed without task-related warning.

3.3. **Manual-Review Pattern Re-check** (clade fork addition — archive gate for `## 人工檢查` hygiene)

   `## 人工檢查` items can drift between propose / ingest and archive (apply phase edits, screenshot annotations, fix-up rewrites). Re-run the same enforcement hook that `/spectra-propose` uses, so jargon leakage / abstract reference / missing URL etc. doesn't slip into archive:

   ```bash
   bash scripts/spectra-advanced/post-propose-manual-review-check.sh <change-name>
   ```

   Exit 2 = pattern findings (any of `ABSTRACT_REFERENCE` / `CARD_WITHOUT_UID` / `UI_ITEM_NO_URL` / `MULTI_STEP_NOT_SCOPED` / `REVIEW_UI_BACKEND_ROUNDTRIP` / `INTERNAL_JARGON_LEAKAGE`).

   **If findings exist:**
   - Display warning showing pattern hit summary (parsed from hook stderr)
   - Prompt user: "Archive 前 manual-review 還有 N 個 pattern 命中（見上）— 修完再 archive vs 帶 followup 跳過？"
     - **Fix now** → main thread Edit `tasks.md` per hook remediation guidance; re-run hook; loop until clean
     - **Bypass with @followup** → user adds `@followup[TD-NNN]` to each hit item + opens consumer-side TD; main thread re-runs hook to confirm bypass markers recognized; proceed
     - **Bypass with @no-manual-review-check** → only if hit is legitimate false positive (e.g., 真機掃 SMS 無 dev replay endpoint); main thread adds marker + re-runs hook; proceed
   - Proceed only after hook exits 0 or user explicitly confirms bypass strategy

   **If hook exits 0:** Silent skip — proceed to Step 3.5.

   Reference: `vendor/snippets/manual-review-enforcement/patterns.json` + `rules/core/manual-review.data-readiness.md`.

3.5. **Discuss Items Walkthrough** (Step 2.5 in the spec — runs after artifact + task completion checks, before delta sync preview)

   Spec authority: `openspec/specs/manual-review-item-kind/spec.md` "Spectra-Archive Discuss Walkthrough"

   Read `openspec/changes/<change-name>/tasks.md` `## 人工檢查` section. Identify every unchecked item where `kind = "discuss"` (either explicit `[discuss]` marker, OR derived via Default Kind Derivation Rule when proposal.md contains `**No user-facing journey (backend-only)**`).

   **For each unchecked `[discuss]` item, the main thread Claude SHALL** (proactively, without prompting):

   1. Read the item description and surrounding context (proposal.md User Journeys, related task results, recent diff).
   2. **Classify the item's trigger condition** (key for next step):
      - **Internal evidence available now** — code / schema / migration state / cron config / dev DB query result. Claude can collect evidence immediately.
      - **External signal already occurred** — staging / production already deployed, soak window already elapsed, business decision already made. Claude can query the post-signal state (prod URL `<title>`, prod evlog row, prod migration `\d` output) and collect evidence.
      - **External signal pending** — required deploy / soak / business authorization has **not yet** occurred. Claude **CANNOT** synthesize evidence by analysis alone; any "based on code, this should work" reasoning is speculation, not walkthrough evidence.
   3. **Prepare evidence** relevant to the item — pick whichever combination is most informative:
      - `grep` / `rg` results showing the relevant code paths or migrations touched
      - Recent `git diff` excerpts (focused on the area the item references)
      - Command output (if the item asks about deploy / migration / cron / data state, run the relevant query and paste the output)
      - Data summary (e.g., row counts, distribution stats, drift counts)
      - Cross-consumer / cross-environment check results (e.g., per-consumer migration apply status)

      **For "External signal pending" items**: skip evidence collection (there's nothing to collect yet). Move directly to step 4 with the trigger condition stated explicitly.
   4. Present to the user, in this format:

      ```
      ### Discuss item #<id> [discuss] <description>

      **Trigger condition:** <internal evidence | external signal already occurred | external signal pending — describe>

      **Evidence:** (omit this section if trigger is "external signal pending")
      <grep / diff / command output / summary>

      **My read:** <one or two sentences explaining what the evidence implies, OR "waiting on <signal>; no evidence available yet — recommend Issue/Skip or pause archive until signal occurs">

      請確認：OK / Issue / Skip
      ```

   5. Wait for the user's response. Branch on the answer:

      - **OK**: Edit `tasks.md` for this line:
        - Set checkbox to `[x]`
        - Insert `(claude-discussed: <ISO-8601-timestamp>)` annotation between description and any trailing markers (`@followup[TD-NNN]` / `@no-screenshot`), preserving canonical ordering. Use the current ISO-8601 UTC timestamp (`new Date().toISOString()`).
        - Example before: `- [ ] #2 [discuss] Confirm rollout @no-screenshot`
        - Example after: `- [x] #2 [discuss] Confirm rollout (claude-discussed: 2026-05-10T14:23:00Z) @no-screenshot`
      - **Issue**: Edit `tasks.md`:
        - Keep checkbox as `[ ]`
        - Append `（issue: <user note>）` annotation between description and trailing markers
        - Note in summary: this item is intentionally left unchecked; archive **does NOT** block on it (user retains control)
      - **Skip**: Edit `tasks.md`:
        - Set checkbox to `[x]`
        - Append `（skip）` annotation (or `（skip: <reason>）` if the user gave a reason)
      - **Pause archive** (typical when trigger is "external signal pending" and user wants to wait for the signal before deciding): leave checkbox as `[ ]`, do **NOT** add any annotation, and **STOP** the archive flow with a one-line summary to the user — "Archive paused on item #<id> waiting on <signal>. Re-run `/spectra-archive <change>` after <signal> occurs." User retains full control on when to resume; no time-based auto-resume.

   6. Move to the next unchecked `[discuss]` item until all are processed.

   **Skip-condition**: if `## 人工檢查` has no unchecked `[discuss]` items, skip this step silently.

   **Out of scope here**: unchecked `[review:ui]` items are NOT processed in this step — they are routed to `/review-screenshot` by the orchestrator's Archive Flow (`spectra/SKILL.md` Step 1). If `[review:ui]` items remain unchecked at this point, the orchestrator should already have prompted the user; if they reach Step 6 unchecked, archive-gate.sh Check 4 will block.

   **Restrictions** (hard rules from `manual-review.md`):

   - **NEVER** mark a `[discuss]` item `[x]` without showing the user evidence first AND receiving an explicit OK
   - **NEVER** write `(claude-discussed: <ISO>)` annotation without an actual discussion taking place
   - **NEVER** batch-process multiple `[discuss]` items in one user prompt — present them one at a time so the user can give a focused answer per item
   - **NEVER** touch `[review:ui]` items during this step

4. **Assess delta spec sync state**

   Check for delta specs at `openspec/changes/<name>/specs/`. If none exist, proceed without sync prompt.

   **If delta specs exist:**
   - Compare each delta spec with its corresponding main spec at `openspec/specs/<capability>/spec.md`
   - Determine what changes would be applied (adds, modifications, removals, renames)
   - Show a combined summary before prompting

   **Prompt options:**
   - If changes needed: "Sync now (recommended)", "Archive without syncing"
   - If already synced: "Archive now", "Sync anyway", "Cancel"

   If user chooses sync, use Task tool (agent_type: "general-purpose", prompt: "Use Skill tool to invoke spectra-sync-specs for change '<name>'. Delta spec analysis: <include the analyzed delta spec summary>"). Proceed to archive regardless of choice.

5. **Clean up tracking file**

   Delete `.spectra/touched/<change-name>.json` if it exists. This file contains implementation tracking data that is not needed after archiving.

   ```bash
   rm -f .spectra/touched/<change-name>.json
   ```

   If the file does not exist, silently continue.

6. **Perform the archive**

   Use the `spectra archive` CLI command which handles the full archive workflow
   (spec snapshot, delta application, @trace injection, identity recording, vector indexing):

   ```bash
   spectra archive <name>
   ```

   **Optional flags:**
   - `--skip-specs` — skip delta spec application (for tooling/doc-only changes)
   - `--mark-tasks-complete` — mark all incomplete tasks as complete before archiving
   - `--no-validate` — skip delta spec validation

   **If archive fails** with "already exists" error, suggest renaming existing archive.

7. **Sweep screenshots (auto)**

   After successful archive, **automatically** invoke the `screenshots-archive` skill (via Skill tool) with `change <change-name>` to sweep the corresponding screenshot folders into `screenshots/<env>/_archive/YYYY-MM/`.

   - Caller-trusted: spectra-archive completing = the change is closed = its screenshots belong in `_archive/` (no extra confirmation here; `screenshots-archive` Mode B handles topic-name mismatch internally).
   - **Skip condition**: if user explicitly passed `--no-sweep` (or said "不要 sweep 截圖") when invoking spectra-archive, skip this step and note in Step 8 summary: `Screenshots: sweep skipped (user --no-sweep)`.
   - **Failure handling**: if `screenshots-archive` errors (e.g., disk write failure), do NOT fail the overall archive — log the error and note in Step 8 summary: `Screenshots: sweep failed — see error above`. The change is already archived; sweep is best-effort cleanup.

7.5. **Reconcile stale stash (clade fork; not in upstream spectra)**

   After successful archive, the change directory has moved to `openspec/changes/archive/<change-name>/`. `stash-reconcile.mjs` will now mark any stash matching this slug as **stale** via `isArchivedChange()` — housekeeping moment to drop stash entries that exist solely because this change was active.

   - Run: `node scripts/stash-reconcile.mjs --slug "<change-name>" --json`
   - Parse stdout JSON. If `entries.length === 0`, continue silently to Step 8 (note `Reconcile: 0 entries` in summary).
   - If hits: print summary `⚠ Archive cleanup: N stash entries for archived slug '<change>'`, then use **request_user_input**:
     - **Show full report** — print each entry's `ref`, `namespace.kind`, `createdAt`, file list, and `recommendation.action`/`recommendation.reason` (recommendation will typically be `drop` for archived-slug entries, or `view-diff` for unknown shapes); then re-ask
     - **Drop stale** — for every entry where `recommendation.action === "drop"`, run `git stash drop <ref>`. Safety: ONLY drop entries the script explicitly flagged as `drop`; never blanket-drop based on slug match alone.
     - **Per-entry prompt** — for each entry, ask `drop / view-diff / keep` individually (use request_user_input per entry)
     - **Keep all** — leave stash untouched (default when uncertain)
   - **Skip condition**: same `--no-reconcile` semantics as spectra-apply / spectra-verify; if skipped, note in Step 8 summary `Reconcile: skipped (user --no-reconcile)`.
   - **Failure handling**: script error → print error but do NOT fail the archive. The change is already archived; reconcile is best-effort cleanup. Note in Step 8 summary: `Reconcile: failed — see error above`.
   - **Note in Step 8 summary**: append `Reconcile: N entries dropped` / `Reconcile: N entries kept` / `Reconcile: 0 entries` / `Reconcile: skipped` / `Reconcile: failed` according to outcome.

8. **Display summary**

   Show archive completion summary including:
   - Change name
   - Schema that was used
   - Archive location
   - Spec sync status (synced / sync skipped / no delta specs)
   - Note about any warnings (incomplete artifacts/tasks)

**Output On Success**

```
## Archive Complete

**Change:** <change-name>
**Schema:** <schema-name>
**Worktree:** ✓ Absorbed into main (or: no worktree — solo path)
**Archived to:** openspec/changes/archive/YYYY-MM-DD-<name>/
**Specs:** ✓ Synced to main specs
**Screenshots:** ✓ Swept to _archive/YYYY-MM/ (or: no screenshots / skipped (user --no-sweep) / sweep failed)

All artifacts complete. All tasks complete.
```

If Step 0 stashed blockers, append a line under **Worktree**:
```
**Stash to reconcile:** wt-merge-block/<change-name>/<ISO> (run `node scripts/stash-reconcile.mjs` to plan)
```

**Output On Success (No Delta Specs)**

```
## Archive Complete

**Change:** <change-name>
**Schema:** <schema-name>
**Archived to:** openspec/changes/archive/YYYY-MM-DD-<name>/
**Specs:** No delta specs
**Screenshots:** ✓ Swept to _archive/YYYY-MM/ (or: no screenshots / skipped / failed)

All artifacts complete. All tasks complete.
```

**Output On Success With Warnings**

```
## Archive Complete (with warnings)

**Change:** <change-name>
**Schema:** <schema-name>
**Archived to:** openspec/changes/archive/YYYY-MM-DD-<name>/
**Specs:** Sync skipped (user chose to skip)
**Screenshots:** Sweep failed — see error above

**Warnings:**
- Archived with 2 incomplete artifacts
- Archived with 3 incomplete tasks
- Delta spec sync was skipped (user chose to skip)
- Screenshot sweep failed (archive itself succeeded)

Review the archive if this was not intentional.
```

**Output On Error (Archive Exists)**

```
## Archive Failed

**Change:** <change-name>
**Target:** openspec/changes/archive/YYYY-MM-DD-<name>/

Target archive directory already exists.

**Options:**
1. Rename the existing archive
2. Delete the existing archive if it's a duplicate
3. Wait until a different date to archive
```

**Guardrails**

- Always prompt for change selection if not provided
- Use artifact graph (spectra status --json) for completion checking
- Don't block archive on warnings - just inform and confirm
- Preserve .openspec.yaml when moving to archive (it moves with the directory)
- Show clear summary of what happened
- If sync is requested, use the Skill tool to invoke `spectra-sync-specs` (agent-driven)
- If delta specs exist, always run the sync assessment and show the combined summary before prompting
- If **request_user_input 工具** is not available, ask the same questions as plain text and wait for the user's response
- **NEVER** skip Step 7 screenshot sweep silently — always run it (unless `--no-sweep`); sweep failure must surface in summary, but **NEVER** roll back the successful archive on sweep failure
- **ALWAYS** call `screenshots-archive` via Skill tool with explicit `change <change-name>` argument so Mode B logic (caller-trusted, internal topic-mismatch prompt) kicks in
