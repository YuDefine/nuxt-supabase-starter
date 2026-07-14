---
description: 認證相關程式碼（login, session, user, auth）
paths: ['app/**/*.{vue,ts}', 'packages/*/app/**/*.{vue,ts}', 'template/app/**/*.{vue,ts}', 'server/**/*.ts', 'packages/*/server/**/*.ts', 'template/server/**/*.ts']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/modules/auth/better-auth/auth.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# Auth

**USE** `useUserSession()` — **NEVER** use `useSupabaseUser()` or any Supabase Auth API.

本 variant = `@onmax/nuxt-better-auth`；Supabase 僅作 Postgres DB，Auth 由 better-auth 負責。Session 資料存 DB 表。

## better-auth 安全基線

- (a) **session 驗證一律走 better-auth 的 server-side API**，NEVER 信任 client 傳入的 user id/role
- (b) **授權資料存自家表**（server 寫入），NEVER 放 client 可改欄位
- (c) **刪除/停用 user 時 MUST 同步撤銷該 user 的 session 資料列**——DB-backed session 不會因刪 user 自動失效
- (d) **`service_role` 等 server secret NEVER 進 client bundle**（DB 仍是 Supabase，此條照舊適用）

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
