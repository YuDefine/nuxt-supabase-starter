# Security Policy

依 `.claude/rules/security-policy.md`（clade `rules/core/security-policy.md`）五段固定結構。這份是 starter 的實填範例：新專案 scaffold 後逐段核對，攻擊入口與 secret key 名照實際增減。

## 攻擊入口

- `server/api/v1/profiles/**`：已登入使用者的 profile 讀取（`index`、`me`、`[id]`）
- `server/api/auth/**`（Better Auth handler）：登入 / 登出 / OAuth callback（Google / LINE / GitHub）
- `server/routes/**`：靜態與 health 類 route，不碰使用者資料
- 未認證入口：
  - `server/api/_dev/login.post.ts`：dev-only 身分切換，`nuxt dev` 以外回 404；`as: 'admin'` 需 email 在 `ADMIN_EMAIL_ALLOWLIST`
  - Better Auth OAuth callback：只接受 provider 簽回的 code，不接受 client 自帶身分

## 信任邊界

- session：Better Auth cookie session；`requireAuth(event)` 是每個需登入 handler 的第一行
- `server/middleware/`：starter 本體為空；`scripts/templates/server/middleware/rate-limiter.ts` 與 `csp-report-only.ts` 是可啟用的 scaffold
- Supabase 從未對使用者簽發 JWT，`auth.uid()` 恆為 null；server 端 client 一律 service-role（`server/utils/supabase.ts`），Drizzle 走 `ADMIN_DATABASE_URL`（`server/utils/drizzle.ts`）
- 因此 **授權在 handler 層完成**；RLS 在這個架構下是「非 server 一律拒絕」的 deny-all 防線，不承擔 row-level 授權

## 身分與授權模型

user-owned

- RLS：所有表對 anon / authenticated 角色 deny-all；只有 service-role 可讀寫
- middleware：無（session 檢查在 handler）
- handler：讀 / 寫依 URL id 的資料時 MUST 比對 `user.id === id`，admin 例外；不符回 404（不回 403，避免 id 枚舉）；admin 只由 `ADMIN_EMAIL_ALLOWLIST` 晉升，NEVER 由 dev-login 單獨鑄造

## 核心資產與 secret

- 資料表：`profiles`（個資）、`audit_logs`（不可竄改的操作紀錄）、`evlog_events`（含 request 上下文）
- secret key 名：`SUPABASE_SECRET_KEY`、`ADMIN_DATABASE_URL`、`DATABASE_URL`、`BETTER_AUTH_SECRET`、`NUXT_SESSION_PASSWORD`、`NUXT_OAUTH_GOOGLE_CLIENT_SECRET`、`NUXT_OAUTH_LINE_CLIENT_SECRET`、`NUXT_OAUTH_GITHUB_CLIENT_SECRET`、`SENTRY_AUTH_TOKEN`、`NUXT_DEV_LOGIN_PASSWORD`（值在部署環境，NEVER 進 repo）
- 公開可見：`NUXT_PUBLIC_SUPABASE_URL`、`NUXT_PUBLIC_SUPABASE_KEY`（anon key，RLS deny-all 下讀不到資料）、`NUXT_PUBLIC_SENTRY_DSN`、`NUXT_PUBLIC_SITE_URL`

## 安全不變量

- INV-1: 任何 handler NEVER 依 URL / body 裡的 id 回傳或修改不屬於當前 session 使用者的資料（admin 例外） — enforced by: handler
- INV-2: 非 admin 對他人資源的請求 NEVER 回 403，一律 404，避免 id 枚舉 — enforced by: handler
- INV-3: anon / authenticated 角色 NEVER 直接讀寫任何表；只有 server 端 service-role 可以 — enforced by: rls
- INV-4: `_dev/**` 入口在 `nuxt dev` 以外 NEVER 可達（404），admin 身分 NEVER 由 dev-login 單獨鑄造 — enforced by: handler
- INV-5: admin 晉升只准經 `ADMIN_EMAIL_ALLOWLIST`，login / OAuth callback 與 dev-login 讀同一份清單 — enforced by: handler
- INV-6: `audit_logs` NEVER 被 update / delete；只准 insert — enforced by: rls
- INV-7: 任何 secret 的值 NEVER 出現在 repo、log 或 evlog event payload — enforced by: handler
