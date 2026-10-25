---
description: 認證相關程式碼（login, session, user, auth）
paths: ['app/**/*.{vue,ts}', 'packages/*/app/**/*.{vue,ts}', 'server/**/*.ts', 'packages/*/server/**/*.ts']
---
<!-- Clade native rule; source: rules/modules/auth/better-auth/auth.md; edit canonical source -->
<!-- clade-targets: claude,agents -->

# Auth

**USE** `useUserSession()` — **NEVER** use `useSupabaseUser()` or any Supabase Auth API.

本 variant = `@onmax/nuxt-better-auth`；Supabase 僅作 Postgres DB，Auth 由 better-auth 負責。Session 資料存 DB 表。

## better-auth 安全基線

- (a) **session 驗證一律走 better-auth 的 server-side API**，NEVER 信任 client 傳入的 user id/role
- (b) **授權資料存自家表**（server 寫入），NEVER 放 client 可改欄位
- (c) **刪除/停用 user 時 MUST 同步撤銷該 user 的 session 資料列**——DB-backed session 不會因刪 user 自動失效；開 `session.cookieCache` 時的撤銷延遲與期限設定見 [[user-lifecycle]] § Session 失效策略（依 session-store 類型）
- (d) **`service_role` 等 server secret NEVER 進 client bundle**（DB 仍是 Supabase，此條照舊適用）
- (e) **`advanced.cookiePrefix` MUST 設專案唯一值**——cookie 不分 port，同網域（含 `localhost` 不同 port、同一 parent domain 的子網域）跑兩個 better-auth app 時預設 cookie 名相同，互相覆蓋登入狀態
- (f) **註冊網域限制 MUST 在 server 的 user create hook 擋**（`databaseHooks.user.create.before` 丟錯）——social login 與直接打 sign-up API 都不經表單，只做表單驗證等於沒擋
- (g) **social provider 只在 client id 與 secret 都有值時才放進 `socialProviders`**；登入頁的按鈕清單由 server 依已註冊的 provider 下發。**NEVER** 用空字串硬註冊或前端寫死清單——按鈕照樣出現，點下去才失敗
- (h) `baseURL`／`trustedOrigins` 的來源照 [[nuxt-security]] § 對外 origin 取自設定

## 與 Supabase 併用時：RLS 不能當授權層

本 variant 下 **Supabase 不會對你的使用者簽發任何 JWT**。直接後果：

- RLS policy 裡的 `auth.uid()` **恆為 null** —— policy 語法正確、RLS 也啟用著，但一條 row 都不會通過
- server 端若走 service-role 連線（`SUPABASE_SECRET_KEY`），service_role 具 `BYPASSRLS`，policy 連評估都不評估

所以本 variant 的授權模型是 **server-mediated**：

1. **授權 MUST 在 handler 層**完成——`requireAuth` + ownership 比對、`requireRole`、或以 `user.id` 夾住查詢條件。**每一支**會回傳他人資料的 handler 都要做，不是只做「看起來危險的那幾支」
2. **RLS MUST 改為「啟用 + 零 policy」的 deny-all**，並在 migration 註明是 by design。它擋的是「繞過 server 的直連」，不是「越權的 handler」
3. server helper **MUST 誠實命名**。`getSupabaseWithContext` 這種名字會讓 handler 作者以為範圍已限縮；本 variant 的等價 helper 是 **`getAuthedSupabase(event)`**（只驗 session、回 `{ client, user }`、不做授權）。reference implementation：`nuxt-supabase-starter` 的 `template/server/utils/supabase.ts`
4. **NEVER** 用 `set_app_context` 這類 RPC 寫 GUC 給 policy 讀——`set_config(..., true)` 是 transaction-local，PostgREST 每 request 獨立 transaction，恆定無效

5. **每一條授權規則只歸一層**：本 variant 的租戶隔離（§ Organization 隔離）與動作權限（§ Access control）都在 handler，RLS 只有 deny-all。`SECURITY.md` 不變量的 `enforced by` 照實寫 `handler`，**NEVER** 寫 `rls`；分工判準見 [[security-policy]] § 條件句

完整命題與判準見 [[auth-data-path-consistency]] § Server 側：RLS policy 的前提條件。

## Access control（角色 → 資源 → 動作）

- 角色權限 **MUST** 用 `createAccessControl` 寫成一份「資源 → 動作」表，同一份 `ac`／roles 同時交給 server plugin（`organization({ ac, roles })`）與 client plugin（`organizationClient({ ac, roles })`）。client 端只拿它決定顯示，授權以 server 端 `auth.api.hasPermission` 為準
- 不屬於 CRUD 的敏感操作（瀏覽稽核紀錄、事件 replay、匯出）**MUST** 各自是獨立動作，**NEVER** 併進 `read` 或改判「是不是 admin」——併進去之後只能整包給或整包不給
- handler **NEVER** 散落 `role === 'admin'` 字串比對；角色到動作的對應只存在這一份表裡

```ts
// Good：一份 statement，server 與 client 共用
const statement = { project: ['create', 'read', 'update', 'delete'], audit: ['read'], event: ['replay'] } as const
export const ac = createAccessControl(statement)
export const roles = {
  member: ac.newRole({ project: ['read'] }),
  admin: ac.newRole({ project: ['create', 'read', 'update', 'delete'], audit: ['read'] }),
}
// Bad：handler 內 if (session.user.role === 'admin') 判斷能不能看稽核紀錄
```

角色分層（平台 vs 組織）、superuser bootstrap、per-record 權限表見 [[auth-roles]]。

## Organization 隔離

- 多租戶業務表 **MUST** 有 `organization_id NOT NULL`，**每一個**查詢 **MUST** 以 session 的 `activeOrganizationId` 夾住。`activeOrganizationId` 為空時拒絕，**NEVER** 退回不過濾
- **只驗「有 session」不算授權**：guard 確認登入就放行、再用 route 上的 id 直接查表，任何登入者都讀得到別的 org 的資料
- 租戶身分 **NEVER** 取自 query／body／route 參數；route 帶 org id 時 **MUST** 與 `activeOrganizationId` 相等或以 membership 查證
- 切換 org 只經 `organization.setActive`（寫進 server session）；**NEVER** 把目前 org 存在 client state 再當參數送 server
- 建立 org 成功後 **MUST** 立即設為 active；沒有 active org 的使用者（剛註冊、被移出最後一個 org）進 dashboard 路由時 **MUST** 導到空狀態頁（建立 org／等待邀請），**NEVER** 以 null org 渲染列表或回 500
- `SECURITY.md` 從 tenant-scoped 範本的 better-auth 變體建（[[security-policy]] § 條件句）

## 僅適用直接使用 Supabase Auth（GoTrue）的場景

以下僅在 consumer 直接用 Supabase Auth 時適用；better-auth consumer 跳過本節。

- **NEVER** use `user_metadata`（`raw_user_meta_data`）做授權判斷 — 使用者可自行修改，會出現在 `auth.jwt()` 中。授權資料必須存在 `app_metadata`（`raw_app_meta_data`）
- **刪除 user 不會讓現有 JWT 失效** — 必須先 sign out / revoke sessions，敏感應用應縮短 JWT expiry，嚴格場景需對 `auth.sessions` 驗證 `session_id`
- **`app_metadata` / `auth.jwt()` 的 claims 不會即時更新** — 要等 token refresh 後才會反映最新值，勿依賴即時性做關鍵判斷
- **Refresh token 一次性使用**，有兩個例外：
  1. **Reuse interval**（預設 10 秒）：同一 refresh token 在 10 秒內重複使用會回傳同一對新 token，解決 SSR / race condition
  2. **Parent token fallback**：若當前 active token 的 parent 被重用，回傳 active token，避免網路不穩造成 session 爆掉
  - 不符合上述兩條件 → 整個 session 被判定為遭竊，**所有相關 refresh token 立即撤銷**

See `@onmax/nuxt-better-auth` 官方文件 + 本目錄 dev-login.md for dev-login 實作。
