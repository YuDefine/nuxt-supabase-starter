## ADDED Requirements

### Requirement: Base template

The system SHALL maintain a base template that produces a minimal working Nuxt 4 + TypeScript project.

#### Scenario: Base-only scaffold

- **WHEN** the user selects no optional features
- **THEN** the generated project SHALL contain:
  - `nuxt.config.ts` with Nuxt 4 compatibility mode
  - `package.json` with nuxt and typescript dependencies
  - `tsconfig.json`
  - `app/app.vue` root component
  - `app/pages/index.vue` home page
  - `app/assets/css/main.css` with Tailwind entry
  - `.gitignore`
  - `.env.example`
- **AND** the project SHALL start successfully with `pnpm dev`

### Requirement: Feature overlay composition

The system SHALL compose the final project by layering feature overlays on top of the base template.

#### Scenario: Single feature overlay

- **WHEN** the user selects one feature (e.g., nuxt-ui)
- **THEN** the system SHALL copy the feature's template files into the project
- **AND** merge the feature's dependencies into `package.json`
- **AND** add the feature's modules to `nuxt.config.ts`

#### Scenario: Multiple feature overlays

- **WHEN** the user selects multiple features
- **THEN** the system SHALL apply overlays in dependency order
- **AND** later overlays SHALL overwrite conflicting files from earlier overlays

#### Scenario: Feature with environment variables

- **WHEN** a selected feature declares environment variables
- **THEN** the system SHALL append those variables to `.env.example` with descriptive comments

### Requirement: Package.json generation

The system SHALL generate a valid `package.json` by merging base and feature dependencies.

#### Scenario: Dependency merging

- **WHEN** base and features declare overlapping dependency keys
- **THEN** the feature version SHALL take precedence
- **AND** `dependencies` and `devDependencies` SHALL remain separate sections

#### Scenario: Scripts merging

- **WHEN** features add npm scripts
- **THEN** the scripts SHALL be merged into the base `package.json`
- **AND** feature scripts SHALL NOT overwrite base scripts with the same key

### Requirement: nuxt.config.ts generation

The system SHALL generate a `nuxt.config.ts` that includes only the modules and configuration for selected features.

#### Scenario: Config with selected modules

- **WHEN** features are selected
- **THEN** the generated `nuxt.config.ts` SHALL include only the Nuxt modules for selected features
- **AND** include feature-specific configuration blocks
- **AND** the config SHALL be valid TypeScript
