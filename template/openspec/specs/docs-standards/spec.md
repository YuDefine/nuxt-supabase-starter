# docs-standards Specification

## Purpose

TBD - created by archiving change 'docs-quality-fixes'. Update Purpose after archive.

## Requirements

### Requirement: Technology selection rationale completeness

TECH_STACK.md SHALL contain rationale sections for every non-obvious technology choice in the stack. Each rationale section SHALL include a comparison table with at least one alternative and specific reasons for the selection.

Required rationale sections:

- Better Auth vs Supabase Auth
- OXLint/OXFmt vs ESLint/Prettier
- Pinia Colada vs TanStack Query
- SSR disabled (SPA mode) rationale
- Cloudflare Workers vs Vercel/Netlify

#### Scenario: Developer asks why Better Auth instead of Supabase Auth

- **WHEN** a developer reads TECH_STACK.md
- **THEN** the file SHALL contain a comparison section explaining the selection of Better Auth over Supabase Auth with specific technical reasons

#### Scenario: Developer asks why SSR is disabled

- **WHEN** a developer searches for SSR configuration rationale
- **THEN** TECH_STACK.md SHALL contain a section explaining why `ssr: false` is set, including deployment target constraints and trade-offs

<!-- @trace
source: docs-quality-fixes
updated: 2026-03-15
code:
  - docs/WORKFLOW.md
  - docs/FIRST_CRUD.md
  - docs/CLAUDE_CODE_GUIDE.md
  - README.md
  - docs/skill-replacement-plan.md
  - .spectra/spectra.db
  - docs/VISUAL_GUIDE.md
  - CHANGELOG.md
  - docs/TECH_STACK.md
  - docs/CROSS_PROJECT_SKILLS_SYNC.md
  - docs/FAQ.md
-->

---

### Requirement: Architecture decision documentation in FAQ

FAQ.md SHALL answer common newcomer questions about architecture decisions. The FAQ SHALL contain entries for at minimum: SSR mode, linter choice, state management tool selection, Windows development support, feature removal guidance, and UI component library versioning.

#### Scenario: Developer on Windows wants to use the starter

- **WHEN** a developer searches FAQ.md for Windows support
- **THEN** the FAQ SHALL contain an entry explaining Windows compatibility, including WSL recommendation and known limitations

#### Scenario: Developer wants to remove unused features

- **WHEN** a developer wants to strip features they do not need
- **THEN** the FAQ SHALL contain guidance on which directories and config entries to remove for common scenarios (no Supabase, no auth, no AI tools)

<!-- @trace
source: docs-quality-fixes
updated: 2026-03-15
code:
  - docs/WORKFLOW.md
  - docs/FIRST_CRUD.md
  - docs/CLAUDE_CODE_GUIDE.md
  - README.md
  - docs/skill-replacement-plan.md
  - .spectra/spectra.db
  - docs/VISUAL_GUIDE.md
  - CHANGELOG.md
  - docs/TECH_STACK.md
  - docs/CROSS_PROJECT_SKILLS_SYNC.md
  - docs/FAQ.md
-->

---

### Requirement: Documentation structural integrity

All documentation files SHALL maintain correct sequential numbering in step-by-step guides. No numbered steps SHALL be skipped. Internal planning documents SHALL NOT appear in user-facing documentation directories.

#### Scenario: Step numbering in workflow guides

- **WHEN** a document contains numbered steps (Step 1, Step 2, etc.)
- **THEN** all step numbers SHALL be sequential with no gaps

#### Scenario: Internal planning files in docs directory

- **WHEN** the docs/ directory is listed
- **THEN** it SHALL NOT contain internal planning files, skill replacement plans, or cross-project sync documents that are not relevant to end users

<!-- @trace
source: docs-quality-fixes
updated: 2026-03-15
code:
  - docs/WORKFLOW.md
  - docs/FIRST_CRUD.md
  - docs/CLAUDE_CODE_GUIDE.md
  - README.md
  - docs/skill-replacement-plan.md
  - .spectra/spectra.db
  - docs/VISUAL_GUIDE.md
  - CHANGELOG.md
  - docs/TECH_STACK.md
  - docs/CROSS_PROJECT_SKILLS_SYNC.md
  - docs/FAQ.md
-->

---

### Requirement: Example code consistency

All code examples across documentation files SHALL use consistent import path styles. The standard style SHALL be Nuxt alias paths (`~~/`) for cross-boundary imports.

#### Scenario: Import paths in CRUD tutorial

- **WHEN** FIRST_CRUD.md contains server-side code examples
- **THEN** all imports SHALL use `~~/` alias paths, not relative paths like `../../../`

#### Scenario: Import paths match across documents

- **WHEN** the same utility is imported in examples across different documents (e.g., FIRST_CRUD.md and API_PATTERNS.md)
- **THEN** the import path style SHALL be identical

<!-- @trace
source: docs-quality-fixes
updated: 2026-03-15
code:
  - docs/WORKFLOW.md
  - docs/FIRST_CRUD.md
  - docs/CLAUDE_CODE_GUIDE.md
  - README.md
  - docs/skill-replacement-plan.md
  - .spectra/spectra.db
  - docs/VISUAL_GUIDE.md
  - CHANGELOG.md
  - docs/TECH_STACK.md
  - docs/CROSS_PROJECT_SKILLS_SYNC.md
  - docs/FAQ.md
-->

---

### Requirement: Visual guide content adequacy

VISUAL_GUIDE.md SHALL contain ASCII art diagrams covering at minimum: system architecture overview, data flow (client → server → database), and deployment topology. Each diagram SHALL be under 80 characters wide for terminal compatibility.

#### Scenario: Developer reads visual guide for architecture overview

- **WHEN** a developer opens VISUAL_GUIDE.md
- **THEN** the file SHALL contain at least 3 ASCII art diagrams showing architecture, data flow, and deployment topology

<!-- @trace
source: docs-quality-fixes
updated: 2026-03-15
code:
  - docs/WORKFLOW.md
  - docs/FIRST_CRUD.md
  - docs/CLAUDE_CODE_GUIDE.md
  - README.md
  - docs/skill-replacement-plan.md
  - .spectra/spectra.db
  - docs/VISUAL_GUIDE.md
  - CHANGELOG.md
  - docs/TECH_STACK.md
  - docs/CROSS_PROJECT_SKILLS_SYNC.md
  - docs/FAQ.md
-->

---

### Requirement: Version history availability

The project SHALL maintain a CHANGELOG.md file at the repository root following the Keep a Changelog format. The changelog SHALL document all releases from the earliest recoverable version through the current version.

#### Scenario: Developer checks what changed between versions

- **WHEN** a developer opens CHANGELOG.md
- **THEN** the file SHALL list version entries with dates and categorized changes (Added, Changed, Fixed, Removed)

<!-- @trace
source: docs-quality-fixes
updated: 2026-03-15
code:
  - docs/WORKFLOW.md
  - docs/FIRST_CRUD.md
  - docs/CLAUDE_CODE_GUIDE.md
  - README.md
  - docs/skill-replacement-plan.md
  - .spectra/spectra.db
  - docs/VISUAL_GUIDE.md
  - CHANGELOG.md
  - docs/TECH_STACK.md
  - docs/CROSS_PROJECT_SKILLS_SYNC.md
  - docs/FAQ.md
-->

---

### Requirement: README FAQ representativeness

README.md inline FAQ section SHALL contain at least 8 questions covering the most common newcomer concerns, with links to the full FAQ.md for complete coverage.

#### Scenario: Developer reads README FAQ

- **WHEN** a developer reads the FAQ section in README.md
- **THEN** it SHALL contain at least 8 questions AND a link directing to the full FAQ.md

<!-- @trace
source: docs-quality-fixes
updated: 2026-03-15
code:
  - docs/WORKFLOW.md
  - docs/FIRST_CRUD.md
  - docs/CLAUDE_CODE_GUIDE.md
  - README.md
  - docs/skill-replacement-plan.md
  - .spectra/spectra.db
  - docs/VISUAL_GUIDE.md
  - CHANGELOG.md
  - docs/TECH_STACK.md
  - docs/CROSS_PROJECT_SKILLS_SYNC.md
  - docs/FAQ.md
-->

---

### Requirement: Model and version reference accuracy

Documentation SHALL reference current model names and version numbers. Outdated model names or version references SHALL be updated within the same release cycle as the model update.

#### Scenario: Claude model reference in docs

- **WHEN** CLAUDE_CODE_GUIDE.md references a Claude model by name
- **THEN** the model name SHALL match the currently available model naming

<!-- @trace
source: docs-quality-fixes
updated: 2026-03-15
code:
  - docs/WORKFLOW.md
  - docs/FIRST_CRUD.md
  - docs/CLAUDE_CODE_GUIDE.md
  - README.md
  - docs/skill-replacement-plan.md
  - .spectra/spectra.db
  - docs/VISUAL_GUIDE.md
  - CHANGELOG.md
  - docs/TECH_STACK.md
  - docs/CROSS_PROJECT_SKILLS_SYNC.md
  - docs/FAQ.md
-->
