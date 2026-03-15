## 1. Content Completeness (P1)

- [x] 1.1 Complete TECH_STACK.md with technology selection rationale completeness — add comparison sections for: Better Auth vs Supabase Auth, OXLint vs ESLint, Pinia Colada vs TanStack Query, SSR disabled rationale, Cloudflare Workers vs alternatives
- [x] 1.2 Fix documentation structural integrity in WORKFLOW.md — correct step numbering gap (renumber Step 5 → Step 4 and subsequent steps)

## 2. Documentation Structure (P2)

- [x] 2.1 Archive internal files instead of deleting — move `docs/skill-replacement-plan.md` and `docs/CROSS_PROJECT_SKILLS_SYNC.md` to `openspec/changes/archive/`; remove any references to these files from docs/READING_GUIDE.md or other index files
- [x] 2.2 VISUAL_GUIDE.md enhancement with ASCII art — enhance visual guide content adequacy by adding diagrams to VISUAL_GUIDE.md: system architecture overview, data flow diagram (client → server → database), deployment topology; keep diagrams under 80 chars wide

## 3. FAQ Expansion (P3)

- [x] 3.1 Expand FAQ.md with architecture decision documentation in FAQ — add 6 missing entries: SSR disabled rationale, Windows development support, Pinia Colada vs Pinia difference, OXLint vs ESLint rationale, how to remove unused features, Nuxt UI v3 vs v4 differences
- [x] 3.2 Improve README FAQ representativeness — expand inline FAQ in README.md from 5 to 8+ questions, add link to full FAQ.md

## 4. Example Code Consistency (P4)

- [x] 4.1 Fix example code consistency in FIRST_CRUD.md — standardize on alias imports in examples, replace all relative import paths with `~~/` alias style (batch editing strategy over incremental prs)
- [x] 4.2 Verify example code consistency across API_PATTERNS.md and SUPABASE_GUIDE.md — audit and fix any remaining relative import paths to use standardized alias imports
- [x] 4.3 Update model and version reference accuracy in CLAUDE_CODE_GUIDE.md — replace "Opus 4.5" with current model naming

## 5. Version History (P5)

- [x] 5.1 Create CHANGELOG.md for version history availability — follow Keep a Changelog format, document v0.11.0 and retroactive milestones from git history (CHANGELOG.md scope per design)
