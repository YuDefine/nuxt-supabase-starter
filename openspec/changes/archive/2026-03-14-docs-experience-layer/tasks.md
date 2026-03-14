## 1. Walkthrough as an In-App Page

- [x] 1.1 Create `app/pages/walkthrough.vue` — in-app walkthrough page with step-by-step cards showing home, auth, CRUD, profile, and admin features; each step uses live Nuxt UI components with title, description, and link
- [x] 1.2 Create visual guide document `docs/VISUAL_GUIDE.md` — explains the app's user journey, links to `/walkthrough` as live demo and to FIRST_CRUD.md as hands-on next step

## 2. Debugging Guide with Real Output

- [x] 2.1 Create hands-on debugging guide `docs/DEBUGGING.md` — 4 sections: reading Vitest failure output, debugging failing API endpoints, analyzing slow Supabase queries with EXPLAIN ANALYZE, using Vue DevTools for state inspection
- [x] 2.2 Include real terminal output examples with annotations explaining what each line means in each debugging section

## 3. Cost and Time Budget in README

- [x] 3.1 Add cost and time budget in README — time estimates (clone 15min, first feature 20min, deploy 30min) and monthly cost at 3 scales (free, ~$30/mo, ~$100+/mo)

## 4. Team Workflow as Scenario Document

- [x] 4.1 Create practical team workflow scenario `docs/TEAM_WORKFLOW.md` — two-developer conflict resolution narrative (Dev A + Dev B create migrations on separate branches, merge, resolve conflict) with exact Git and Supabase CLI commands and expected output
- [x] 4.2 Include PR workflow: create PR with migration, CI checks, review SQL, handle CI failure
- [x] 4.3 Update READING_GUIDE updated with new docs — add VISUAL_GUIDE.md, DEBUGGING.md, TEAM_WORKFLOW.md to appropriate tiers
