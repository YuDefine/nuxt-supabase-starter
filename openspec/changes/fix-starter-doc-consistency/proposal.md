## Why

The starter validation report (commit `1badbd7`) revealed 5 documentation consistency issues: `validate-starter.md` references obsolete `opsx/` directory and command names, `QUICK_START.md` reports incorrect skill counts (26 vs actual 15 general, 5 vs actual 16 contextual), 11 skills are duplicated across `.agents/skills/` and `.claude/skills/`, and `CLAUDE_CODE_GUIDE.md` lists 11 non-existent skills while its directory tree is incomplete.

## What Changes

- Update `validate-starter.md`: replace `opsx/` references with `spectra/`, fix expected command list to match actual (`analyze, apply, archive, ask, clarify, debug, discuss, ingest, propose, sync, tdd, verify`)
- Update `QUICK_START.md`: correct skill counts to match actual installed skills
- Remove 11 duplicate skills from `.claude/skills/` that already exist in `.agents/skills/`: `contributing, create-evlog-adapter, create-evlog-enricher, create-evlog-framework-integration, review-logging-patterns, supabase-postgres-best-practices, test-driven-development, vitepress, vitest, vue-best-practices, vueuse-functions`
- Update `CLAUDE_CODE_GUIDE.md`: remove 11 non-existent skills from the general skills table, fix directory tree to include `doc-sync.md` and `validate-starter.md`, remove `nuxt-better-auth/` from `.claude/skills/` tree

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `docs-standards`: Updating documentation accuracy requirements to ensure file listings, skill counts, and directory references match actual project state

## Impact

- Affected code:
  - `.claude/commands/validate-starter.md`
  - `docs/QUICK_START.md`
  - `docs/CLAUDE_CODE_GUIDE.md`
  - `.claude/skills/contributing/` (remove duplicate)
  - `.claude/skills/create-evlog-adapter/` (remove duplicate)
  - `.claude/skills/create-evlog-enricher/` (remove duplicate)
  - `.claude/skills/create-evlog-framework-integration/` (remove duplicate)
  - `.claude/skills/review-logging-patterns/` (remove duplicate)
  - `.claude/skills/supabase-postgres-best-practices/` (remove duplicate)
  - `.claude/skills/test-driven-development/` (remove duplicate)
  - `.claude/skills/vitepress/` (remove duplicate)
  - `.claude/skills/vitest/` (remove duplicate)
  - `.claude/skills/vue-best-practices/` (remove duplicate)
  - `.claude/skills/vueuse-functions/` (remove duplicate)
- No migration required
- No API changes
