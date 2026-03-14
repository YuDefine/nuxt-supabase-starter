## ADDED Requirements

### Requirement: CLI reference documentation

The project SHALL provide a `docs/verify/CLI_SCAFFOLD.md` document describing the `create-nuxt-starter` CLI tool.

#### Scenario: Document structure

- **WHEN** a user reads `docs/verify/CLI_SCAFFOLD.md`
- **THEN** the document SHALL include:
  - Overview and installation (`npx create-nuxt-starter`)
  - Interactive mode usage
  - Non-interactive mode (`--yes` flag)
  - Complete feature modules table (id, name, default, dependencies)
  - Template structure explanation (base + feature overlays)
  - How to add a new feature module

#### Scenario: Feature modules table

- **WHEN** the document lists available features
- **THEN** it SHALL include a table with columns: Module, Description, Default, Dependencies
- **AND** the table SHALL match the actual `featureModules` array in `packages/create-nuxt-starter/src/features.ts`

### Requirement: Verify index references CLI docs

The `docs/verify/README.md` index SHALL include an entry for CLI_SCAFFOLD.md.

#### Scenario: Index table updated

- **WHEN** a user reads `docs/verify/README.md`
- **THEN** the reference table SHALL include a row for CLI Scaffold documentation

### Requirement: README references CLI tool

The root README.md SHALL mention the CLI tool as a project creation option.

#### Scenario: CLI mentioned in quick start

- **WHEN** a new user reads the README.md quick start section
- **THEN** the CLI tool SHALL be presented as one of the available paths
- **AND** the usage command (`npx create-nuxt-starter my-app`) SHALL be shown
