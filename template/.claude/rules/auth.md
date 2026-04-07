---
description: 認證相關程式碼（login, session, user, auth）
globs: ['app/**/*.{vue,ts}', 'server/**/*.ts']
---

# Auth

**USE** `useUserSession()` — **NEVER** use `useSupabaseUser()` or any Supabase Auth API.

See `nuxt-auth-utils` or `nuxt-better-auth` skill for OAuth flow and session types.

## Supabase Auth 安全陷阱

- **NEVER** use `user_metadata`（`raw_user_meta_data`）做授權判斷 — 使用者可自行修改，會出現在 `auth.jwt()` 中。授權資料必須存在 `app_metadata`（`raw_app_meta_data`）
- **刪除 user 不會讓現有 JWT 失效** — 必須先 sign out / revoke sessions，敏感應用應縮短 JWT expiry，嚴格場景需對 `auth.sessions` 驗證 `session_id`
- **`app_metadata` / `auth.jwt()` 的 claims 不會即時更新** — 要等 token refresh 後才會反映最新值，勿依賴即時性做關鍵判斷
- **NEVER** expose `service_role` key 到 client — 前端只用 publishable（anon）key
