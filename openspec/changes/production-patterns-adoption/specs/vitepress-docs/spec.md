## ADDED Requirements

### Requirement: VitePress documentation site skeleton

The system SHALL provide a VitePress documentation site skeleton in the `docs/` directory that is activated when the user selects the VitePress option during setup.

#### Scenario: VitePress skeleton structure

- **WHEN** the VitePress feature is enabled during setup
- **THEN** the `docs/` directory contains `.vitepress/config.ts` with site configuration
- **AND** `docs/index.md` exists as the landing page
- **AND** `docs/guide/getting-started.md` exists as the quick start guide
- **AND** `docs/guide/auth.md` exists as the auth documentation
- **AND** `docs/guide/database.md` exists as the database documentation

### Requirement: VitePress scripts in package.json

The system SHALL include VitePress-related scripts in `package.json` that work when VitePress is installed.

#### Scenario: Documentation development server

- **WHEN** the user runs `pnpm docs:dev`
- **THEN** VitePress starts a local development server for the docs site

#### Scenario: Documentation build

- **WHEN** the user runs `pnpm docs:build`
- **THEN** VitePress builds the documentation site to `docs/.vitepress/dist/`

#### Scenario: Documentation preview

- **WHEN** the user runs `pnpm docs:preview`
- **THEN** VitePress serves the built documentation site for preview

### Requirement: VitePress config includes navigation

The VitePress configuration SHALL include a sidebar and top navigation that reflects the documentation structure.

#### Scenario: Sidebar navigation

- **WHEN** the documentation site renders
- **THEN** the sidebar shows a "Guide" section with links to getting-started, auth, and database pages
- **AND** the sidebar items are ordered logically (getting started first)

### Requirement: VitePress is an optional dependency

VitePress SHALL be listed as a devDependency in `package.json`. The setup script SHALL NOT remove VitePress when the feature is not selected — it remains available for later activation.

#### Scenario: VitePress available after setup without selection

- **WHEN** the user does not select VitePress during setup
- **THEN** `vitepress` remains in `devDependencies`
- **AND** the `docs/` skeleton files still exist
- **AND** the user can run `pnpm docs:dev` at any time
