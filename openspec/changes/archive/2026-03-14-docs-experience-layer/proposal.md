## Summary

Shift documentation from "read-heavy" to "experience-driven" by adding visual walkthrough, debugging guide, cost/time budget, and a concrete team collaboration scenario — targeting the jump from 8.2 to 9.0/10.

## Motivation

Four rounds of documentation improvements brought the repo from 6.5 to 8.2/10. The audit conclusion is clear:

> "This starter is documentation-heavy but experience-light. A newcomer can read how to do everything, but doesn't see themselves succeeding."

The remaining gap is not more docs — it's **confidence**. Newcomers need to:

1. **See success before they try** — a visual walkthrough showing the app in action
2. **Know what to do when things break** — a debugging guide beyond symptom-based troubleshooting
3. **Estimate time and cost** — clear budget expectations for development and production
4. **See team workflow in practice** — a real multi-person collaboration scenario, not just a checklist

These four changes are estimated to add +0.8 points, reaching 9.0/10.

## Proposed Solution

### 1. Visual Walkthrough Page (`app/pages/walkthrough.vue`)

A dedicated page in the app that shows the full user journey: home → login → create item → see list → profile. Uses static screenshots or step-by-step UI cards with descriptions. Also add a `docs/VISUAL_GUIDE.md` referencing it.

### 2. Debugging Guide (`docs/DEBUGGING.md`)

Hands-on guide covering: how to read Vitest output, how to debug a failing API endpoint, how to trace slow Supabase queries with `EXPLAIN ANALYZE`, how to use Vue DevTools for state inspection. Each section includes real terminal output examples.

### 3. Cost & Time Budget Section

Add a "費用與時間" section to README.md showing: development time (clone to running: 15 min), first feature time (FIRST_CRUD: 20 min), deployment time (30 min), monthly cost at different scales (free → $30/mo → $100+/mo).

### 4. Team Collaboration Scenario (`docs/TEAM_WORKFLOW.md`)

A practical scenario document: Dev A creates a bookmarks table on branch-a, Dev B creates a tags table on branch-b, they merge, migration conflict happens, resolution steps. Includes actual Git commands and Supabase CLI outputs.

## Capabilities

### New Capabilities

- `visual-walkthrough`: In-app walkthrough page and visual guide document showing the complete user journey
- `debugging-guide`: Hands-on debugging guide with real terminal output for Vitest, API, Supabase queries, and Vue DevTools
- `cost-time-budget`: Development and production cost/time expectations in README
- `team-collaboration-scenario`: Practical multi-person workflow scenario with conflict resolution

### Modified Capabilities

(none)

## Impact

- New files: `app/pages/walkthrough.vue`, `docs/VISUAL_GUIDE.md`, `docs/DEBUGGING.md`, `docs/TEAM_WORKFLOW.md`
- Modified files: `README.md` (add cost/time section), `docs/READING_GUIDE.md` (add new docs)
- No migration required
- No API changes
- No dependency changes
