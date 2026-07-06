---
name: spectra-commit
description: "Commit files related to a specific Spectra change"
license: MIT
compatibility: Requires spectra CLI.
metadata:
  author: spectra
  version: "1.0"
  generatedBy: "Spectra"
---
<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/spectra-commit/
Edit at: <clade-central-repo>
Local edits will be reverted by the next sync.
-->


Commit files related to a specific Spectra change.

This is a **utility skill** (not a workflow step). It reads source file tracking data and artifact changes to stage and commit only the files belonging to one change — useful when multiple changes are in progress simultaneously.

**Input**: Optionally specify a change name after `/spectra-commit` (e.g., `/spectra-commit add-auth`). If omitted, check if it can be inferred from conversation context. If vague or ambiguous you MUST prompt for available changes.

**Prerequisites**: This skill requires `git`. Run `git --version`. If git is not available (command not found or similar error), inform the user to install git and STOP.

**Steps**

1. **Select the change**

   If a name is provided, use it. Otherwise:
   - Infer from conversation context if the user mentioned a change
   - Auto-select if only one active change exists
   - If ambiguous, run `spectra list --json` to get available changes. Use the **AskUserQuestion tool** to let the user select

   Always announce: "Committing for change: <name>"

2. **Read tracking file**

   Check for `.spectra/touched/<change-name>.json`. If it exists, parse it to get source files grouped by task.

   Expected format:

   ```json
   {
     "change": "<change-name>",
     "touched": [
       {
         "task_id": "1",
         "task_desc": "Task description",
         "files": ["src/file1.ts", "src/file2.ts"]
       }
     ]
   }
   ```

   If the file does not exist, proceed without source file data — only artifact files will be included.

3. **Collect artifact files**

   Run `git status --porcelain` and filter the output to files under `openspec/changes/<name>/`. These are the change's artifact files (proposal, design, tasks, specs, etc.).

4. **Identify unrelated dirty files**

   From the full `git status --porcelain` output, any dirty files NOT in the artifact set and NOT in the tracking file are "unrelated changes."

<!-- clade fork begin: claim-aware partition (rules/core/session-claims.md) -->

4a. **[Clade fork] Claim-aware partition of unrelated changes**

    When multiple AI sessions work in parallel, some "unrelated changes" may
    belong to **another active session's** worktree (not your current
    commit's scope). Auto-committing them would silently swallow another
    session's WIP. This step adds session-ownership classification.

    Detection:
    - Check whether `scripts/claim-helper.mjs` exists in the repo root.
    - If yes, run `node scripts/claim-helper.mjs list` to enumerate active
      session claims on this consumer.
    - If no claim infra is present, skip 4a entirely — fall through to
      upstream behavior (step 5).

    For each path in "unrelated changes", classify by matching against each
    active claim's `expected_paths` (glob support: exact match, `prefix/**`
    recursive, `prefix/*` single-level):
    - **Other-session paths**: matched to any active claim. **DO NOT** include
      in commit set under any user option, even "Include all dirty files",
      without explicit re-confirmation. List the matched session_id + change_id
      so the user knows which session owns the path.
    - **Truly unrelated**: no claim match. Same upstream behavior — exclude by
      default, includable via "Include all dirty files".

<!-- clade fork end -->

5. **Display commit plan**

   Show the file list grouped into sections:

   ```
   ## Commit Plan: <change-name>

   ### Change Artifacts
   - M  openspec/changes/<name>/proposal.md
   - M  openspec/changes/<name>/tasks.md

   ### Source Files
   **Task 1: <task description>**
   - M  src/lib/components/search.svelte
   - A  src/lib/stores/search.ts

   **Task 3: <task description>**
   - M  src/routes/+page.svelte

   ### Unrelated Changes (not included)
   - M  src/lib/utils/format.ts
   - ??  tmp/scratch.js
   ```

   <!-- clade fork begin: claim-aware partition (rules/core/session-claims.md) -->

   When step 4a populated other-session paths, insert an extra section
   between "Source Files" and "Unrelated Changes":

   ```
   ### Other Active Sessions (fail-closed; excluded even on "Include all")
   - M  layers/workstation/foo.ts  ← session abc123 / change workstation-report-ux-polish
   - ??  server/api/bar.ts          ← session def456 / change add-vending-stats
   ```

   <!-- clade fork end -->

   If no tracking file was found, show a warning instead of the Source Files section:

   ```
   ### Source Files
   ⚠ No source file tracking data found.
   Only artifact files will be committed. Use `spectra task done` during apply to enable source file tracking.
   ```

   If there are no artifact files AND no tracked source files, inform the user that there is nothing to commit and STOP.

6. **User confirmation**

   Use the **AskUserQuestion tool** to ask the user how to proceed.

   Options:
   - **Commit as shown**: Proceed with the displayed artifact + source files
   - **Include all dirty files**: Add all unrelated files to the commit as well
   - **Customize**: Let the user add or remove specific files from the commit set
   - **Archive first, then commit together**: Run archive before committing — archive file moves will be included in this commit

   <!-- clade fork begin: claim-aware partition (rules/core/session-claims.md) -->

   **If "Other Active Sessions" section is non-empty** (step 4a populated it):

   - **Commit as shown** / **Customize**: other-session paths stay excluded; no re-confirm needed.
   - **Include all dirty files**: BEFORE proceeding, re-confirm with explicit
     list of other-session paths. Use AskUserQuestion with options:
       - **Skip other-session paths** (recommended): commit only truly-unrelated
         dirty + artifact + source — leaves other sessions' WIP intact.
       - **Force-include all (overwrites another session's commit opportunity)**:
         risky; only choose if user confirms they own the other session too.
       - **Stop and resolve manually**: abort commit; user investigates.

   <!-- clade fork end -->

   If the user selects "Customize":
   - Show a numbered list of all dirty files (included and excluded)
   - Ask which files to add or remove
   - Re-display the updated commit plan for confirmation

   If the user selects "Archive first, then commit together":
   - Proceed to step 6a (Archive sub-flow) before continuing to step 7

6a. **Archive sub-flow** (only when the user selected "Archive first, then commit together")

    This sub-flow executes three checks in sequence before returning to the main commit flow.

    **6a-i. Incomplete task handling**

    Read the tasks file at `openspec/changes/<name>/tasks.md`. Count `- [x]` (complete) and `- [ ]` (incomplete) checkboxes.

    - If **all tasks are complete**: skip to 6a-ii.
    - If **incomplete tasks exist**:
      - Display the list of incomplete tasks
      - Use the **AskUserQuestion tool** to ask: "These tasks are still incomplete. Mark all as complete before archiving?"
        - **Yes**: set a flag to pass `--mark-tasks-complete` to `spectra archive`
        - **No**: proceed without the flag (archive will continue with a warning)

      If **AskUserQuestion tool** is not available, ask the same question as plain text and wait for the user's response.

    **6a-ii. Delta spec sync check**

    Check whether delta specs exist at `openspec/changes/<name>/specs/`.

    - If **no delta specs exist** (directory is empty or absent): skip to 6a-iii.
    - If **delta specs exist**:
      - Use the **AskUserQuestion tool** to ask: "Delta specs found. Sync to main specs before archiving?"
        - **Yes**: run `spectra sync <name>` before proceeding
        - **No**: proceed without syncing

      If **AskUserQuestion tool** is not available, ask the same question as plain text and wait for the user's response.

    **6a-iii. Archive execution and file collection**

    Execute the archive:

    ```bash
    spectra archive <name>          # without --mark-tasks-complete
    spectra archive <name> --mark-tasks-complete  # if user chose to mark tasks complete in 6a-i
    ```

    After archive completes successfully:

    1. Re-run `git status --porcelain` to capture all file changes produced by the archive (deletions from `openspec/changes/<name>/`, additions in `openspec/archived/`)
    2. Add these archive-related file changes to the commit set
    3. Display an **updated commit plan** showing all sections:

    ```
    ## Updated Commit Plan: <change-name> (with archive)

    ### Change Artifacts (archived)
    - D  docs/specs/changes/<name>/proposal.md
    - D  docs/specs/changes/<name>/tasks.md
    - ...

    ### Archived Files
    - A  docs/specs/archived/<name>/proposal.md
    - A  docs/specs/archived/<name>/tasks.md
    - ...

    ### Source Files
    (same as before)

    ### Spec Sync Changes (if sync was performed)
    - M  docs/specs/specs/<spec-name>/spec.md
    - ...
    ```

    Then continue to step 7.

7. **Generate commit message**

   Read the proposal file at `openspec/changes/<name>/proposal.md`. Extract the first sentence from the Why section (or Problem/Summary section if Why is absent).

   Generate a message in this format:

   ```
   spectra(<change-name>): <summary>

   Change: <change-name>
   Tasks: <completed>/<total> complete
   ```

   If the archive sub-flow was executed (user selected "Archive first, then commit together"), add `Archived: yes` to the message body:

   ```
   spectra(<change-name>): <summary>

   Change: <change-name>
   Tasks: <completed>/<total> complete
   Archived: yes
   ```

   Task progress comes from reading the tasks file and counting `- [x]` vs `- [ ]` checkboxes.

   Show the generated message to the user and allow editing before proceeding.

8. **Selective staging**

   Stage each confirmed file individually:

   ```bash
   git add <file1>
   git add <file2>
   ...
   ```

   **NEVER use `git add .` or `git add -A`.** Each file must be staged explicitly.

9. **Commit**

   ```bash
   git commit --only -m "<message>" -- <file1> <file2> ...
   ```

   `--only` 以 pathspec 過濾 commit 範圍——別 session 預 staged 的檔案不會被捲入（4a partition 的 fail-closed 因此在機制上成立）。

10. **Show result**

    ```bash
    git log --oneline -1
    ```

    Display the commit hash and message to confirm.

**Output On Success**

```
## Committed: <change-name>

**Commit:** <short-hash> spectra(<change-name>): <summary>
**Files:** <N> files committed (<A> artifacts, <S> source files)
**Tasks:** <completed>/<total> complete
```

**Output On Nothing To Commit**

```
## Nothing to Commit

**Change:** <change-name>

No dirty files found for this change (no modified artifacts, no tracked source files).
```

**Guardrails**

- **NEVER use `git add .` or `git add -A`** — every file must be staged individually with `git add <file>`
- **NEVER commit files the user hasn't confirmed** — always show the file list and get explicit confirmation first
- **Always show the full file list before committing** — no silent staging
- If the tracking file is missing, warn but don't block — artifact-only commits are valid
- The "Unrelated Changes" section is informational only — these files are excluded by default
- If **AskUserQuestion tool** is not available, ask the same questions as plain text and wait for the user's response
