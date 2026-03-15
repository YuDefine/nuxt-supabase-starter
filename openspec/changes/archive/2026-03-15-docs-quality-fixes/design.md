## Context

A documentation quality audit scored the project 8.5/10 across 31 markdown files. While the documentation is comprehensive, 10 specific issues were identified spanning content gaps, structural problems, FAQ omissions, and example inconsistencies. All changes are documentation-only — no application code, database, or API modifications.

Current state:

- `docs/TECH_STACK.md` ends abruptly at line 103 (truncated mid-section)
- `docs/WORKFLOW.md` has a numbering gap (Step 3 → Step 5)
- `docs/VISUAL_GUIDE.md` contains only 38 lines with no actual visual content
- `docs/FAQ.md` covers ~20 questions but misses 6 critical newcomer concerns
- Two internal planning files (`skill-replacement-plan.md`, `CROSS_PROJECT_SKILLS_SYNC.md`) sit in user-facing `docs/`
- Import path styles vary across example code in different docs
- Model naming in `CLAUDE_CODE_GUIDE.md` references outdated "Opus 4.5"

## Goals / Non-Goals

**Goals:**

- Fix all 10 issues identified in the audit without introducing regressions
- Improve newcomer onboarding experience
- Ensure documentation accuracy matches current codebase state
- Maintain the existing documentation architecture (L1 → L2 → L3 layering)

**Non-Goals:**

- Restructuring the entire docs/ directory hierarchy
- Adding automated doc testing or link checking CI
- Creating new docs beyond CHANGELOG.md
- Modifying any application code, tests, or configuration

## Decisions

### Batch editing strategy over incremental PRs

All 10 fixes are applied in a single change. Each file edit is independent — no cascading dependencies between doc fixes. This avoids review overhead of 10 separate PRs for typo-level changes.

### Archive internal files instead of deleting

Move `skill-replacement-plan.md` and `CROSS_PROJECT_SKILLS_SYNC.md` to `openspec/changes/archive/` rather than deleting. These contain historical context that may be useful for project archaeology.

### Standardize on alias imports in examples

All documentation examples shall use `~~/` alias paths (e.g., `~~/server/utils/supabase`) instead of relative paths (e.g., `../../../utils/api-response`). Rationale: alias paths are location-independent, match Nuxt conventions, and are easier to read.

### VISUAL_GUIDE.md enhancement with ASCII art

Use ASCII art diagrams rather than external image files. Rationale: ASCII art renders correctly in all Markdown viewers (GitHub, VitePress, terminal), requires no build step, and diffs cleanly in git.

### CHANGELOG.md scope

Start from v0.11.0 (current) with a retroactive summary of major milestones. Follow Keep a Changelog format. Future versions append to this file.

## Risks / Trade-offs

- [ASCII art may look poor on narrow screens] → Keep diagrams under 80 characters wide
- [CHANGELOG retroactive entries may be inaccurate] → Mark pre-v0.11.0 entries as approximate, derived from git history
- [Moving files may break external links] → The internal files have no inbound links from other docs (verified during audit)
