## ADDED Requirements

### Requirement: Feature module registry

The system SHALL maintain a registry of all available feature modules, each with metadata for the CLI and template assembly.

#### Scenario: Module definition structure

- **WHEN** a feature module is registered
- **THEN** it SHALL declare:
  - `id`: unique kebab-case identifier
  - `name`: display name for CLI prompts
  - `description`: one-line description
  - `default`: whether it is selected by default
  - `dependencies`: array of other feature IDs that MUST be co-selected
  - `packages`: npm dependencies to add
  - `devPackages`: npm dev dependencies to add
  - `nuxtModules`: module names to register in `nuxt.config.ts`
  - `envVars`: environment variables with descriptions
  - `templateDir`: path to the overlay directory

#### Scenario: Listing all modules

- **WHEN** the CLI needs to present feature options
- **THEN** the registry SHALL return all modules grouped by prompt category
- **AND** each module SHALL include its default selection state

### Requirement: Authentication module (better-auth)

The system SHALL provide a feature module for Better Auth integration.

#### Scenario: Auth module selected

- **WHEN** the user selects the authentication feature
- **THEN** the scaffolded project SHALL include:
  - `app/auth.config.ts` (client-side auth config)
  - `server/auth.config.ts` (server-side auth config)
  - `app/pages/auth/login.vue`, `register.vue`, `forgot-password.vue`, `callback.vue`
  - `app/layouts/auth.vue`
  - `app/middleware/auth.global.ts`
  - `app/composables/useAuthError.ts`, `useUserRole.ts`
- **AND** add `better-auth` and `@onmax/nuxt-better-auth` to dependencies
- **AND** add `BETTER_AUTH_SECRET` to `.env.example`

### Requirement: Database module (Supabase)

The system SHALL provide a feature module for Supabase integration.

#### Scenario: Supabase module selected

- **WHEN** the user selects the database feature
- **THEN** the scaffolded project SHALL include:
  - `supabase/config.toml`
  - `supabase/migrations/` directory with initial profile migration
  - `supabase/seed.sql`
  - `server/utils/supabase.ts`
  - `server/utils/db-errors.ts`
  - `server/api/v1/profiles/` endpoint files
  - `shared/types/profiles.ts`, `shared/schemas/profiles.ts`
  - `app/types/database.types.ts`
- **AND** add `@supabase/supabase-js` and `@nuxtjs/supabase` to dependencies
- **AND** add `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SECRET_KEY` to `.env.example`

### Requirement: UI module (Nuxt UI)

The system SHALL provide a feature module for Nuxt UI.

#### Scenario: Nuxt UI module selected

- **WHEN** the user selects the UI framework feature
- **THEN** the scaffolded project SHALL include:
  - `app/app.config.ts` with theme configuration
  - `app/layouts/default.vue` with navigation and footer
  - Updated `app/app.vue` with `UApp` wrapper
- **AND** add `@nuxt/ui` and `tailwindcss` to dependencies

### Requirement: Testing module

The system SHALL provide a feature module for testing setup.

#### Scenario: Full testing selected (vitest + playwright)

- **WHEN** the user selects vitest+playwright testing
- **THEN** the scaffolded project SHALL include:
  - `vitest.config.ts`
  - `playwright.config.ts`
  - `test/unit/` directory with example test
  - `e2e/` directory with example E2E test
- **AND** add vitest, @vitest/coverage-v8, @playwright/test, @nuxt/test-utils to devDependencies
- **AND** add test scripts to `package.json`

#### Scenario: Vitest-only testing selected

- **WHEN** the user selects vitest-only testing
- **THEN** the scaffolded project SHALL include vitest setup only
- **AND** SHALL NOT include playwright configuration or e2e directory

### Requirement: Additional feature modules

The system SHALL provide feature modules for: charts (nuxt-charts), SEO (@nuxtjs/seo), security (nuxt-security), image optimization (@nuxt/image), state management (pinia + colada), monitoring (sentry + evlog), deployment (cloudflare / vercel / node), code quality (oxlint + oxfmt), and git hooks (husky + commitlint).

#### Scenario: Charts module selected

- **WHEN** the user selects the charts feature
- **THEN** `nuxt-charts` SHALL be added to dependencies
- **AND** the nuxt module SHALL be registered in config

#### Scenario: Deployment target selection

- **WHEN** the user selects cloudflare as deployment target
- **THEN** the `nitro.preset` SHALL be set to `cloudflare_module`
- **AND** `wrangler` SHALL be added to devDependencies

#### Scenario: Deployment target vercel

- **WHEN** the user selects vercel as deployment target
- **THEN** the `nitro.preset` SHALL be set to `vercel`
- **AND** a `vercel.json` SHALL be included in the project

#### Scenario: Code quality tools selected

- **WHEN** the user selects oxlint code quality tools
- **THEN** `.oxlintrc.json` and `.oxfmtrc.jsonc` SHALL be included
- **AND** oxlint and oxfmt SHALL be added to devDependencies
- **AND** lint and format scripts SHALL be added to `package.json`

#### Scenario: Git hooks selected

- **WHEN** the user selects husky + commitlint
- **THEN** `.husky/` directory with pre-commit hook SHALL be included
- **AND** `commitlint.config.js` SHALL be included
- **AND** husky, commitlint, and lint-staged SHALL be added to devDependencies
