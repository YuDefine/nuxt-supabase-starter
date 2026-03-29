## Why

The starter template lacks patterns that both production projects (TDMS and eHR-2.0) have independently converged on. New projects created from the starter must reinvent CI/CD pipelines, UI shell components, CRUD composables, and audit logging foundations every time. By extracting these proven, shared patterns back into the starter, new projects start closer to production-ready and avoid repeating the same bootstrapping work.

## What Changes

- **Auth dual-provider support**: The setup script offers a choice between `better-auth` and `nuxt-auth-utils`. Each option wires up its own config files, composables, middleware, and server auth utils. The starter ships both implementations; `setup.sh` activates one and removes the other.
- **CI/CD workflow templates**: Provide GitHub Actions templates in `docs/templates/.github/workflows/` covering lint → typecheck → test → migrate → deploy → notify stages. These are copyable templates, not active workflows in the starter itself.
- **UI shell components**: Add `AppPageShell`, `AppEmptyState`, and `AppFormLayout` as reusable page structure components that enforce consistent layout patterns.
- **CRUD composables**: Add `useListQueryState` (URL-synced list state with filters/search/page/sort) and `useModalForm` (generic create/edit modal pattern) — the two most commonly needed CRUD helpers.
- **Audit logging foundation**: Add an `audit_logs` migration template and server utility for creating audit trail entries on write operations.
- **Server middleware templates**: Provide rate-limiting and CSP-report middleware examples as opt-in templates.
- **VitePress documentation site**: Add VitePress as an optional feature in `setup.sh`, with a `docs/` site skeleton and `pnpm docs:dev` / `pnpm docs:build` scripts.

## Capabilities

### New Capabilities

- `auth-dual-provider`: Setup-time selection between better-auth and nuxt-auth-utils, with provider-specific config, composables, middleware, and server utils for each option
- `ci-cd-templates`: GitHub Actions workflow templates for CI (lint/typecheck/test), database migration, deployment (Cloudflare Workers), and notification (Discord webhook)
- `ui-shell-components`: Reusable page structure components — AppPageShell (page wrapper with header/breadcrumb/content slots), AppEmptyState (empty list placeholder with icon/message/action), AppFormLayout (form section wrapper with label/description/fields)
- `crud-composables`: useListQueryState (URL query string ↔ reactive list state sync for filters, search, pagination, sorting) and useModalForm (generic CRUD modal with open/close/create/edit lifecycle)
- `audit-logging`: audit_logs table migration template, server-side audit utility for logging entity changes, and RLS policies for admin read access
- `server-middleware`: Opt-in server middleware templates for rate limiting and CSP violation reporting
- `vitepress-docs`: VitePress documentation site skeleton with project docs structure, dev/build scripts, and setup.sh integration as optional feature

### Modified Capabilities

(none)

## Impact

- Affected code:
  - `scripts/setup.sh` — auth provider selection, VitePress feature toggle, new script entries
  - `scripts/templates/` — new template directory for auth variants and workflow files
  - `app/components/` — new AppPageShell, AppEmptyState, AppFormLayout components
  - `app/composables/` — new useListQueryState, useModalForm composables
  - `app/pages/` — demo page updates to showcase new components
  - `server/utils/` — audit logging utility
  - `server/middleware/` — rate-limit and CSP-report templates
  - `server/auth.config.ts` — may become template-based (auth provider dependent)
  - `supabase/migrations/` — audit_logs migration template
  - `docs/` — VitePress site skeleton
  - `docs/templates/.github/workflows/` — CI/CD workflow templates
  - `package.json` — VitePress dev dependency, docs scripts
  - `nuxt.config.ts` — conditional module registration based on auth choice
- Migration required: Yes (audit_logs table template)
- New dependencies: vitepress (optional dev dependency)
