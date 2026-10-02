# 程式碼盤點（由 tools/build-inventory.mjs 產生，NEVER 手改）

## HTTP 路由（server/api/**）

| 方法 | 路徑 | 檔案 | 行數 |
| --- | --- | --- | --- |
| POST | `/api/_dev/login` | `server/api/_dev/login.post.ts` | 290 |
| GET | `/api/v1/profiles/{id}` | `server/api/v1/profiles/[id].get.ts` | 77 |
| GET | `/api/v1/profiles` | `server/api/v1/profiles/index.get.ts` | 86 |
| GET | `/api/v1/profiles/me` | `server/api/v1/profiles/me.get.ts` | 53 |

## 資料表（supabase/migrations/*.sql）

| 資料表 | 檔案:行 |
| --- | --- |
| profiles | `supabase/migrations/20260313091145_create_profiles.sql:39` |
| audit_logs | `supabase/migrations/20260804190000_create_audit_logs.sql:14` |
| evlog_events | `supabase/migrations/20260819021500_create_evlog_events.sql:15` |

## 頁面（app/pages/**）

| 路由 | 檔案 | 行數 |
| --- | --- | --- |
| `/` | `app/pages/(home).vue` | 84 |
| `/admin/users` | `app/pages/admin/users.vue` | 27 |
| `/auth/callback` | `app/pages/auth/callback.vue` | 47 |
| `/auth/forgot-password` | `app/pages/auth/forgot-password.vue` | 93 |
| `/auth/login` | `app/pages/auth/login.vue` | 153 |
| `/auth/register` | `app/pages/auth/register.vue` | 136 |
| `/demo` | `app/pages/demo.vue` | 358 |
| `/profile` | `app/pages/profile/index.vue` | 37 |
| `/walkthrough` | `app/pages/walkthrough.vue` | 82 |

## 既有測試（test/**、e2e/**）

| 檔案 | runner | 測試案例數（`it(`／`test(` 出現次數；`it.each` 的展開不計） |
| --- | --- | --- |
| `test/nuxt/AppEmptyState.nuxt.test.ts` | vitest(nuxt) | 4 |
| `test/nuxt/csrf-auth-exclusion.nuxt.test.ts` | vitest(nuxt) | 2 |
| `test/unit/composables/useModalForm.test.ts` | vitest(unit) | 19 |
| `test/unit/example.test.ts` | vitest(unit) | 1 |
| `test/unit/scripts/validate-starter.test.ts` | vitest(unit) | 5 |
| `test/unit/scripts/vue-component-resolution.test.ts` | vitest(unit) | 5 |
| `test/unit/server/api/_dev/login.observability.dev.test.ts` | vitest(unit) | 4 |
| `test/unit/server/api/_dev/login.post.test.ts` | vitest(unit) | 16 |
| `test/unit/server/api/v1/profiles/[id].get.test.ts` | vitest(unit) | 7 |
| `test/unit/server/api/v1/profiles/index.get.test.ts` | vitest(unit) | 5 |
| `test/unit/server/api/v1/profiles/me.get.test.ts` | vitest(unit) | 3 |
| `test/unit/server/api/v1/profiles/observability.test.ts` | vitest(unit) | 5 |
| `test/unit/server/utils/api-response.test.ts` | vitest(unit) | 12 |
| `test/unit/server/utils/audit.test.ts` | vitest(unit) | 8 |
| `test/unit/server/utils/db-errors.test.ts` | vitest(unit) | 15 |
| `test/unit/server/utils/drizzle.test.ts` | vitest(unit) | 8 |
| `test/unit/server/utils/supabase.test.ts` | vitest(unit) | 7 |
| `test/unit/server/utils/validation.test.ts` | vitest(unit) | 10 |
| `test/unit/shared/schemas/profiles.test.ts` | vitest(unit) | 22 |
| `test/unit/vue-warn-guard.test.ts` | vitest(unit) | 2 |
| `e2e/auth.spec.ts` | playwright | 8 |
| `e2e/roles.example.spec.ts` | playwright | 4 |
| `e2e/smoke.spec.ts` | playwright | 7 |
