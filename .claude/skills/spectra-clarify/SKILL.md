---
name: spectra-clarify
description: 'Clarify ambiguities in artifacts through structured questioning'
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: spectra
  version: '1.0'
  generatedBy: 'Spectra'
---

Clarify ambiguities in change artifacts through structured questioning. This is a passive skill — invoke it when you detect unclear requirements, vague language, or contradictions while working on a change.

**Trigger**: When you encounter ambiguities while creating artifacts (during `/spectra:propose` or `/spectra:ingest`), or after analyze flags ambiguity/gap issues.

**Input**: The change name (from context) and optionally which artifact has the ambiguity.

**Steps**

1. Identify ambiguities in the current artifacts (up to 5, ranked by importance):

   **High importance** (ask first):
   - Requirements without scenarios (`### Requirement:` with no `#### Scenario:`)
   - Contradictions between artifacts
   - Explicit markers: TBD, TODO, NEEDS CLARIFICATION
   - Missing scope boundaries (no Non-Goals)

   **Medium importance**:
   - Vague language in specs: "should", "may", "might", "consider", "as needed"
   - Undefined terms or concepts
   - Design decisions without rationale

   **Lower importance**:
   - Missing error/edge case scenarios
   - Implicit assumptions

   If no ambiguities: skip this skill silently — do not mention it to the user.

2. For each ambiguity, ask ONE question at a time using **AskUserQuestion**:
   - Clear question about the specific ambiguity
   - 2-3 options including AI recommended answer (marked "(Recommended)")
   - Description on each option explaining impact on artifacts

   Example:

   ```
   Question: "Auth spec says users 'should' be logged out after password change. Mandatory or optional?"
   Options:
   - "Mandatory (MUST)" (Recommended) — Safer, forces logout on all sessions
   - "Optional (MAY)" — More flexible, let implementation decide
   - "Configurable" — Add a setting, most flexible but adds complexity
   ```

3. After each answer, immediately update the artifact with clarified wording.
   Show briefly: "Updated specs/auth/spec.md: 'should' → 'SHALL'"

4. After all questions (or user says stop), show a brief summary:

   ```
   Clarified N ambiguities:
   - specs/auth/spec.md: session logout → mandatory (SHALL)
   - design.md: added Redis rationale
   ```

**Guardrails**

- Maximum 5 questions per invocation
- One question at a time
- Always provide a recommended answer
- Respect user's choice — never re-ask
- Minimal targeted edits when updating artifacts
- Do NOT create new artifacts — only update existing ones
- If user seems impatient or says to skip, stop immediately
- Keep it lightweight — this is a mid-flow check, not a separate workflow
- If **AskUserQuestion tool** is not available, ask the same questions as plain text and wait for the user's response
