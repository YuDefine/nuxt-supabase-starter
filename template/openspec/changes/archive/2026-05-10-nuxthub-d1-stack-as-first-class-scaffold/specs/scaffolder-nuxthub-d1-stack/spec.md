## ADDED Requirements

### Requirement: DB stack selection

The scaffolder SHALL model the database stack as a first-class selection named dbStack with exactly two values: supabase and nuxthub-d1. The default dbStack value SHALL be supabase for CLI and wizard flows unless another rule in this specification sets nuxthub-d1.

#### Scenario: Default scaffold keeps Supabase

- **WHEN** the scaffolder runs without an explicit database stack selection and without the nuxthub-ai evlog preset
- **THEN** the generated project SHALL keep the existing Supabase database layout
- **AND** the generated project SHALL NOT apply the db-nuxthub-d1 overlay

#### Scenario: Explicit NuxtHub D1 stack

- **WHEN** the scaffolder runs with dbStack set to nuxthub-d1
- **THEN** the generated project SHALL apply the db-nuxthub-d1 overlay
- **AND** the generated project SHALL contain NuxtHub D1 database files and scripts

### Requirement: nuxthub-ai preset implies NuxtHub D1

The scaffolder SHALL set dbStack to nuxthub-d1 when the selected evlog preset is nuxthub-ai. An explicit conflicting Supabase dbStack selection MUST fail before any project files are written.

#### Scenario: nuxthub-ai yes-mode scaffold

- **WHEN** the scaffolder runs in yes mode with evlog preset nuxthub-ai and no explicit dbStack value
- **THEN** dbStack SHALL resolve to nuxthub-d1
- **AND** the generated project SHALL contain NuxtHub D1 layout instead of Supabase database layout

#### Scenario: Conflicting explicit dbStack

- **WHEN** the scaffolder receives evlog preset nuxthub-ai and an explicit dbStack value of supabase
- **THEN** the scaffolder MUST stop with a validation error
- **AND** the target project directory MUST NOT contain partially generated files from the failed run

##### Example: CLI flag conflict

- **GIVEN** arguments: projectName=test-ai, evlogPreset=nuxthub-ai, dbStack=supabase, yes=true
- **WHEN** argument validation runs
- **THEN** validation fails with an error naming nuxthub-ai and supabase as an incompatible combination

### Requirement: Auth compatibility validation

The scaffolder SHALL reject dbStack nuxthub-d1 when the selected auth provider is nuxt-auth-utils. The nuxthub-d1 stack SHALL permit auth values better-auth and none.

#### Scenario: Better Auth with NuxtHub D1

- **WHEN** the selected auth provider is better-auth and dbStack is nuxthub-d1
- **THEN** the scaffolder SHALL continue validation
- **AND** the generated project SHALL include the better-auth D1 migration file

#### Scenario: No auth with NuxtHub D1

- **WHEN** the selected auth provider is none and dbStack is nuxthub-d1
- **THEN** the scaffolder SHALL continue validation
- **AND** the generated project SHALL include NuxtHub D1 evlog migration files without requiring an auth schema

#### Scenario: Nuxt Auth Utils with NuxtHub D1

- **WHEN** the selected auth provider is nuxt-auth-utils and dbStack is nuxthub-d1
- **THEN** the scaffolder MUST stop with a validation error
- **AND** the error SHALL identify the allowed auth values for nuxthub-d1

### Requirement: Manifest-driven overlay application

The db-nuxthub-d1 stack SHALL be applied through a manifest-driven overlay. The overlay manifest SHALL define compatibility constraints, files to add, files to remove, and package.json script and dependency deltas.

#### Scenario: Compatible overlay applies

- **WHEN** dbStack is nuxthub-d1 and the selected auth provider satisfies the overlay manifest requirements
- **THEN** the scaffolder SHALL copy every file declared by the manifest add list
- **AND** the scaffolder SHALL remove every generated Supabase file or directory declared by the manifest remove list
- **AND** the scaffolder SHALL apply every package_json delta declared by the manifest

#### Scenario: Incompatible overlay fails fast

- **WHEN** an overlay manifest declares an unmet requires constraint or a conflicts_with match
- **THEN** the scaffolder MUST fail before applying file add, file remove, or package.json deltas
- **AND** the failure message SHALL name the incompatible overlay and selection value

##### Example: auth requirement failure

- **GIVEN** overlay db-nuxthub-d1 requires auth values better-auth or none
- **AND** selections contain auth=nuxt-auth-utils and dbStack=nuxthub-d1
- **WHEN** validateOverlayCompatibility runs
- **THEN** validation fails before any overlay file operation starts

### Requirement: NuxtHub D1 generated project structure

A generated project with dbStack nuxthub-d1 SHALL use NuxtHub D1 database layout and SHALL NOT retain Supabase database layout.

#### Scenario: D1 layout is present

- **WHEN** a project is generated with dbStack nuxthub-d1
- **THEN** the generated project SHALL contain server/database/schema/index.ts
- **AND** the generated project SHALL contain server/database/migrations/0002_evlog_events.sql when evlog preset is not none
- **AND** the generated project SHALL contain a wrangler D1 binding template

#### Scenario: Supabase layout is removed

- **WHEN** a project is generated with dbStack nuxthub-d1
- **THEN** the generated project SHALL NOT contain server/db
- **AND** the generated project SHALL NOT contain Supabase database helper scripts removed by the overlay manifest
- **AND** the generated project package.json SHALL NOT contain Supabase database scripts removed by the overlay manifest

### Requirement: Prebuilt D1 migrations

The scaffolder SHALL ship prebuilt D1 migration SQL for NuxtHub D1 fresh scaffolds instead of running migration generation during scaffolding. The evlog migration SHALL create evlog_events with indexes needed by @evlog/nuxthub 2.16.x.

#### Scenario: evlog_events migration exists

- **WHEN** a project is generated with evlog preset nuxthub-ai
- **THEN** server/database/migrations/0002_evlog_events.sql SHALL exist
- **AND** the migration SHALL create the evlog_events table
- **AND** the migration SHALL create indexes for timestamp, level, service, status, request_id, and created_at

#### Scenario: Local D1 migration supports evlog query

- **WHEN** the generated NuxtHub D1 project installs dependencies and applies local D1 migrations
- **THEN** querying evlog_events for a row count SHALL NOT fail with a missing-table error

### Requirement: NuxtHub D1 package.json delta

A generated project with dbStack nuxthub-d1 SHALL receive NuxtHub D1 scripts and dependencies, and SHALL remove Supabase DB scripts and dependencies that are incompatible with the D1 stack.

#### Scenario: NuxtHub scripts are present

- **WHEN** a project is generated with dbStack nuxthub-d1
- **THEN** package.json SHALL contain hub:db:migrations:create
- **AND** package.json SHALL contain hub:db:migrations:apply
- **AND** package.json SHALL contain hub:db:studio

#### Scenario: Supabase scripts are absent

- **WHEN** a project is generated with dbStack nuxthub-d1
- **THEN** package.json SHALL NOT contain db:drizzle:pull
- **AND** package.json SHALL NOT contain Supabase database sync scripts removed by the overlay manifest

### Requirement: Scaffold audit coverage

The starter SHALL validate the new dbStack dimension through unit tests and fresh scaffold audit paths. The nuxthub-ai path SHALL verify NuxtHub D1 structure, migration presence, package_json delta, and evlog audit signals.

#### Scenario: nuxthub-ai audit path passes

- **WHEN** the nuxthub-ai fresh scaffold audit path runs
- **THEN** the audit SHALL report NuxtHub module installed
- **AND** the audit SHALL report drain pipeline wrapping enabled
- **AND** the audit SHALL report five enrichers installed
- **AND** the audit SHALL report zero blocked findings

##### Example: expected audit signals

| Signal                  | Expected Output |
| ----------------------- | --------------- |
| nuxthub.moduleInstalled | 1               |
| drain.pipelineWraps     | 1               |
| enrichers.installed     | 5               |
| blocked                 | 0               |

#### Scenario: Existing evlog preset paths do not regress

- **WHEN** fresh scaffold audit paths run for baseline, d-pattern-audit, nuxthub-ai, and none
- **THEN** each path SHALL satisfy its expected audit signals
- **AND** the baseline, d-pattern-audit, and none paths SHALL keep their existing Supabase default behavior unless dbStack is explicitly nuxthub-d1
