## Why

A comprehensive documentation quality audit revealed 10 issues across 31 markdown files. While overall documentation quality is high (8.5/10), there are content gaps, structural problems, and inconsistencies that hurt the newcomer experience. Key issues include a truncated tech stack rationale, unexplained SSR architecture decision, missing FAQ entries, and internal planning files exposed in public docs.

## What Changes

- **Complete TECH_STACK.md**: Add missing technology selection rationale sections (Better Auth vs Supabase Auth, OXLint vs ESLint, Pinia Colada vs TanStack Query, SSR disabled reasoning)
- **Fix WORKFLOW.md numbering**: Correct step numbering gap (Step 3 → Step 5, missing Step 4)
- **Move internal files out of docs/**: Relocate `skill-replacement-plan.md` and `CROSS_PROJECT_SKILLS_SYNC.md` from `docs/` to `openspec/changes/archive/` (internal planning, not user-facing)
- **Enhance VISUAL_GUIDE.md**: Add ASCII architecture diagrams, data flow diagrams, and deployment topology to justify the "visual" name
- **Expand FAQ.md**: Add 6 missing common questions (SSR off, Windows support, Pinia Colada vs Pinia, OXLint vs ESLint, removing features, Nuxt UI versions)
- **Unify import paths in examples**: Standardize all doc examples to use `~~/` alias style instead of mixed relative/alias paths
- **Update model references**: Change "Opus 4.5" to current model naming in CLAUDE_CODE_GUIDE.md
- **Expand README.md FAQ**: Add 3 more inline FAQ entries to bridge the gap with the full FAQ.md
- **Add CHANGELOG.md**: Create version history starting from v0.11.0 with key milestones

## Capabilities

### New Capabilities

- `docs-standards`: Documentation quality standards, structure rules, and review checklist for maintaining consistency across all project documentation

### Modified Capabilities

(none — no existing specs to modify)

## Impact

- Affected code: No application code changes. Documentation only.
- Affected files:
  - `docs/TECH_STACK.md` (complete truncated content)
  - `docs/WORKFLOW.md` (fix numbering)
  - `docs/VISUAL_GUIDE.md` (add diagrams)
  - `docs/FAQ.md` (add 6 questions)
  - `docs/FIRST_CRUD.md` (fix import paths)
  - `docs/CLAUDE_CODE_GUIDE.md` (update model references)
  - `docs/API_PATTERNS.md` (standardize imports)
  - `docs/SUPABASE_GUIDE.md` (standardize imports)
  - `README.md` (expand FAQ section)
  - `CHANGELOG.md` (new file)
  - `docs/skill-replacement-plan.md` (move to archive)
  - `docs/CROSS_PROJECT_SKILLS_SYNC.md` (move to archive)
- No migration required
- No API changes
- No breaking changes
