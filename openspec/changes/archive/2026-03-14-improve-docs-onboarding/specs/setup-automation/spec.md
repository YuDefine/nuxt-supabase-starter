## ADDED Requirements

### Requirement: One-command setup script

The project SHALL provide a `scripts/setup.sh` script that automates the complete development environment setup from a fresh clone.

#### Scenario: Successful full setup

- **WHEN** a user runs `bash scripts/setup.sh` after cloning the repo
- **THEN** the script SHALL check all prerequisites (Node 20+, pnpm, Docker, Supabase CLI)
- **AND** run `pnpm install`
- **AND** copy `.env.example` to `.env` if `.env` does not exist
- **AND** start Supabase local development (`supabase start`)
- **AND** generate database types (`pnpm db:types`)
- **AND** display a success summary with next steps

#### Scenario: Missing prerequisite

- **WHEN** a required tool (Node, pnpm, Docker, or Supabase CLI) is not installed
- **THEN** the script SHALL display the missing tool name and installation instructions
- **AND** exit with code 1
- **AND** NOT proceed with partial setup

#### Scenario: Node version too old

- **WHEN** Node.js is installed but version is below 20
- **THEN** the script SHALL display the current version and required minimum
- **AND** exit with code 1

#### Scenario: Docker not running

- **WHEN** Docker is installed but the daemon is not running
- **THEN** the script SHALL display a message to start Docker
- **AND** exit with code 1

#### Scenario: Supabase already running

- **WHEN** Supabase local services are already running
- **THEN** the script SHALL skip `supabase start`
- **AND** continue with type generation

#### Scenario: .env already exists

- **WHEN** `.env` file already exists in the project root
- **THEN** the script SHALL NOT overwrite it
- **AND** display a message that existing `.env` is preserved

### Requirement: Package.json setup command

The project SHALL expose the setup script as a pnpm command.

#### Scenario: Running via pnpm

- **WHEN** a user runs `pnpm setup`
- **THEN** it SHALL execute `bash scripts/setup.sh`

### Requirement: README quick start update

The README.md SHALL include a "Quick Start" section that references the setup script.

#### Scenario: New user reads README

- **WHEN** a new user opens README.md
- **THEN** they SHALL find a quick start section within the first screenful
- **AND** it SHALL show three paths: CLI tool, clone + setup script, integration guide
- **AND** the clone path SHALL show `pnpm setup` as the single command
