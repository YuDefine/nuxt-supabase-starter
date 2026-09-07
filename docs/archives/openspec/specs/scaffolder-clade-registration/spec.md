# scaffolder-clade-registration Specification

## Purpose

Define the ownership boundary and handoff contract between `create-nuxt-starter` and Clade consumer onboarding.

## Requirements

### Requirement: Use Clade's supported consumer initializer

The scaffolder SHALL initialize a generated project through the current Clade consumer initialization command.

#### Scenario: Current Clade checkout

- **GIVEN** a Clade checkout containing `scripts/init-consumer.ts`
- **WHEN** post-scaffold integration runs
- **THEN** the TypeScript initializer is invoked with the selected module configuration

#### Scenario: Older compatible checkout

- **GIVEN** a Clade checkout without the TypeScript initializer but containing `scripts/init-consumer.mjs`
- **WHEN** post-scaffold integration runs
- **THEN** the older initializer is used as a compatibility fallback

<!-- @trace
source: integrate-clade-project-bootstrap
updated: 2026-08-09
code:
  - template/packages/create-nuxt-starter/src/post-scaffold.ts
  - template/packages/create-nuxt-starter/test/post-scaffold.test.ts
-->

### Requirement: Register through the fleet source of truth

The scaffolder SHALL delegate central consumer registration to Clade and SHALL NOT append to `consumers.local`.

#### Scenario: Explicit repository identity

- **GIVEN** `--repo-id YuDefine/example`, `--dev-port 3120`, and an available Clade register command
- **WHEN** post-scaffold registration runs
- **THEN** it invokes `register-consumer.ts` with the project path, repository id, workflow model, activity, and development port

#### Scenario: Repository identity is absent

- **GIVEN** central registration is enabled but `--repo-id` is not provided
- **WHEN** post-scaffold registration runs
- **THEN** no central file is mutated
- **AND** the output names the exact Clade project-bootstrap continuation

<!-- @trace
source: integrate-clade-project-bootstrap
updated: 2026-08-09
code:
  - template/packages/create-nuxt-starter/src/cli.ts
  - template/packages/create-nuxt-starter/src/post-scaffold.ts
  - template/packages/create-nuxt-starter/test/post-scaffold.test.ts
-->

### Requirement: Preserve project paths as arguments

The scaffolder SHALL pass the consumer path as a process argument so paths containing whitespace do not corrupt registration data.

#### Scenario: Project path contains spaces

- **GIVEN** a generated project path containing spaces
- **WHEN** central registration runs
- **THEN** the complete path is delivered as one `--consumer` argument

<!-- @trace
source: integrate-clade-project-bootstrap
updated: 2026-08-09
code:
  - template/packages/create-nuxt-starter/src/post-scaffold.ts
  - template/packages/create-nuxt-starter/test/post-scaffold.test.ts
-->
