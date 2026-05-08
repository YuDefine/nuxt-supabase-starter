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
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->


Archive a completed change.

**Input**: Optionally specify a change name after `/spectra-archive` (e.g., `/spectra-archive add-auth`). If omitted, check if it can be inferred from conversation context. If vague or ambiguous you MUST prompt for available changes.

**Prerequisites**: This skill requires the `spectra` CLI. If any `spectra` command fails with "command not found" or similar, report the error and STOP.

**Steps**

1. **If no change name provided, prompt for selection**

   Run `spectra list --json` to get available changes. Use the **AskUserQuestion tool** to let the user select.

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

   Count tasks marked with `- [ ]` (incomplete) vs `- [x]` (complete).

   **If incomplete tasks found:**
   - Display warning showing count of incomplete tasks
   - Prompt user for confirmation to continue
   - Proceed if user confirms

   **If no tasks file exists:** Proceed without task-related warning.

4. **Preview delta spec sync (informational)**

   The `spectra archive` CLI applies delta specs to main specs by default; this step previews what will be applied so the user can choose to sync or skip via the CLI flag in step 6.

   Check for delta specs at `openspec/changes/<name>/specs/`. If none exist, proceed to step 5 without prompting.

   **If delta specs exist:**
   - Compare each delta spec with its corresponding main spec at `openspec/specs/<capability>/spec.md`
   - Determine what changes would be applied (adds, modifications, removals, renames)
   - Show a combined summary before prompting

   **Prompt options:**
   - "Sync now (recommended)" — step 6 runs `spectra archive <name>` (default: applies deltas)
   - "Archive without syncing" — step 6 runs `spectra archive <name> --skip-specs`
   - "Cancel" — STOP without archiving

   Record the user's choice for step 6. Do NOT invoke any separate sync skill — the CLI is the single source of truth for delta application.

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
**Archived to:** openspec/changes/archive/YYYY-MM-DD-<name>/
**Specs:** ✓ Synced to main specs
**Screenshots:** ✓ Swept to _archive/YYYY-MM/ (or: no screenshots / skipped (user --no-sweep) / sweep failed)

All artifacts complete. All tasks complete.
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
- Delta spec application is performed by `spectra archive` itself (default behavior); user choice in step 4 only controls whether to pass `--skip-specs`. Do NOT invoke a separate sync skill — the CLI is SSOT.
- If delta specs exist, always run the sync preview and show the combined summary before prompting
- If **AskUserQuestion tool** is not available, ask the same questions as plain text and wait for the user's response
- **NEVER** skip Step 7 screenshot sweep silently — always run it (unless `--no-sweep`); sweep failure must surface in summary, but **NEVER** roll back the successful archive on sweep failure
- **ALWAYS** call `screenshots-archive` via Skill tool with explicit `change <change-name>` argument so Mode B logic (caller-trusted, internal topic-mismatch prompt) kicks in
