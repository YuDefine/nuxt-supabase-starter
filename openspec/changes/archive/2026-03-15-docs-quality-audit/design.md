## Context

The project has 30+ markdown files across `README.md`, `CLAUDE.md`, `docs/`, and `docs/verify/`. An audit identified 34 issues in 3 severity tiers: 9 high (factual errors), 16 medium (inconsistency/duplication), 9 low (missing content). The root cause is organic growth — docs were written incrementally without cross-file consistency checks.

## Goals / Non-Goals

**Goals:**

- Every number, path, and package name in docs matches the actual codebase
- Each piece of information has exactly one authoritative source; other docs cross-reference it
- Terminology is consistent across all files
- Directory trees in README and CLAUDE.md reflect the real project structure

**Non-Goals:**

- Rewriting prose style or restructuring document hierarchy
- Adding new tutorial content beyond what's listed in the 34 issues
- Changing any application code (this is docs-only)

## Decisions

### Batch by file, not by issue type

Fix all issues in a single file together rather than fixing all "number" issues across files, then all "terminology" issues, etc. This minimizes re-reading files and avoids merge conflicts between tasks.

### Deduplication strategy: keep in the most specific file

When content is duplicated, keep the full version in the most specific/authoritative file and replace other occurrences with a one-line cross-reference. Authoritative sources:

| Content                | Authoritative file         | Others reference it                                                       |
| ---------------------- | -------------------------- | ------------------------------------------------------------------------- |
| Self-hosted deployment | `SELF_HOSTED_SUPABASE.md`  | SUPABASE_MIGRATION_GUIDE, ENVIRONMENT_VARIABLES                           |
| Role definitions       | `AUTH_INTEGRATION.md`      | API_DESIGN_GUIDE, RLS_BEST_PRACTICES                                      |
| Skills list/counts     | `CLAUDE_CODE_GUIDE.md`     | NEW_PROJECT_CHECKLIST, SKILL_UPDATE_GUIDE, CROSS_PROJECT_SKILLS_SYNC, FAQ |
| Auth setup             | `QUICK_START.md`           | INTEGRATION_GUIDE references it                                           |
| Spectra commands       | `OPENSPEC.md`              | CLAUDE_CODE_GUIDE, FAQ reference it                                       |
| Self-hosted env vars   | `ENVIRONMENT_VARIABLES.md` | SELF_HOSTED_SUPABASE references it                                        |

### Terminology standardization rules

| Term              | Standard form                                               | Usage                          |
| ----------------- | ----------------------------------------------------------- | ------------------------------ |
| Self-hosted       | **Self-hosted** (adjective), **自架** (Chinese)             | Never "Self-host" as adjective |
| service_role      | **service_role** (in SQL/code), **Service Role** (in prose) |                                |
| Skills categories | **通用 Skills** (general), **情境 Skills** (contextual)     | Never "通用技術 Skills"        |
| Migration action  | **套用** (Chinese), **apply** (English)                     | Never "應用" for migrations    |

### README numbers: use "this template provides" framing

Instead of claiming specific commit/API/migration counts that go stale, describe what the template includes structurally (e.g., "pre-configured CI/CD, auth, CRUD patterns") without absolute numbers.

## Risks / Trade-offs

- [Cross-reference fragility] Replacing duplicated content with links means readers must follow links → Mitigation: keep a brief summary (1 sentence) before the link so the reader gets context without clicking
- [Missed occurrences] Some terminology inconsistencies may be missed in this pass → Mitigation: use grep to verify each term is fully standardized before marking task complete
