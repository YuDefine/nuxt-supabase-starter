## ADDED Requirements

### Requirement: Auth provider selection at setup time

The setup script SHALL present a choice between `better-auth` and `nuxt-auth-utils` as the authentication provider. The selection MUST be made before dependency installation. The system SHALL install only the selected provider's dependencies and configuration files.

#### Scenario: User selects better-auth

- **WHEN** user runs `pnpm setup` and selects "Better Auth" as the auth provider
- **THEN** the system copies better-auth template files into the project
- **AND** the `.env` template includes `BETTER_AUTH_SECRET`
- **AND** `package.json` includes `better-auth` and `@onmax/nuxt-better-auth` dependencies
- **AND** `nuxt.config.ts` registers the `@onmax/nuxt-better-auth` module
- **AND** no nuxt-auth-utils files or dependencies remain in the project

#### Scenario: User selects nuxt-auth-utils

- **WHEN** user runs `pnpm setup` and selects "nuxt-auth-utils" as the auth provider
- **THEN** the system copies nuxt-auth-utils template files into the project
- **AND** the `.env` template does NOT include `BETTER_AUTH_SECRET`
- **AND** `package.json` includes `nuxt-auth-utils` dependency
- **AND** `nuxt.config.ts` registers the `nuxt-auth-utils` module
- **AND** no better-auth files or dependencies remain in the project

### Requirement: Each auth variant provides complete implementation

Each auth provider template SHALL include a complete, working authentication flow: login page, session middleware, server-side auth utilities, and OAuth callback handling. The implementations MUST be functionally equivalent from the user's perspective.

#### Scenario: better-auth variant completeness

- **WHEN** the better-auth variant is selected
- **THEN** the project contains `server/auth.config.ts` with Better Auth server configuration
- **AND** the project contains `app/auth.config.ts` with Better Auth client configuration
- **AND** the project contains `app/middleware/auth.global.ts` using Better Auth session
- **AND** the project contains `app/pages/auth/login.vue` and `app/pages/auth/register.vue`
- **AND** `server/utils/api-response.ts` provides `requireAuth()` using Better Auth

#### Scenario: nuxt-auth-utils variant completeness

- **WHEN** the nuxt-auth-utils variant is selected
- **THEN** the project contains `app/middleware/auth.global.ts` using `useUserSession()`
- **AND** the project contains `app/pages/auth/login.vue` with OAuth login
- **AND** `server/utils/api-response.ts` provides `requireAuth()` using `getUserSession()`
- **AND** no `server/auth.config.ts` or `app/auth.config.ts` files exist

### Requirement: Auth template files are isolated in scripts/templates

Auth variant files SHALL be stored in `scripts/templates/auth/better-auth/` and `scripts/templates/auth/nuxt-auth-utils/`. The setup script SHALL copy files from the selected variant directory into the appropriate project locations.

#### Scenario: Template directory structure

- **WHEN** examining the repository before setup
- **THEN** `scripts/templates/auth/better-auth/` contains all better-auth specific files
- **AND** `scripts/templates/auth/nuxt-auth-utils/` contains all nuxt-auth-utils specific files
- **AND** no auth-provider-specific code exists in `app/` or `server/` directories (only shared/neutral code)

### Requirement: Auth choice updates CLAUDE.md rules

After auth provider selection, the setup script SHALL update the project's `CLAUDE.md` auth instructions to reference the selected provider. This ensures AI assistants use the correct auth APIs.

#### Scenario: CLAUDE.md reflects auth choice

- **WHEN** setup completes with nuxt-auth-utils selected
- **THEN** `CLAUDE.md` auth section references `useUserSession()` and `getUserSession()`
- **AND** `CLAUDE.md` does NOT mention `better-auth` as the active auth system

#### Scenario: CLAUDE.md reflects better-auth choice

- **WHEN** setup completes with better-auth selected
- **THEN** `CLAUDE.md` auth section references `@onmax/nuxt-better-auth`
- **AND** `CLAUDE.md` does NOT mention `nuxt-auth-utils` as the active auth system
