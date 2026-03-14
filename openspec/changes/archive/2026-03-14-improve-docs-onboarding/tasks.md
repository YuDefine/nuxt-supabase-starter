## 1. P0 — Setup Script with Prerequisite Validation

- [x] 1.1 Create one-command setup script `scripts/setup.sh` — prerequisite checks (Node 20+, pnpm, Docker running, Supabase CLI), pnpm install, .env copy, supabase start, db:types, success summary
- [x] 1.2 Add package.json setup command (`pnpm setup` → `bash scripts/setup.sh`)
- [x] 1.3 Handle edge cases: Supabase already running (skip start), .env already exists (preserve), Docker not running (exit with message), Node version too old (exit with message)
- [x] 1.4 Test setup script on a fresh clone scenario

## 2. P0 — Tutorial as a Standalone Document

- [x] 2.1 Create end-to-end CRUD tutorial document `docs/FIRST_CRUD.md` — covering migration → RLS → API endpoint → Pinia store → Vue component → unit test using a simple "Bookmark" domain
- [x] 2.2 Ensure tutorial uses project conventions: `SET search_path = ''`, service_role bypass, useSupabaseClient, Composition API, named exports
- [x] 2.3 Add verification steps after each section ("You should see...")
- [x] 2.4 Add link from QUICK_START.md references tutorial as next step after setup

## 3. P0 — CLI Documentation in docs/verify/

- [x] 3.1 Create CLI reference documentation `docs/verify/CLI_SCAFFOLD.md` — overview, installation, interactive mode, non-interactive mode, feature modules table, template structure, adding new features
- [x] 3.2 Verify feature modules table matches actual `featureModules` array in `packages/create-nuxt-starter/src/features.ts`
- [x] 3.3 Update verify index references CLI docs — add CLI_SCAFFOLD.md row to `docs/verify/README.md` reference table

## 4. P1 — Troubleshooting Guide with Decision Trees

- [x] 4.1 Create systematic troubleshooting document `docs/TROUBLESHOOTING.md` — organized by symptom, each entry has Symptom → Possible Causes → Diagnostic Commands → Solution
- [x] 4.2 Cover top 10 error scenarios: supabase start fails, pnpm dev fails, type generation errors, OAuth callback errors, RLS policy denies access, migration deployment fails, pnpm install fails, CORS errors, auth session not persisting, Cloudflare build errors
- [x] 4.3 Include diagnostic commands for each scenario with expected output for both "problem found" and "no problem" states

## 5. P1 — README Quick Start Section

- [x] 5.1 Add README quick start update section with three paths: CLI tool (`npx create-nuxt-starter`), clone + `pnpm setup`, integration guide
- [x] 5.2 Ensure README references CLI tool as a project creation option with usage command shown

## 6. P1 — FAQ Cross-References and Expansion

- [x] 6.1 Update FAQ cross-references troubleshooting — add links from error-related FAQ entries to corresponding TROUBLESHOOTING.md sections
- [x] 6.2 Add new FAQ entries: setup failures, Docker issues, ARM compatibility, minimal config (email-only auth)

## 7. P2 — Demo Page Separation

- [x] 7.1 Implement demo page separation: move component showcase content from `app/pages/(home).vue` to `app/pages/demo.vue` — demo page preserves content identically
- [x] 7.2 Simplify home page — clean welcome message with navigation links to demo, auth, profile sections
