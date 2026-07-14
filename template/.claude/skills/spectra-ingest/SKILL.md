---
name: spectra-ingest
description: "Update an existing Spectra change from external context"
effort: xhigh
license: MIT
compatibility: Requires spectra CLI.
metadata:
  author: spectra
  version: "1.0"
  generatedBy: "Spectra"
---
<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/spectra-ingest/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


Update an existing Spectra change — from a plan file or conversation context.

**Plan file support** is available when the tool has a plan directory (`~/.claude/plans/`). Otherwise, use conversation context to update artifacts.

**Prerequisites**: This skill requires the `spectra` CLI. If any `spectra` command fails with "command not found" or similar, report the error and STOP.

**Input**: Optionally specify a plan file path or name.

- `/spectra-ingest ~/.claude/plans/agile-discovering-rocket.md`
- `/spectra-ingest agile-discovering-rocket`
- `/spectra-ingest` (use conversation context or auto-detect plan file)

**Steps**

1. **Locate the requirement source**

   a. **Argument provided** → treat as plan file reference (prepend `~/.claude/plans/` and append `.md` if needed)
   - If the file exists → use it as the plan file source, proceed to Step 2
   - If the file does NOT exist → report the error and **stop**

   b. **No argument, plan file detectable**:
   - Check conversation context for plan file path (plan mode system messages include the path like `~/.claude/plans/<name>.md`)
   - If found and the file exists → use the **AskUserQuestion tool** to ask:
     - Option 1: Use the plan file
     - Option 2: Use conversation context
   - If the user picks plan file → proceed to Step 2
   - If the user picks conversation context → skip Step 2, go to Step 3

   c. **No argument, no plan file detectable**:
   - Check `~/.claude/plans/` for recent files
   - If recent files exist → list 5 most recent with the **AskUserQuestion tool**, include "Use conversation context" as an additional option
   - If the user picks a file → proceed to Step 2
   - If the user picks conversation context → skip Step 2, go to Step 3

   d. **Conversation context fallback** (no plan files found at all):
   - Use conversation context to update artifacts
   - If conversation context is insufficient, use the **AskUserQuestion tool** to get more details
   - Warn: "No plan file found. Using conversation context."

2. **Parse the plan structure** (skip if using conversation context)

   Claude Code plan files typically contain:
   - **Title** (`# ...`) — the high-level goal
   - **Context** section — background, motivation, current state
   - **Stages/Steps** — numbered implementation stages with goals and file lists
   - **Files involved** — list of files to modify/create
   - **Verification** section — how to test the changes

   Extract:
   - `plan_title`: from the H1 heading
   - `plan_context`: from the Context section
   - `plan_stages`: each numbered stage with its goal and file list
   - `plan_files`: all file paths mentioned
   - `plan_verification`: verification steps

3. **Check for active changes** (REQUIRED — ingest only updates existing changes)

   ```bash
   spectra list --json
   ```

   Also check for parked changes:

   ```bash
   spectra list --parked --json
   ```

   Parse both JSON outputs to get the full list of changes (active + parked). Parked changes should be annotated with "(parked)" in any selection list.
   - If one change exists (active or parked) → use the **AskUserQuestion tool** to confirm updating it
   - If multiple changes exist → use the **AskUserQuestion tool** to let user pick which one to update
   - If no changes at all (neither active nor parked) → tell the user: "No active change found. Use `/spectra-propose` first to create one." and **stop**

4. **Select the change**

   After selecting the change, check if it is parked:

   ```bash
   spectra list --parked --json
   ```

   If the selected change appears in the `parked` array:
   - Inform the user that this change is currently parked（暫存）
   - Use **AskUserQuestion tool** to ask: continue (unpark) or cancel
   - If continue: run `spectra unpark "<name>"` then proceed
   - If cancel: stop the workflow

   If there is no AskUserQuestion tool available (non-Claude-Code environment):
   Inform the user that this change is currently parked（暫存）and ask via plain text whether to unpark and continue, or cancel.
   Wait for the user's response. If the user confirms, run `spectra unpark "<name>"` then proceed.

   Read existing artifacts for context before updating.

   ---

   **⚠ Pre-update gate: Plain-language scope check** (when scope is structurally changing)

   If the new context (plan file or conversation) introduces **structural scope change** — not just adding task detail — present a plain-language summary BEFORE rewriting artifacts so the user can catch misunderstandings early.

   **Trigger** structural-scope mode when the new context does any of:

   - Changes the proposal's "Why" or core motivation (not just adds tasks)
   - Touches DB schema / migration (new column, new table, new FK, enum extension)
   - Changes user-facing journeys (new admin/staff flow, new role, new entity)
   - Introduces a new architectural layer or cross-table relationship
   - Expands or contracts the change's coverage beyond the original capability

   **Skip** when the new context is purely additive task detail (e.g. "add screenshot to manual review step 3", "rename function X to Y", "fix typo in spec", "add @no-screenshot marker to item #4.2").

   **Apply the same 4-part structure as `/spectra-discuss` § Plain-Language Synthesis**:

   1. **現況** — what the change currently captures (use everyday metaphors — `櫃子` / `本子` / `服務窗口`, not `table` / `endpoint`)
   2. **差異** — what the new context actually wants (layered table if multi-intent)
   3. **建議調整** — N items, non-technical, with ASCII diagrams
   4. **範圍邊界** — 做 / 不做 table
   5. **Closing AskUserQuestion** — one focused confirmation question

   **Get explicit user confirmation** before proceeding to Step 5. If user signals "no, that's not what I meant" → loop back and clarify before touching artifacts.

   **NEVER** apply structural artifact changes without this confirmation step. The cost of a misread ingest is high — completed `[x]` tasks may need rework, design.md may need recapture, capability boundaries may shift.

   See `/spectra-discuss` SKILL.md § Plain-Language Synthesis for full structure, examples, and trigger details.

   ---

5. **Update artifacts**

   For each artifact, get instructions first:

   ```bash
   spectra instructions <artifact-id> --change "<name>" --json
   ```

   Use the `template` from instructions as the output structure. Apply `context` and `rules` as constraints but do NOT copy them into the file.

   The instructions JSON includes `locale` — the language to write artifacts in. If present, you MUST write the artifact content in that language. Exception: spec files (specs/\*/\*.md) MUST always be written in English regardless of locale, because they use normative language (SHALL/MUST).

   **Plan-to-Artifact Mapping** (when using a plan file):

   | Plan Section       | Artifact         | How to Map                                        |
   | ------------------ | ---------------- | ------------------------------------------------- |
   | Title              | Change name      | Convert to kebab-case                             |
   | Context            | proposal: Why    | Direct content transfer                           |
   | Stages overview    | proposal: What   | Summarize all stages                              |
   | Individual stages  | tasks.md groups  | One stage = one `##` heading, sub-items = `- [ ]` |
   | File paths         | proposal: Impact | Affected code list                                |
   | Verification steps | tasks.md         | Final verification task group                     |

   **Context-to-Artifact Mapping** (when using conversation context):

   | Conversation Element | Artifact         | How to Map                         |
   | -------------------- | ---------------- | ---------------------------------- |
   | Goal / requirement   | proposal: Why    | Extract motivation from discussion |
   | Discussed approach   | proposal: What   | Summarize agreed approach          |
   | Mentioned files      | proposal: Impact | Affected code list                 |
   | Discussion phases    | tasks.md groups  | One topic = one `##` heading       |

   **When updating an existing change:**
   - Merge new context into existing proposal (don't replace)
   - Add new tasks from plan stages or conversation, **preserve completed `[x]` items**
   - **Preserve existing `[P]` markers** on tasks that still qualify
   - Do NOT remove existing content

   **Parallel task markers (`[P]`)**: When creating or updating the **tasks** artifact, first read `.spectra.yaml`. If `parallel_tasks: true` is set, add `[P]` markers to new tasks that can be executed in parallel. Format: `- [ ] [P] Task description`. A task qualifies for `[P]` if it targets different files from other pending tasks AND has no dependency on incomplete tasks in the same group. When `parallel_tasks` is not enabled, do NOT add `[P]` markers — but still preserve any existing `[P]` markers already in the file.

   After creating each artifact, re-check status:

   ```bash
   spectra status --change "<name>" --json
   ```

   Continue until all `applyRequires` artifacts are complete. Show progress: "✓ Created <artifact-id>"

6. **Inline Self-Review** (before CLI analysis)

   After updating all artifacts, scan them manually. Fix issues inline, then proceed to the CLI analyzer.

   **Check 1: No Placeholders**

   These patterns are artifact failures — fix each one before proceeding:
   - "TBD", "TODO", "FIXME", "implement later", "details to follow"
   - Vague instructions: "Add appropriate error handling", "Handle edge cases", "Write tests for the above"
   - Delegation by reference: "Similar to Task N" without repeating specifics
   - Steps describing WHAT without HOW: "Implement the authentication flow" (what flow? what steps?)
   - Empty template sections left unfilled
   - Weasel quantities: "some", "various", "several" when a specific number or list is needed

   **Check 2: Internal Consistency**
   - Does every capability in the proposal have a corresponding spec?
   - Does the design reference only capabilities from the proposal?
   - Do tasks cover all design decisions, and nothing outside proposal scope?
   - Are file paths consistent across proposal Impact, design, and tasks?

   **Check 3: Scope Check**
   - More than 15 pending tasks → consider decomposing into multiple changes
   - Any single task would take more than 1 hour → split it
   - Touches more than 3 unrelated subsystems → consider splitting

   **Check 4: Ambiguity Check**
   - Are success/failure conditions testable and specific?
   - Are boundary conditions defined (empty input, max limits, error cases)?
   - Could "the system" refer to multiple components? Be explicit.

   **Check 5: Preservation Check** (ingest-specific)
   - Are all completed tasks `[x]` still present and unchanged?
   - Were existing `[P]` markers preserved on tasks that still qualify?
   - Was existing content merged (not replaced)?

   **Check 6: Durable Handoff Review** (run BEFORE the CLI analyzer)

   The updated change has to survive being parked or handed to another agent. Reject and fix any of the following on **incomplete** design and task content (do not rewrite completed `[x]` tasks):
   - **File-path-only tasks**: a pending task whose entire description is "edit file X" with no behavior, contract, or verification target. File paths are locator context — the task SHALL still describe what is observably true when complete.
   - **Line-number-coupled instructions**: design or task content that points to "line 42" / "the function on lines 80-95" as the only way to identify the work. Source line numbers drift; name the function, command, struct, or behavior instead.
   - **Vague acceptance criteria**: success conditions like "works correctly", "behaves as expected", "handles edge cases" without naming the observable behavior or the verification target (test name, CLI invocation, analyzer rule, manual assertion).
   - **Missing scope boundaries on non-trivial work**: design lacking explicit "in scope" / "out of scope" lines for any change that touches more than one subsystem or introduces new behavior. Trivial artifact-only edits MAY skip this; runtime, build, or tooling effects MUST NOT.

   Fix every failure inline using the existing context and the new plan/conversation source before running the CLI analyzer. Update incomplete design and task content so behavior contracts, verification criteria, and scope boundaries stay current with the new context. Preserve completed tasks unchanged.

   **Check 7: Manual Review Marker Hygiene** (clade fork — applies whenever ingest modifies `## 人工檢查` items)

   `/spectra-ingest` retro-updates a change after impl / verify, which can introduce **new** `## 人工檢查` items or modify existing ones — bypassing `/spectra-propose` Step 5.5. The same hygiene rules **MUST** be enforced here. Apply Rule 1-4 mirroring `spectra-propose` Step 5.5 (Manual Review Marker Hygiene Check). Violations → main thread Edits `tasks.md` directly (do **NOT** round-trip to codex; too slow):

   **Rule 1: Every item line MUST carry a leading marker**

   - Each `- [ ] #N ...` / `- [ ] #N.M ...` line **MUST** have a legal marker immediately after the id: `[review:ui]` / `[discuss]` / `[verify:e2e]` / `[verify:api]` / `[verify:ui]` / verify multi-marker `[verify:<a>+<b>]` or `[verify:<a>+<b>+<c>]`
   - Verify multi-marker channels limited to `e2e` / `api` / `ui`, canonical order `e2e → api → ui`
   - Multi-marker **MUST NOT** mix with `[review:ui]` / `[discuss]`; `[verify:api+review:ui]` / `[verify:api+discuss]` are illegal
   - Missing marker → classify per Rule 2 / 3 / 4 content and add explicit marker; **DO NOT** rely on Default Kind Derivation Rule (fallback is for legacy in-flight items only, and silently falls back to the most strict `review:ui` — the root cause of repeated `[review:ui]` mis-tagging)
   - Ingest-modified items **MUST** carry explicit marker even if the original (legacy) item did not. Ingest is the boundary where Default Kind Derivation grandfathering ends.

   **Rule 2: Evidence-collection items → `[discuss]` or `[verify:api]`**

   Items containing `Apply migration` / `SSH` / `docker exec` / `psql` / `\d <table>` / `SELECT ... FROM` / `curl` / `Trigger ... cron` / `SET session_replication_role` / 「合理性檢查」/「商業判斷」:

   - SSH / psql / `\d` / `SELECT` / controlled drift / migration existence / 商業判斷 → `[discuss]`
   - `curl` / HTTP endpoint round-trip reproducible by apply main thread → `[verify:api]`
   - Misclassified `[review:ui]` / `[verify:ui]` / deprecated `[verify:auto]` → change to `[discuss]` or `[verify:api]`

   **Rule 3: Real user round-trip items → channel per evidence shape**

   - persistence / reload / full journey → `[verify:e2e]`
   - HTTP status / backend contract → `[verify:api]`
   - final-state visual only → `[verify:ui]`
   - mutation response + visual state → `[verify:api+ui]`
   - journey + extra screenshot evidence → `[verify:e2e+ui]`
   - real-person-required (Rule 4 whitelist) → `[review:ui]`

   **Rule 4: `[review:ui]` whitelist**

   `[review:ui]` only when description contains one of:

   - email inbox / webhook (agent inbox unreachable)
   - 「視覺主觀」/「美感」/「a11y 主觀判斷」
   - 「實體裝置」/「真機」/「手機」/「平板」/「kiosk QR」/「印表機」/「條碼槍」
   - 「跨機器」/「跨 session」/ production-authorized operation
   - 「電話」/「SMS」 or spec-external non-UI environment

   Otherwise → explicit `verify:*` per Rule 3. Misclassified items flagged and rewritten by main thread.

   **Then re-run the hook**:

   ```bash
   bash scripts/spectra-advanced/post-propose-manual-review-check.sh <change-name>
   ```

   Exit 2 = pattern findings (any of `MISSING_KIND_MARKER` / `ABSTRACT_REFERENCE` / `CARD_WITHOUT_UID` / `UI_ITEM_NO_URL` / `MULTI_STEP_NOT_SCOPED` / `REVIEW_UI_BACKEND_ROUNDTRIP` / `INTERNAL_JARGON_LEAKAGE` / `MIXED_CN_EN_TERM`). Main thread **SHALL** Edit `tasks.md` directly per hook stdout remediation guidance. Reference: `vendor/snippets/manual-review-enforcement/patterns.json` + `rules/core/manual-review.data-readiness.md`.

   Legitimate false positive (e.g., 真機掃 SMS 無 dev replay endpoint) → add `@no-manual-review-check[<reason>]` trailing marker per `manual-review.md`「`@no-manual-review-check` Marker」.

   **Why this exists**: Without ingest-time enforcement, items modified or added after the original propose cycle can land with `Default Kind Derivation Rule` silently falling back to `[review:ui]`. The review-gui displays the fallback identically to an explicit marker, so the user only discovers the mismatch when they reach the item in review (e.g., 「為何叫我打 API」 / 「這違反 review:ui 收斂原則」). This loop has repeated across multiple changes — ingest **MUST** be the gate that catches it.

---

## Rationalization Table

| What You're Thinking                                             | What You Should Do                                                            |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| "The existing artifacts are close enough, just adjust the tasks" | Read the new context carefully. "Close enough" means you're missing something |
| "The proposal doesn't need updating, the change is the same"     | If new context exists, the proposal likely needs updates. At minimum, check   |
| "I can merge these tasks, they're basically the same"            | Keep tasks granular. Merged tasks are harder to track                         |
| "The completed tasks still apply, no need to review"             | Verify they're still relevant to updated scope. Don't blindly keep stale work |
| "This spec change is minor, skip the scenario update"            | If the requirement changed, the scenario must change                          |
| "The conversation didn't discuss this artifact, so skip it"      | Absence of discussion doesn't mean absence of impact. Check                   |

---

7. **Analyze-Fix Loop** (max 2 iterations)

   ```bash
   spectra analyze <name> --json
   ```

   1. Filter findings to **Critical and Warning only** (ignore Suggestion)
   2. If no Critical/Warning findings → show "Artifacts look consistent ✓" and proceed
   3. If Critical/Warning findings exist:
      a. Show: "Found N issue(s), fixing... (attempt M/2)"
      b. Fix each finding in the affected artifact
      c. Re-run `spectra analyze <name> --json`
      d. Repeat up to 2 total iterations
   4. After 2 attempts, if findings remain:
      - Show remaining findings as a summary
      - Proceed normally (do NOT block)

8. **Validation**

   ```bash
   spectra validate "<name>"
   ```

   If validation fails, fix errors and re-validate.

8.5. **Commit artifacts** (post-validation, TD-216 desync prevention)

   After validation passes, **MUST** commit the updated openspec artifacts so `/wt` fork picks up re-scoped tasks.md:

   ```bash
   git commit --only -m "📝 spectra: ingest <change-name>" -- openspec/changes/<change-name>/
   ```

   Per worktree-default §9.5, spectra artifacts MUST live in git. Uncommitted re-scoped tasks.md causes review-gui impl-gate desync: `/wt` fork inherits committed (pre-ingest) version → build in worktree uses old phase list → review-gui reads main's re-scoped tasks.md with unchecked phases → impl% falsely low.

9. **Summary and next steps**

   Show:
   - Source used: plan file (`<path>`) or conversation context
   - Change name and location
   - Artifacts created/updated
   - Validation result

   Use **AskUserQuestion tool** to confirm the workflow is complete. This ensures the workflow stops even when auto-accept is enabled. Provide exactly these options:
   - **First option (will be auto-selected)**: "Done" — End the ingest workflow. Inform the user they can run `/spectra-apply <change-name>` when ready.
   - **Second option**: "Apply" — Invoke `/spectra-apply <change-name>` to start implementation.

   If **AskUserQuestion tool** is not available, display the summary and inform the user to run `/spectra-apply <change-name>` when ready. Then STOP — do not continue.

   **After the user responds**, if they chose "Done", the workflow is OVER. If they chose "Apply", invoke `/spectra-apply <change-name>` to begin implementation.

**Guardrails**

- **NEVER** modify the original plan file in `~/.claude/plans/`
- **NEVER** write application code — this skill only creates/updates Spectra artifacts
- **NEVER** create new changes — ingest only updates existing changes. If no active change exists, direct user to `/spectra-propose`
- When updating existing changes, **preserve all completed tasks** (`[x]`) — never revert progress
- If the source content is too brief to fill all artifact sections, use the **AskUserQuestion tool** to get more details rather than inventing content
- If `spectra` CLI is not available, report the error and stop
- Verify each artifact file exists after writing before proceeding to next
- **NEVER** skip the artifact workflow to write code directly
- **NEVER** apply structural scope changes (DB schema / new journeys / new architectural layer) without running the Pre-update plain-language gate between Step 4 and Step 5 — see "Pre-update gate: Plain-language scope check" callout
- If **AskUserQuestion tool** is not available, ask the same questions as plain text and wait for the user's response
