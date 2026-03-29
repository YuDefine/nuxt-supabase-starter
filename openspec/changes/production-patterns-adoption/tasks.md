## 1. Auth Dual-Provider Architecture

- [x] 1.1 Create `scripts/templates/auth/better-auth/` directory — auth template files are isolated in scripts/templates: `server/auth.config.ts`, `app/auth.config.ts`, `app/middleware/auth.global.ts`, `server/utils/api-response.ts`, `app/pages/auth/login.vue`, `app/pages/auth/register.vue`, `app/pages/auth/callback.vue`
- [x] 1.2 Create `scripts/templates/auth/nuxt-auth-utils/` directory — each auth variant provides complete implementation: `app/middleware/auth.global.ts`, `server/utils/api-response.ts`, `app/pages/auth/login.vue`, `app/pages/auth/callback.vue`
- [x] 1.3 Update `scripts/setup.sh` to add auth provider selection at setup time — present a choice between better-auth and nuxt-auth-utils, copy selected variant files, update package.json and nuxt.config.ts accordingly
- [x] 1.4 Implement auth choice updates CLAUDE.md rules — setup.sh patches CLAUDE.md auth section to reference the selected provider
- [x] 1.5 Write unit tests for auth template file copying logic (verify correct files exist/absent per selection)

## 2. CI/CD Workflow Templates as Documentation

- [x] 2.1 Create CI workflow template at `docs/templates/.github/workflows/ci.yml` (format → lint → typecheck → test)
- [x] 2.2 Create deploy workflow template at `docs/templates/.github/workflows/deploy.yml` (CI → migrate → deploy → notify with Discord webhook)
- [x] 2.3 Create E2E workflow template at `docs/templates/.github/workflows/e2e.yml` (Playwright after CI)
- [x] 2.4 Verify deploy workflow templates in docs/templates do not trigger on starter repo — ensure files are NOT in `.github/workflows/`

## 3. UI Shell Components as First-Class App Components

- [x] 3.1 Create AppPageShell component in `app/components/AppPageShell.vue` with breadcrumb, title, description, and named slots (actions, stats, subnav, toolbar)
- [x] 3.2 Create AppEmptyState component in `app/components/AppEmptyState.vue` with icon, message, description, and action button support
- [x] 3.3 Create AppFormLayout component in `app/components/AppFormLayout.vue` with sections, two-column grid, aside panel, and sticky action buttons
- [x] 3.4 Write unit tests for AppPageShell, AppEmptyState, and AppFormLayout components
- [x] 3.5 Update demo page to showcase all three UI shell components

## 4. CRUD Composables Use VueUse for URL Sync

- [x] 4.1 Create useListQueryState composable in `app/composables/useListQueryState.ts` with filters, search, pagination, sorting, URL sync via watchDebounced, hasActiveFilters, readonly params, and reset
- [x] 4.2 Create useModalForm composable in `app/composables/useModalForm.ts` with open/close/openCreate/openEdit/isEditing lifecycle
- [x] 4.3 Write unit tests for useListQueryState composable (URL init, debounce sync, page reset, hasActiveFilters, reset)
- [x] 4.4 Write unit tests for useModalForm composable (create mode, edit mode, close, form reactivity)

## 5. Audit Logging as a Migration Template

- [x] 5.1 Create audit logs migration template at `scripts/templates/migrations/audit_logs.sql` with table structure, indexes, and RLS policies (migration is a template, not auto-applied)
- [x] 5.2 Create server-side audit utility at `server/utils/audit.ts` with `createAuditLog()` function (fire-and-forget, uses service role client)
- [x] 5.3 Write unit tests for `createAuditLog()` utility
- [x] 5.4 Add documentation in `docs/guide/audit-logging.md` explaining the template approach

## 6. Server Middleware as Opt-In Templates

- [x] 6.1 Create rate limiter middleware template at `scripts/templates/server/middleware/rate-limiter.ts` using Nitro unstorage (configurable path, window, max requests)
- [x] 6.2 Create CSP report-only middleware template at `scripts/templates/server/middleware/csp-report-only.ts` for development environments
- [x] 6.3 Verify middleware templates are not auto-installed — files exist only in `scripts/templates/`, not in active `server/middleware/`
- [x] 6.4 Add documentation explaining when and how to copy middleware templates

## 7. VitePress Documentation Site

- [x] 7.1 Create VitePress documentation site skeleton: `docs/.vitepress/config.ts` with VitePress config includes navigation (sidebar + top nav)
- [x] 7.2 Create documentation pages: `docs/index.md`, `docs/guide/getting-started.md`, `docs/guide/auth.md`, `docs/guide/database.md`
- [x] 7.3 Add VitePress scripts in package.json: `docs:dev`, `docs:build`, `docs:preview`
- [x] 7.4 Verify VitePress is an optional dependency — remains in devDependencies regardless of setup selection
- [x] 7.5 Update `scripts/setup.sh` to integrate VitePress feature toggle with the docs skeleton

## 8. Integration & Validation

- [x] 8.1 Run `pnpm check` to verify all changes pass format, lint, typecheck, and tests
- [x] 8.2 Run `pnpm setup` end-to-end to verify the full setup flow with each auth provider option
- [x] 8.3 Update `docs/QUICK_START.md` to mention the new auth provider choice and available templates
