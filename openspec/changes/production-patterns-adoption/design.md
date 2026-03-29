## Context

The nuxt-supabase-starter is a template that seeds new production projects (TDMS, eHR-2.0). Both production projects have independently converged on common patterns that the starter currently lacks. This change back-ports those proven patterns into the starter so new projects start with a stronger foundation.

Current state:

- Auth is hard-wired to better-auth only; eHR-2.0 and TDMS both migrated to nuxt-auth-utils
- No CI/CD workflow templates; every project builds them from scratch
- No reusable page shell components; every project re-creates AppPageShell/AppEmptyState/AppFormLayout
- No CRUD composables; useListQueryState and useModalForm are copy-pasted between projects
- No audit logging foundation
- No server middleware examples beyond auth
- VitePress is already a setup.sh option but has no skeleton files

## Goals / Non-Goals

**Goals:**

- Offer both better-auth and nuxt-auth-utils as first-class auth options at setup time
- Provide copy-ready CI/CD workflow templates that match production project patterns
- Ship reusable UI shell components (AppPageShell, AppEmptyState, AppFormLayout)
- Include useListQueryState and useModalForm as built-in composables
- Provide audit_logs migration template and server utility
- Include rate-limiting and CSP-report middleware as opt-in examples
- Create a VitePress docs site skeleton activated by setup.sh

**Non-Goals:**

- Building a permission system (too project-specific)
- Multi-layout support (admin/employee/kiosk — project-specific)
- Data export utilities (ExcelJS — feature-level, not infrastructure)
- LINE LIFF integration (project-specific)
- Replacing the existing better-auth implementation (it remains a valid choice)

## Decisions

### Auth dual-provider architecture

Both auth providers will ship as complete implementations in a `scripts/templates/auth/` directory. `setup.sh` presents a choice, then copies the selected provider's files into the project and removes the alternative.

**Provider file sets:**

| File             | better-auth variant                                           | nuxt-auth-utils variant                                            |
| ---------------- | ------------------------------------------------------------- | ------------------------------------------------------------------ |
| Server config    | `server/auth.config.ts`                                       | (none — configured in nuxt.config.ts)                              |
| Client config    | `app/auth.config.ts`                                          | (none)                                                             |
| Auth middleware  | `app/middleware/auth.global.ts`                               | `app/middleware/auth.global.ts`                                    |
| Server auth util | `server/utils/api-response.ts` (requireAuth using betterAuth) | `server/utils/api-response.ts` (requireAuth using nuxt-auth-utils) |
| Auth pages       | `app/pages/auth/login.vue`, `register.vue`, `callback.vue`    | `app/pages/auth/login.vue`, `callback.vue`                         |
| nuxt.config.ts   | includes `@onmax/nuxt-better-auth` module                     | includes `nuxt-auth-utils` module                                  |
| .env template    | `BETTER_AUTH_SECRET`                                          | (no extra env var — uses NUXT_SESSION_PASSWORD)                    |
| package.json     | `better-auth`, `@onmax/nuxt-better-auth`                      | `nuxt-auth-utils`                                                  |

**Why template files over runtime conditional:** Conditional code paths would add complexity to every auth-touching file. Template files keep each variant clean and self-contained. After setup, the project has zero unused auth code.

**Alternatives considered:**

- Nuxt module layer per auth provider — too complex for a starter, overkill for a one-time choice
- Runtime feature flag — would ship dead code and complicate tree-shaking

### CI/CD workflow templates as documentation

Workflow files live in `docs/templates/.github/workflows/`, not in `.github/workflows/`. The starter itself does not need CI/CD (it's a template, not a deployable app). Projects copy these templates and customize secrets/endpoints.

Three template files:

1. `ci.yml` — Format check → lint → typecheck → test
2. `deploy.yml` — CI → migrate → deploy (Cloudflare Workers) → notify (Discord)
3. `e2e.yml` — Triggered after CI, runs Playwright

**Why templates over active workflows:** The starter is cloned/forked; active workflows would trigger on the starter repo itself, which has no deployment target.

### UI shell components as first-class app components

Components live in `app/components/` (not a package or layer). They use Nuxt UI primitives and follow the flat component naming convention already established.

Three components:

1. **AppPageShell** — Page wrapper: breadcrumb + title + description + slots (actions, stats, subnav, toolbar, default)
2. **AppEmptyState** — Empty list placeholder: icon + message + optional description + optional action button
3. **AppFormLayout** — Form wrapper: optional header, sectioned or flat layout, two-column grid, aside panel, sticky action buttons

Component API mirrors eHR-2.0's proven implementations, adapted for the starter's simpler context (no permission system, no LIFF).

### CRUD composables use VueUse for URL sync

`useListQueryState` depends on `@vueuse/core` `watchDebounced` (already a project dependency via `@vueuse/nuxt`). This avoids a custom debounce implementation.

`useModalForm` is dependency-free — pure Vue reactivity.

Both composables are fully typed with generics.

### Audit logging as a migration template

The audit_logs migration is placed in `scripts/templates/migrations/` (not directly in `supabase/migrations/`). This avoids creating a migration in the starter's migration timeline that may conflict with project-specific migrations.

The `setup.sh` script does NOT auto-apply this migration. Instead, docs guide users to run `supabase migration new audit_logs` and paste the template content. This respects the "migrations via CLI only" rule.

Server utility `server/utils/audit.ts` provides a `createAuditLog()` helper that uses the service role client.

### Server middleware as opt-in templates

Middleware files live in `scripts/templates/server/middleware/`:

1. `rate-limiter.ts` — IP-based rate limiting using Nitro unstorage (configurable path, window, max requests)
2. `csp-report-only.ts` — Development-only CSP headers (production uses nuxt-security)

These are NOT auto-installed. Documentation explains when and how to copy them into `server/middleware/`.

**Why templates over active middleware:** Rate limiting configuration is project-specific. CSP report-only is dev-only and may conflict with nuxt-security in production.

### VitePress documentation site

VitePress is already listed as a setup.sh feature option. This change adds the actual skeleton:

- `docs/.vitepress/config.ts` — Site config with sidebar and nav
- `docs/index.md` — Landing page
- `docs/guide/getting-started.md` — Quick start
- `docs/guide/auth.md` — Auth guide
- `docs/guide/database.md` — Database guide
- `package.json` scripts: `docs:dev`, `docs:build`, `docs:preview`

VitePress is a devDependency, already in package.json. The skeleton provides a starting point that projects customize.

## Risks / Trade-offs

- [Auth template maintenance] Two complete auth implementations double the maintenance surface → Mitigation: Both implementations are small (~5 files each); the starter is versioned and tested
- [Template drift] `docs/templates/` files may drift from actual best practices → Mitigation: Validate templates are consistent with TDMS/eHR-2.0 patterns; include version comments
- [Setup complexity] More choices in setup.sh increases decision fatigue → Mitigation: Auth choice is the only new mandatory decision; all other additions are either always-on (components, composables) or already optional (VitePress, middleware)
- [Migration template confusion] Users may expect audit_logs to auto-apply → Mitigation: Clear docs explaining the template approach; setup.sh mentions it

## Open Questions

(none — all decisions are informed by two production project reference implementations)
