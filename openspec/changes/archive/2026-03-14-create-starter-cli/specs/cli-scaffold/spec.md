## ADDED Requirements

### Requirement: CLI entry point

The CLI SHALL be invocable via `npx create-nuxt-starter <project-name>` or `pnpm create nuxt-starter <project-name>`. The CLI SHALL accept an optional project name as a positional argument.

#### Scenario: Invocation with project name

- **WHEN** user runs `npx create-nuxt-starter my-app`
- **THEN** the CLI SHALL use `my-app` as the project directory name
- **AND** skip the project name prompt

#### Scenario: Invocation without project name

- **WHEN** user runs `npx create-nuxt-starter` without arguments
- **THEN** the CLI SHALL prompt the user for a project name
- **AND** default to `nuxt-app`

#### Scenario: Directory already exists and is not empty

- **WHEN** user specifies a project name that maps to an existing non-empty directory
- **THEN** the CLI SHALL display an error message and exit with code 1
- **AND** NOT overwrite or modify the existing directory

### Requirement: Interactive feature selection

The CLI SHALL present an interactive prompt flow allowing the user to select which features to include in the scaffolded project.

#### Scenario: Full interactive flow

- **WHEN** the CLI starts in interactive mode
- **THEN** the CLI SHALL prompt in this order:
  1. Project name (if not provided as argument)
  2. Authentication system (single select: better-auth / none)
  3. Database (single select: supabase / none)
  4. UI framework (single select: nuxt-ui / none)
  5. Additional features (multiselect: charts, SEO, security, image optimization)
  6. State management (single select: pinia / none)
  7. Testing (single select: vitest+playwright / vitest-only / none)
  8. Monitoring (single select: sentry+evlog / none)
  9. Deployment target (single select: cloudflare / vercel / node)
  10. Code quality tools (single select: oxlint / none)
  11. Git hooks (single select: husky+commitlint / none)
- **AND** each prompt SHALL display the default selection

#### Scenario: Feature dependency enforcement

- **WHEN** user selects authentication (better-auth)
- **AND** does NOT select a database
- **THEN** the CLI SHALL automatically enable the database (supabase) selection
- **AND** inform the user that authentication requires a database

#### Scenario: Confirmation before scaffold

- **WHEN** all prompts are answered
- **THEN** the CLI SHALL display a summary of selected features
- **AND** ask for confirmation before proceeding

### Requirement: Post-scaffold setup

After files are assembled, the CLI SHALL perform automated setup steps.

#### Scenario: Successful post-scaffold

- **WHEN** the project files are assembled
- **THEN** the CLI SHALL install dependencies using the detected package manager
- **AND** initialize a git repository with an initial commit
- **AND** display next steps including environment variable setup instructions

#### Scenario: Dependency installation failure

- **WHEN** dependency installation fails
- **THEN** the CLI SHALL display the error
- **AND** inform the user to run the install command manually
- **AND** still display the next steps
- **AND** exit with code 0 (non-fatal)

### Requirement: Non-interactive mode

The CLI SHALL support a `--yes` flag for CI/scripting use cases.

#### Scenario: Non-interactive with defaults

- **WHEN** user runs with `--yes` flag
- **THEN** the CLI SHALL use default selections for all features
- **AND** skip all interactive prompts
- **AND** proceed directly to scaffolding
