## Context

Third polish round targeting 3 specific issues from the 8.1/10 audit: FAQ blind spots, DEPLOYMENT.md ambiguity, and setup.sh missing guidance. Also trims README from 250 to under 200 lines by moving "核心概念" and "開發工作流程" to existing guides.

## Goals / Non-Goals

**Goals:**

- FAQ answers the top questions for team adoption decisions (performance, cost, scaling)
- DEPLOYMENT.md has zero ambiguity for first-time deployers
- setup.sh proactively tells users which .env values to fill
- README under 200 lines — pure entry point, no advanced content

**Non-Goals:**

- Adding new documentation files
- Restructuring docs/ directory hierarchy
- Adding video or interactive content

## Decisions

### FAQ organized by decision domain

Add 9 new FAQ entries in 3 new categories: "效能與規模" (3), "費用與方案" (3), "團隊協作" (3). Each answer is 3-5 lines with a link to the detailed reference doc.

### Setup script .env audit

After copying `.env.example`, parse the `.env` file and list keys that are empty or still contain placeholder values. Display as a warning list with descriptions.

### README advanced sections moved to existing docs

Move "核心概念" content to `docs/WORKFLOW.md` (already covers workflow topics). Move "開發工作流程" to `docs/WORKFLOW.md` as well (natural fit). Replace both sections in README with a one-liner + link.

### DEPLOYMENT.md smoke test clarification

Add explicit format example for `DEPLOY_URL`: `https://my-app.your-domain.com` (with protocol, no trailing slash). Add it to the GitHub Variables table with format notes.

## Risks / Trade-offs

- **[README too short]** → Under 200 lines might feel sparse. Mitigation: every section has a "📖 see more" link.
