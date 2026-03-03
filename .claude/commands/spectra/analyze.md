---
name: Spectra: Analyze
description: Analyze artifact consistency before implementation
category: Workflow
tags: ["workflow", "analyze", "quality"]
---

<!-- SPECTRA:START v1.0.0 -->

Analyze artifact consistency for a change. Can be invoked directly or triggered automatically when all artifacts are complete.

**Input**: Optionally specify a change name (e.g., `/spectra:analyze add-auth`). If omitted, infer from conversation context or auto-select if only one active change exists.

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
   - If only warnings/suggestions: Note them briefly, then recommend proceeding with `/spectra:apply`
   - If clean: "Artifacts look consistent" and suggest `/spectra:apply`

**Passive Trigger**

When `spectra status --change "<name>" --json` shows `isComplete: true`, run this analysis automatically before recommending `/spectra:apply`.

**Guardrails**

- Read-only: NEVER modify files
- Do NOT prompt for change selection if it can be inferred
- Keep output concise - this runs inline, not as a separate workflow
- If `spectra analyze` is not available, fall back to manual artifact reading
<!-- SPECTRA:END -->
