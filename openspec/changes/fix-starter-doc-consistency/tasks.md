## 1. Remove duplicate skills from `.claude/skills/`

- [x] 1.1 Remove duplicates from `.claude/skills/` rather than `.agents/skills/` — delete 11 duplicate skill directories: `contributing`, `create-evlog-adapter`, `create-evlog-enricher`, `create-evlog-framework-integration`, `review-logging-patterns`, `supabase-postgres-best-practices`, `test-driven-development`, `vitepress`, `vitest`, `vue-best-practices`, `vueuse-functions` (no duplicate skills across skill directories)

## 2. Update `validate-starter.md` to reflect current command structure

- [x] 2.1 Replace all `opsx/` references with `spectra/` in `.claude/commands/validate-starter.md` (validation script references current command structure)
- [x] 2.2 Update the expected command list to match actual spectra/ commands: `analyze, apply, archive, ask, clarify, debug, discuss, ingest, propose, sync, tdd, verify` (documentation structural integrity)
- [x] 2.3 Use dynamic counting in validate-starter.md instead of hardcoding expected command names (dynamic counting per design decision)

## 3. Update `QUICK_START.md` skill counts

- [x] 3.1 Verified general skill count: 26 個 is correct (skills installed via `scripts/install-skills.sh` to `~/.claude/plugins/` and `.agents/skills/`) (skill counts in documentation match installed skills)
- [x] 3.2 Update contextual skill count from "5 個" to actual count in `.claude/skills/` (excluding spectra-\* skills) (skill counts in documentation match installed skills)

## 4. Update `CLAUDE_CODE_GUIDE.md` skills table and directory tree

- [x] 4.1 Update documentation to reflect actual state — restored 26 skills in table after confirming all install successfully via `scripts/install-skills.sh`; updated install location description from `.agents/skills/` to `scripts/install-skills.sh` (skills table accuracy in CLAUDE_CODE_GUIDE.md)
- [x] 4.2 Update `.claude/` directory tree: add `doc-sync.md` and `validate-starter.md` under `commands/`, replace `nuxt-better-auth/` with an actual existing skill directory under `skills/` (directory references in documentation match actual structure)
