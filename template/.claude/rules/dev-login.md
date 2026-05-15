<!--
🔒 LOCKED — managed by clade
Source: rules/modules/auth/better-auth/dev-login.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->

---
description: Dev-login routes must stay local-only while giving screenshot review and E2E a canonical way to mint test sessions.
paths: ['server/routes/auth/**/*dev-login*.ts', 'server/routes/auth/**/*test-login*.ts', 'server/api/_dev/**/*.ts', 'packages/*/server/routes/auth/**/*dev-login*.ts', 'packages/*/server/routes/auth/**/*test-login*.ts', 'e2e/**/*.ts', 'test/e2e/**/*.ts', 'tests/e2e/**/*.ts']
---

# Dev-login

Dev-login routes are local/test-only auth bypasses for screenshot automation, E2E, and developer identity switching. Treat them as critical auth surfaces.

## MUST

- **MUST** fail closed with 404 outside the intended local/e2e runtime.
- **MUST** use `import.meta.dev` when the route only needs `nuxt dev`; use an explicit env/runtime local gate only when E2E runs against a production build or Workers local runtime.
- **MUST** ensure production deploy config never enables the dev-login gate (`NUXT_E2E_TESTING`, `NUXT_KNOWLEDGE_ENVIRONMENT=local`, or project equivalent).
- **MUST** use canonical `as` for role/scenario selection. Existing `role` query params may remain as compatibility aliases, but new docs/tests should use `as`.
- **MUST** validate `as` against the project role source: DB role names for role-as-data systems, local const enum for code-defined role systems, allowlist-derived admin for better-auth.
- **MUST** keep `email` as a concrete identity selector. If both `email` and `as` are present, `email` selects the user and `as` validates/overrides only according to project rules.
- **MUST** protect `redirect` with `startsWith('/') && !startsWith('//')`. POST dev-login endpoints should return JSON and let the caller navigate after success.
- **MUST** emit a structured server-side dev-login log containing route, email, requested `as`, resolved role, action, and environment.
- **MUST** mark any persistent rows created by dev-login with a dev/test provider marker such as `provider='dev-login'`, `provider='test'`, or `provider_id='e2e-*'`.
- **MUST** add or update focused tests for the guard, role resolution, email handling, session payload, and open-redirect rejection.

## NEVER

- **NEVER** expose dev-login in production or staging unless the route is explicitly part of a documented staging-only test gate and disabled by default.
- **NEVER** skip the guard because "the file name starts with underscore". File naming is not a security boundary.
- **NEVER** send passwords through GET query strings.
- **NEVER** write dev-login rows to a non-dev DB.
- **NEVER** mint admin through a dev-login-only code path when real auth derives admin from an allowlist, external IdP, or another source of truth.
- **NEVER** patch auth middleware or protected pages to make screenshots work. Use dev-login, a seeded account, or stop and report the missing auth path.
- **NEVER** log raw passwords or tokens in dev-login audit output.

## Canonical Route Shapes

| Auth module | Route | Method | Notes |
| --- | --- | --- | --- |
| `hub-auth-nuxt-auth-utils` | `/auth/_dev-login` | GET | Uses `setUserSession()` after DB lookup. |
| `hub-auth-better-auth` | `/api/_dev/login` | POST | Uses `auth.api.signInEmail()` / `signUpEmail()` and copies `set-cookie`. |
| `hub-auth-supabase-self-hosted` | `/auth/_dev-login` | GET | May keep legacy `/auth/__test-login` when Playwright already depends on it. |
| `hub-auth-supabase` | `/auth/_dev-login` | GET | Uses managed Supabase service role and project profile/claims sync. |

## Decision Reference

完整 canonical decision matrix（route path / method / guard / params / DB mode / audit / naming / open redirect）+
per-variant TypeScript skeletons + per-consumer migration plan：見 clade `openspec/discussions/dev-login-canonical-design.md`。

## Screenshot Integration

- See `screenshot-strategy.md` for screenshot tool selection and artifact naming.
- The `screenshot-review` agent knows the canonical GET and POST dev-login patterns. Keep agent prompt examples in sync when adding a new auth variant.
