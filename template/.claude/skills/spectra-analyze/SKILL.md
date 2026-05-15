---
name: spectra-analyze
description: "Analyze artifact consistency for a change"
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
Source: plugins/hub-core/skills/spectra-analyze/
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->


## Claude fork context

This generated Claude Code skill runs with `context: fork`. The rules in this section take precedence over the shared `analyze` body below.

When no change name is provided, run `spectra list --json`. Auto-select only when there is exactly one active change. If there are zero active changes or more than one active change, return the candidate list or empty-state message and ask the main thread to rerun `/spectra-analyze <change-name>`. Do NOT ask an interactive selection question inside the fork.

---

Analyze artifact consistency for a change. Can be invoked directly or triggered automatically when all artifacts are complete.

**Input**: Optionally specify a change name (e.g., `/spectra-analyze add-auth`). If omitted, infer from conversation context or auto-select if only one active change exists.

**Prerequisites**: This skill requires the `spectra` CLI. If any `spectra` command fails with "command not found" or similar, report the error and STOP.

**Steps**

1. **Determine change name**

   If not provided, infer from context or run `spectra list --json` to auto-select.

2. **Run programmatic analysis**

   ```bash
   spectra analyze <change-name> --json
   ```

   This returns structured JSON with:
   - `dimensions`: Array of `{ dimension, status, finding_count }` for Coverage, Consistency, Ambiguity, Gaps
   - `findings`: Array of `{ id, dimension, severity, location, summary, recommendation }`
   - `artifacts_analyzed` / `artifacts_missing`: Which artifacts were available

3. **Present results**

   Format the JSON output as a readable summary:

   ```
   ## Artifact Analysis: <change-name>

   | Dimension     | Status                   |
   |---------------|--------------------------|
   | Coverage      | <status>                 |
   | Consistency   | <status>                 |
   | Ambiguity     | <status>                 |
   | Gaps          | <status>                 |
   ```

   Group findings by severity (Critical > Warning > Suggestion) with locations and recommendations.

4. **Supplement with AI semantic analysis** (optional)

   The programmatic analyzer catches structural issues. For deeper semantic analysis, also read the artifacts and check for:
   - Design decisions that contradict spec requirements
   - Tasks referencing work outside proposal scope
   - Risks in design without corresponding spec coverage
   - Logical inconsistencies between artifacts

   Add any additional findings to the report.

5. **Recommend next steps**
   - If CRITICAL findings: "Found N issue(s) worth addressing. Want to fix these before implementing?"
   - If only warnings/suggestions: Note them briefly, then recommend proceeding with `/spectra-apply`
   - If clean: "Artifacts look consistent" and suggest `/spectra-apply`

**Passive Trigger**

When `spectra status --change "<name>" --json` shows `isComplete: true`, run this analysis automatically before recommending `/spectra-apply`.

**Guardrails**

- Read-only: NEVER modify files
- Do NOT prompt for change selection if it can be inferred
- Keep output concise - this runs inline, not as a separate workflow
- If **AskUserQuestion tool** is not available, ask the same questions as plain text and wait for the user's response
