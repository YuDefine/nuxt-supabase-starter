## MODIFIED Requirements

### Requirement: Documentation structural integrity

All documentation files SHALL maintain correct sequential numbering in step-by-step guides. No numbered steps SHALL be skipped. Internal planning documents SHALL NOT appear in user-facing documentation directories. Directory tree diagrams, file listings, and capability counts in documentation SHALL match the actual project state. Validation scripts SHALL use the current directory and command names.

#### Scenario: Step numbering in workflow guides

- **WHEN** a document contains numbered steps (Step 1, Step 2, etc.)
- **THEN** all step numbers SHALL be sequential with no gaps

#### Scenario: Internal planning files in docs directory

- **WHEN** the docs/ directory is listed
- **THEN** it SHALL NOT contain internal planning files, skill replacement plans, or cross-project sync documents that are not relevant to end users

#### Scenario: Directory references in documentation match actual structure

- **WHEN** a documentation file references a directory path (e.g., `commands/spectra/`)
- **THEN** that directory SHALL exist in the actual project structure

#### Scenario: Skill counts in documentation match installed skills

- **WHEN** QUICK_START.md or CLAUDE_CODE_GUIDE.md states a count of installed skills
- **THEN** the stated count SHALL match the actual number of skill directories in the corresponding location (`.agents/skills/` for general skills, `.claude/skills/` for contextual skills)

#### Scenario: Validation script references current command structure

- **WHEN** validate-starter.md checks for command files
- **THEN** it SHALL reference `commands/spectra/` (not `commands/opsx/`) and SHALL list only commands that actually exist

#### Scenario: No duplicate skills across skill directories

- **WHEN** skills are listed in both `.agents/skills/` and `.claude/skills/`
- **THEN** each skill SHALL exist in exactly one location: third-party skills in `.agents/skills/`, project-specific skills in `.claude/skills/`

## ADDED Requirements

### Requirement: Skills table accuracy in CLAUDE_CODE_GUIDE.md

The general skills table in CLAUDE_CODE_GUIDE.md SHALL list only skills that are actually installed in `.agents/skills/`. The directory tree example in the `.claude/` structure section SHALL list only directories that exist in `.claude/skills/`.

#### Scenario: Developer reads general skills table

- **WHEN** a developer reads the general skills table in CLAUDE_CODE_GUIDE.md
- **THEN** every skill listed in the table SHALL have a corresponding directory in `.agents/skills/`

#### Scenario: Developer reads .claude/ directory tree

- **WHEN** a developer reads the `.claude/` directory tree in CLAUDE_CODE_GUIDE.md
- **THEN** every skill directory shown under `skills/` SHALL exist in `.claude/skills/`
- **AND** all command files shown under `commands/` SHALL exist in `.claude/commands/`
