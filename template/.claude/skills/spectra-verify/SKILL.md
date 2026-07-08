---
name: spectra-verify
description: "Verify implementation matches artifacts"
context: fork
agent: Explore
disallowedTools: [Edit, Write]
license: MIT
compatibility: Requires spectra CLI.
effort: medium
metadata:
  author: spectra
  version: "1.0"
  generatedBy: "Spectra"
---
<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/spectra-verify/
Edit at: <clade-central-repo>
Local edits will be reverted by the next sync.
-->


## Claude fork context

This generated Claude Code skill runs with `context: fork`. The rules in this section take precedence over the shared `verify` body below.

When no change name is provided, run `spectra list --json` and consider only active changes with implementation tasks. Auto-select only when exactly one matching active change exists. If there are zero matching active changes or more than one matching active change, return the candidate list or empty-state message and ask the main thread to rerun `/spectra-verify <change-name>`. Do NOT ask an interactive selection question inside the fork.

---

Verify that an implementation matches the change artifacts (specs, tasks, design).

**Input**: Optionally specify a change name after `/spectra-verify` (e.g., `/spectra-verify add-auth`). If omitted, check if it can be inferred from conversation context. If vague or ambiguous you MUST prompt for available changes.

**Prerequisites**: This skill requires the `spectra` CLI. If any `spectra` command fails with "command not found" or similar, report the error and STOP.

**Steps**

1. **If no change name provided, prompt for selection**

   Run `spectra list --json` to get available changes. Use the **AskUserQuestion tool** to let the user select (if this tool is not available, ask as plain text and wait for the user's response).

   Show changes that have implementation tasks (tasks artifact exists).
   Include the schema used for each change if available.
   Mark changes with incomplete tasks as "(In Progress)".

   **IMPORTANT**: Do NOT guess or auto-select a change. Always let the user choose.

2. **Check status to understand the schema**

   ```bash
   spectra status --change "<name>" --json
   ```

   Parse the JSON to understand:
   - `schemaName`: The workflow being used (e.g., "spec-driven")
   - Which artifacts exist for this change

2.5. **Stash Reconcile (clade fork; not in upstream spectra)**

   Scan namespaced stashes related to this change before verifying. Prevents false-positive pass when WIP fixes are stuck in stash (auto-stashed by wt-helper / propagate / clade-publish) and never reapplied to the tree under verification — without this, verify on a clean tree reports green but real fixes haven't landed.

   - Run: `node scripts/stash-reconcile.mjs --slug "<change-name>" --json`
   - Parse stdout JSON. If `entries.length === 0`, continue silently to Step 3.
   - If hits: print one-line summary `⚠ Stash Reconcile: N entries match slug '<change>'`, then use **AskUserQuestion**:
     - **Show full report** — print each entry's `ref`, `namespace.kind`, `createdAt`, file list, and `recommendation.action`/`recommendation.reason`; then re-ask the same question
     - **Apply recommended** — for every entry where `recommendation.action === "apply"`, run `git stash apply <ref>` (safety contract: NEVER `pop` / `drop` here). Then continue to Step 3.
     - **Ignore and continue** — proceed with verify on current tree without touching stash
     - **Stop verify** — abort verification (user will reconcile manually)
   - **Skip condition**: if user passed `--no-reconcile` (or said "不要掃 stash" / "skip reconcile"), skip this step and print `Stash reconcile: skipped (user --no-reconcile)`.
   - **Failure handling**: if the script exits non-zero or JSON parse fails, print the error and continue to Step 3 (reconcile is advisory — do NOT block verify).

3. **Get the change directory and load artifacts**

   ```bash
   spectra instructions apply --change "<name>" --json
   ```

   This returns the change directory and context files. Read all available artifacts from `contextFiles`.

4. **Initialize verification report structure**

   Create a report structure with three dimensions:
   - **Completeness**: Track tasks and spec coverage
   - **Correctness**: Track requirement implementation and scenario coverage
   - **Coherence**: Track design adherence and pattern consistency

   Each dimension can have CRITICAL, WARNING, or SUGGESTION issues.

5. **Verify Completeness**

   **Task Completion**:
   - If tasks.md exists in contextFiles, read it
   - Parse checkboxes: `- [ ]` (incomplete) vs `- [x]` (complete)
   - Count complete vs total tasks
   - If incomplete tasks exist:
     - Add CRITICAL issue for each incomplete task
     - Recommendation: "Complete task: <description>" or "Mark as done if already implemented"

   **Spec Coverage**:
   - If delta specs exist in `openspec/changes/<name>/specs/`:
     - Extract all requirements (marked with "### Requirement:")
     - For each requirement:
       - Search codebase for keywords related to the requirement
       - Assess if implementation likely exists
     - If requirements appear unimplemented:
       - Add CRITICAL issue: "Requirement not found: <requirement name>"
       - Recommendation: "Implement requirement X: <description>"

5.5. **Manual-Review Pattern Re-check** (clade fork addition — advisory; verify is read-only)

   `/spectra-verify` runs with `disallowedTools: [Edit, Write]` (see frontmatter), so this step **does not fix** `## 人工檢查` pattern hits — it surfaces them as Completeness WARNING issues. The actual interactive fix path is `/spectra-archive` Step 3.3 (Fix now / @followup / @no-manual-review-check) or `/spectra-ingest` Check 7 if more context update needed first.

   ```bash
   bash scripts/spectra-advanced/post-propose-manual-review-check.sh <change-name>
   ```

   Exit 2 = pattern findings (any of `ABSTRACT_REFERENCE` / `CARD_WITHOUT_UID` / `UI_ITEM_NO_URL` / `MULTI_STEP_NOT_SCOPED` / `REVIEW_UI_BACKEND_ROUNDTRIP` / `INTERNAL_JARGON_LEAKAGE`). For each finding parsed from hook stderr:
   - Add a Completeness WARNING: `Manual-review pattern hit: <pattern> at tasks.md:<line>`
   - Recommendation: `Run /spectra-archive Step 3.3 to fix interactively (or Edit tasks.md per hook remediation guidance), then re-run /spectra-verify`

   Hook exits 0 → no Completeness manual-review issues added; proceed to Step 6 silently. Reference: `vendor/snippets/manual-review-enforcement/patterns.json` + `rules/core/manual-review.data-readiness.md`.

6. **Verify Correctness**

   **Requirement Implementation Mapping**:
   - For each requirement from delta specs:
     - Search codebase for implementation evidence
     - If found, note file paths and line ranges
     - Assess if implementation matches requirement intent
     - If divergence detected:
       - Add WARNING: "Implementation may diverge from spec: <details>"
       - Recommendation: "Review <file>:<lines> against requirement X"

   **Scenario Coverage**:
   - For each scenario in delta specs (marked with "#### Scenario:"):
     - Check if conditions are handled in code
     - Check if tests exist covering the scenario
     - If scenario appears uncovered:
       - Add WARNING: "Scenario not covered: <scenario name>"
       - Recommendation: "Add test or implementation for scenario: <description>"

   **Example Traceability**:
   - For each `##### Example:` in delta specs:
     - Check if a test exists that uses the same input values from the example's GIVEN/WHEN/THEN
     - If the example has a table, check if parameterized tests cover all rows
     - If examples appear untested, add WARNING: "Spec example not covered by test: <example name>" with recommendation to add a test using the GIVEN/WHEN/THEN from the example

7. **Verify Coherence**

   **Design Adherence**:
   - If design.md exists in contextFiles:
     - Extract key decisions (look for sections like "Decision:", "Approach:", "Architecture:")
     - Verify implementation follows those decisions
     - If contradiction detected:
       - Add WARNING: "Design decision not followed: <decision>"
       - Recommendation: "Update implementation or revise design.md to match reality"
   - If no design.md: Skip design adherence check, note "No design.md to verify against"

   **Code Pattern Consistency**:
   - Review new code for consistency with project patterns
   - Check file naming, directory structure, coding style
   - If significant deviations found:
     - Add SUGGESTION: "Code pattern deviation: <details>"
     - Recommendation: "Consider following project pattern: <example>"

8. **Generate Verification Report**

   **Summary Scorecard**:

   ```
   ## Verification Report: <change-name>

   ### Summary
   | Dimension    | Status           |
   |--------------|------------------|
   | Completeness | X/Y tasks, N reqs|
   | Correctness  | M/N reqs covered |
   | Coherence    | Followed/Issues  |
   ```

   **Issues by Priority**:
   1. **CRITICAL** (Must fix before archive):
      - Incomplete tasks
      - Missing requirement implementations
      - Each with specific, actionable recommendation

   2. **WARNING** (Should fix):
      - Spec/design divergences
      - Missing scenario coverage
      - Each with specific recommendation

   3. **SUGGESTION** (Nice to fix):
      - Pattern inconsistencies
      - Minor improvements
      - Each with specific recommendation

   **Final Assessment**:
   - If CRITICAL issues: "X critical issue(s) found. Fix before archiving."
   - If only warnings: "No critical issues. Y warning(s) to consider. Ready for archive (with noted improvements)."
   - If all clear: "All checks passed. Ready for archive."

   **Assessment evidence gate**（clade fork addition — 寫「All checks passed / Ready for archive」前 MUST）：report 附 `### Evidence` 段，每個 dimension 一行「實際執行的檢查＋結果」——Completeness 貼 tasks.md checkbox 計數的實跑輸出、Correctness 貼 requirement 關鍵詞搜尋的命中檔案清單（或「searched X, found in Y」摘要）、Coherence 貼 design 決策比對的 code refs。貼不出某 dimension 的證據＝該 dimension 在 scorecard 標「not verified」，不得計入 pass。

**Verification Heuristics**

- **Completeness**: Focus on objective checklist items (checkboxes, requirements list)
- **Correctness**: Use keyword search, file path analysis, reasonable inference - don't require perfect certainty
- **Coherence**: Look for glaring inconsistencies, don't nitpick style
- **False Positives**: When uncertain, prefer SUGGESTION over WARNING, WARNING over CRITICAL
- **Actionability**: Every issue must have a specific recommendation with file/line references where applicable

**Graceful Degradation**

- If only tasks.md exists: verify task completion only, skip spec/design checks
- If tasks + specs exist: verify completeness and correctness, skip design
- If full artifacts: verify all three dimensions
- Always note which checks were skipped and why

**Output Format**

Use clear markdown with:

- Table for summary scorecard
- Grouped lists for issues (CRITICAL/WARNING/SUGGESTION)
- Code references in format: `file.ts:123`
- Specific, actionable recommendations
- No vague suggestions like "consider reviewing"
