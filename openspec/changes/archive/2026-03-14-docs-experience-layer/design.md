## Context

After 4 rounds the repo scores 8.2/10. The remaining gap is experiential: newcomers can read everything but don't feel confident until they've built something. The audit explicitly stated the fix is "make them feel success in the first 30 minutes."

## Goals / Non-Goals

**Goals:**

- Newcomer sees what the finished app looks like before writing code
- Newcomer knows exactly how to debug a failing test or slow query
- Newcomer can estimate time and money before committing to this stack
- Teams see a concrete conflict resolution workflow, not just rules

**Non-Goals:**

- Video production or screen recording
- Interactive tutorials or gamification
- Rewriting existing docs

## Decisions

### Walkthrough as an in-app page

Create `app/pages/walkthrough.vue` — a step-by-step visual guide showing the app's key features with descriptive cards. This is better than screenshots in markdown because it uses the actual UI components, stays in sync with the codebase, and newcomers can see it live at `/walkthrough`.

Complement with `docs/VISUAL_GUIDE.md` that explains the walkthrough and links to it.

**Alternative**: Screenshot-based markdown doc — rejected because screenshots go stale and can't show interactivity.

### Debugging guide with real output

Create `docs/DEBUGGING.md` with 4 sections, each showing real terminal output that newcomers will actually see. Use fenced code blocks with annotations explaining what each line means.

Sections: Vitest failures, API endpoint debugging, Supabase query analysis, Vue DevTools state.

### Cost and time budget in README

Add a compact table to README showing time-to-value and monthly costs at 3 scales. This belongs in README (not a separate doc) because it's a decision-making input that newcomers need before cloning.

### Team workflow as scenario document

Create `docs/TEAM_WORKFLOW.md` as a narrative scenario (Dev A + Dev B), not a reference doc. Include actual Git commands, `supabase migration list` output, and conflict resolution steps. This is more effective than the FAQ checklist because it shows the complete flow.

## Risks / Trade-offs

- **[Walkthrough maintenance]** → Page uses actual Nuxt UI components, so it stays in sync. Risk is low.
- **[Debugging output staleness]** → Terminal output examples may differ across versions. Mitigation: use stable command output patterns, add "output may vary" notes.
