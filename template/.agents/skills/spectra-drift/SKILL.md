---
name: spectra-drift
description: "Detect drift between a Spectra change and the current codebase state"
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
Source: plugins/hub-core/skills/spectra-drift/
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->


## Claude fork context

This generated AI Agent skill runs with `context: fork`. The rules in this section take precedence over the shared `drift` body below.

When no change name is provided, run `spectra list --json`. Auto-select only when there is exactly one active change. If there are zero active changes or more than one active change, return the candidate list or empty-state message and ask the main thread to rerun `/spectra-drift <change-name>`. Do NOT ask an interactive selection question inside the fork.

---

Detect drift between a Spectra change and the current codebase state. Reports time dormancy, broken design anchors, task collisions with external commits, and a single recommended next command.

**Input**: Optionally specify a change name (e.g., `/spectra-drift add-auth`). If omitted, infer from conversation context or auto-select if only one active change exists.

**Prerequisites**: This skill requires the `spectra` CLI. If any `spectra` command fails with "command not found" or similar, report the error and STOP.

**Steps**

1. **Determine change name**

   If not provided, infer from context or run `spectra list --json` to auto-select. If multiple active changes exist and no name is given, list candidates and ask the user to rerun with an explicit name.

2. **Run programmatic drift analysis**

   ```bash
   spectra drift <change-name> --json
   ```

   The JSON contains:
   - `severity`: `"light"` / `"medium"` / `"heavy"`
   - `total_score`: aggregate over Time / Structure / Tasks (Environment is display-only)
   - `dimensions`: array of `{ kind, status, score, contributes_to_total }`
   - `broken_anchors`: design.md references (file paths / symbols / functions / CLI flags) that no longer resolve
   - `tasks_blocked_external`: pending tasks whose referenced files were modified by commits outside the change dir
   - `tasks_maybe_resolved`: pending tasks whose verb+target keywords match commit subjects since `created`
   - `primary_recommendation`: a single copy-pasteable command line

3. **Present the report**

   Use a user-readable, conclusion-first format. The first substantive paragraph after the title MUST be a plain-language conclusion that says what to do next before showing score tables, broken anchors, task collisions, or severity labels.

   Translate severity into action-oriented meaning:
   - **Light**: the change can continue with apply.
   - **Medium**: the change can continue, but the plan should be refreshed before implementation.
   - **Heavy**: the old plan is likely unsuitable for direct implementation; restart or refresh first.

   Recommended shape:

   ```markdown
   ## Drift Report: <change-name>

   <Plain-language conclusion. Example for medium: "This change can continue, but update the plan before implementing it. Related code has changed since the plan was written, so applying the old tasks directly may cause rework or conflicts.">

   ### Why

   - <1-3 plain-language reasons derived from dimensions, broken anchors, and task collisions>

   ### Details

   | Item              | Result                                                 |
   | ----------------- | ------------------------------------------------------ |
   | Time              | <status>                                               |
   | Design references | <broken anchor count or "No broken references">        |
   | Pending tasks     | <blocked/maybe-resolved count or "No task collisions"> |
   | Overall           | <light/medium/heavy, total score N>                    |

   ### Recommendation

   Run `<primary_recommendation>`.
   ```

   Keep technical details below the plain-language conclusion. List broken anchors, blocked tasks, and maybe-resolved tasks only when non-empty. Omit empty technical detail sections entirely. Keep the report short enough to skim; the goal is to help the user decide, not to explain the scoring model.

4. **Apply the recommendation interactively**

   Use the **request_user_input 工具** to offer one decision based on `severity`. Use plain-language option labels while preserving the exact command in each option description. Do NOT auto-invoke `/spectra-apply`, `/spectra-ingest`, or `spectra archive`; always wait for the user's choice.
   - **Light** (score 0-3, drift is minor):
     - Recommended label: "Directly start work"
       - Description: run `/spectra-apply <name>`
     - Alternate label: "Pause for now"
       - Description: do nothing until the user reviews manually
   - **Medium** (score 4-8, refresh worth doing):
     - Recommended label: "Refresh the plan"
       - Description: run `/spectra-ingest <name>` with the broken references and task collisions as context
     - Alternate label: "Directly start work"
       - Description: run `/spectra-apply <name>` only if the user knows the reported changes are harmless
     - Alternate label: "Pause for now"
       - Description: do nothing until the user reviews manually
   - **Heavy** (score >8 or anchor decay >30%, design diverges from code):
     - Recommended label: "Archive and restart"
       - Description: run `<primary_recommendation>`
     - Alternate label: "Refresh the plan"
       - Description: try `/spectra-ingest <name>` before restarting
     - Alternate label: "Pause for now"
       - Description: do nothing until the user reviews manually

   If the **request_user_input 工具** is not available, present the same plain-language choices as text and wait for the user's response.

**Passive Trigger**

When `/spectra-apply` is invoked on a change whose `.openspec.yaml created` date is more than 5 days ago AND no commits have touched the change directory in the past 3 days, the apply skill SHOULD run drift analysis first and surface findings before tasks begin. The trigger is guidance only and MUST NOT block apply from proceeding.

(Threshold reasoning: AI-assisted commits are daily-cadence, not weekly. A change sitting ≥5 days with ≥3 days of no commits is almost always genuine stagnation rather than normal pacing.)

**Guardrails**

- Read-only: NEVER modify files, artifacts, or git state based on drift findings
- The CLI caps anchor checks at 50 via `ANCHOR_CAP` in `spectra_core::drift` to bound run-time
- If `spectra drift` returns a non-zero exit code (e.g., older binary without the drift subcommand), report the error and stop
- Do NOT auto-invoke any follow-up command — recommendations are user-confirmed
- If **request_user_input 工具** is not available, ask the same questions as plain text and wait for the user's response
