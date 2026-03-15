## Why

Project documentation across 30+ markdown files has accumulated 34 quality issues spanning incorrect numbers, outdated information, content duplication, inconsistent terminology, and missing sections. These issues erode trust in the docs and cause confusion for new contributors. A systematic audit-and-fix pass is needed to restore accuracy and consistency.

## What Changes

- Fix factual errors: incorrect commit/API/migration counts in README, wrong file paths in AUTH_INTEGRATION and API_DESIGN_GUIDE, outdated package names
- Remove outdated statements: time-relative claims ("2.5 months"), stale workflow paths
- Eliminate content duplication: consolidate repeated sections (Self-hosted deployment, role definitions, auth setup, skills lists, Spectra command tables) into single sources with cross-references
- Standardize terminology: unify Self-hosted/Self-host/自架, service_role/Service Role, Skills category naming, migration action verbs
- Update stale numbers: Skills counts in NEW_PROJECT_CHECKLIST, SKILL_UPDATE_GUIDE, CROSS_PROJECT_SKILLS_SYNC
- Align directory trees in README and CLAUDE.md with actual codebase structure
- Fix RLS examples to include required service_role bypass per CLAUDE.md rules
- Add missing content: deployment checklist, common errors after setup, engines field in package.json

## Capabilities

### New Capabilities

- `docs-accuracy`: Fixes for factual errors, outdated numbers, wrong file paths, and stale time-relative statements across all markdown files
- `docs-deduplication`: Consolidation of duplicated content into single sources with cross-references, covering Self-hosted deployment, role definitions, auth setup, skills lists, and Spectra commands
- `docs-terminology`: Standardization of inconsistent terms (Self-hosted, service_role, Skills naming, migration verbs) across all documentation
- `docs-completeness`: Addition of missing sections (deployment checklist, common errors, engines field) and alignment of directory trees with actual codebase

### Modified Capabilities

(none — no existing specs)

## Impact

- Affected files (30+):
  - Root: `README.md`, `CLAUDE.md`, `package.json`
  - `docs/`: CLAUDE_CODE_GUIDE, FAQ, QUICK_START, DEPLOYMENT, TECH_STACK, READING_GUIDE, CROSS_PROJECT_SKILLS_SYNC, SKILL_UPDATE_GUIDE, NEW_PROJECT_CHECKLIST, API_PATTERNS, INTEGRATION_GUIDE, OPENSPEC, TROUBLESHOOTING, CLI_SCAFFOLD
  - `docs/verify/`: README, AUTH_INTEGRATION, SUPABASE_MIGRATION_GUIDE, SELF_HOSTED_SUPABASE, RLS_BEST_PRACTICES, API_DESIGN_GUIDE, PINIA_ARCHITECTURE, ENVIRONMENT_VARIABLES, DATABASE_OPTIMIZATION
- No migration required
- No API changes
- No code changes (documentation only)
