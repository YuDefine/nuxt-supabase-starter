## ADDED Requirements

### Requirement: Correct project statistics in README

README.md SHALL NOT contain absolute counts for commits, API endpoints, or migrations that diverge from the actual codebase. The project introduction SHALL describe structural capabilities (e.g., "pre-configured auth, CRUD patterns, CI/CD") rather than specific counts that become stale.

#### Scenario: README reflects actual project scope

- **WHEN** a reader views README.md project introduction
- **THEN** all numerical claims match the current codebase state
- **AND** no commit count, API endpoint count, or migration count is stated as a fixed number

### Requirement: Directory trees match actual codebase

Directory tree listings in README.md and CLAUDE.md SHALL include all top-level directories that exist in the repository, including `.spectra/`, `shared/`, `packages/`, `.agent/`, and `.agents/`.

#### Scenario: README directory tree is complete

- **WHEN** a reader views the project structure in README.md
- **THEN** every top-level directory present in the repository is listed
- **AND** no non-existent directory is listed

#### Scenario: CLAUDE.md project structure is complete

- **WHEN** Claude reads the Project Structure section in CLAUDE.md
- **THEN** it matches the actual directories in the repository

### Requirement: File paths reference existing locations

All file paths mentioned in documentation SHALL point to files or directories that actually exist in the codebase.

#### Scenario: AUTH_INTEGRATION auth route path is correct

- **WHEN** AUTH_INTEGRATION.md references the auth route directory
- **THEN** the path matches the actual location (`server/api/auth/`, not `server/routes/auth/`)

#### Scenario: API_DESIGN_GUIDE type definition path is correct

- **WHEN** API_DESIGN_GUIDE.md references type definition locations
- **THEN** the path points to a directory that exists in the codebase

#### Scenario: CLAUDE.md workflow path is correct

- **WHEN** CLAUDE.md references CI/CD workflow files
- **THEN** the path reflects the actual location (`docs/templates/.github/workflows/`)

### Requirement: No time-relative statements

Documentation SHALL NOT contain time-relative statements (e.g., "2.5 months of development") that become inaccurate as time passes.

#### Scenario: CLAUDE_CODE_GUIDE has no stale time references

- **WHEN** a reader views CLAUDE_CODE_GUIDE.md
- **THEN** no sentence references a specific duration of development time

#### Scenario: FAQ has no stale time references

- **WHEN** a reader views FAQ.md
- **THEN** no sentence references a specific duration of development time

### Requirement: Package names are current

All package names in documentation SHALL match the packages actually used in the project.

#### Scenario: verify/README.md uses correct auth package name

- **WHEN** verify/README.md mentions the auth package
- **THEN** it references `@onmax/nuxt-better-auth`, not `@nuxtjs/supabase`

### Requirement: Skills counts are accurate

All documents referencing skill counts SHALL state the correct numbers: 26 general, 5 contextual, 12 Spectra, 43 total.

#### Scenario: NEW_PROJECT_CHECKLIST skills count is correct

- **WHEN** NEW_PROJECT_CHECKLIST.md lists skills to verify
- **THEN** the count matches 26 general skills

#### Scenario: SKILL_UPDATE_GUIDE Antfu count is correct

- **WHEN** SKILL_UPDATE_GUIDE.md lists Antfu Skills
- **THEN** it states 8 skills (not 7)
