---
description: 認證相關程式碼（login, session, user, auth）
paths: ['app/**/*.{vue,ts}', 'server/**/*.ts']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/modules/auth/better-auth/auth.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->


# Auth

**USE** `useUserSession()` — **NEVER** use `useSupabaseUser()` or any Supabase Auth API.

See `nuxt-auth-utils` or `nuxt-better-auth` skill for OAuth flow and session types.

## Supabase Auth 安全陷阱

- **NEVER** use `user_metadata`（`raw_user_meta_data`）做授權判斷 — 使用者可自行修改，會出現在 `auth.jwt()` 中。授權資料必須存在 `app_metadata`（`raw_app_meta_data`）
- **刪除 user 不會讓現有 JWT 失效** — 必須先 sign out / revoke sessions，敏感應用應縮短 JWT expiry，嚴格場景需對 `auth.sessions` 驗證 `session_id`
- **`app_metadata` / `auth.jwt()` 的 claims 不會即時更新** — 要等 token refresh 後才會反映最新值，勿依賴即時性做關鍵判斷
- **NEVER** expose `service_role` key 到 client — 前端只用 publishable（anon）key

> 本檔為 starter template 的預設規則，複製出去後依專案實際使用調整。

## Session 與 Refresh Token Lifecycle

Template 預設使用 `@onmax/nuxt-better-auth`（better-auth + Supabase）。若切換到其他 auth 方案，先閱讀以下 Supabase Auth 核心概念：

- **Access token（JWT）預設 1 小時 expiry** — 勿設低於 5 分鐘，會觸發 clock skew 問題與增加 Auth server 負載
- **Refresh token 一次性使用**，有兩個例外：
  1. **Reuse interval**（預設 10 秒）：同一 refresh token 在 10 秒內重複使用會回傳同一對新 token，解決 SSR / race condition
  2. **Parent token fallback**：若當前 active token 的 parent 被重用，回傳 active token，避免網路不穩造成 session 爆掉
  - 不符合上述兩條件 → 整個 session 被判定為遭竊，**所有相關 refresh token 立即撤銷**
- **Session 不會即時終止** — time-box / inactivity timeout 只在下次 refresh 時檢查
- **檢測 sign-out 後 JWT 是否仍有效**：比對 JWT 的 `session_id` claim 與 `auth.sessions` 表是否存在該 row

## OAuth Flow 選擇（PKCE vs Implicit）

**預設建議使用 PKCE flow**：

- **Implicit flow**：token 從 URL fragment 回傳，只能 client 解析（browser 不送 fragment 給 server），token 存在 `localStorage`
- **PKCE flow**：server 拿 `?code=...` → `exchangeCodeForSession(code)` 換 token，code 有 5 分鐘效期、一次性

### 若 template 的新專案需要 SSR

PKCE flow 是必須的（implicit flow 不支援 server 端取得 session）。設定：

```ts
// ~/utils/supabase.ts
const supabase = createClient(url, key, {
  auth: {
    flowType: 'pkce',
    detectSessionInUrl: true,
    storage: customCookieStorageAdapter, // HTTP-only cookie
  },
})
```

並實作 `server/api/auth/callback.get.ts` 處理 `?code=` → `exchangeCodeForSession`。

### 若 template 的新專案是 SPA-only

Implicit flow 可用，但有以下限制：

- Token 存 `localStorage` — 有 XSS 洩漏風險，需搭配 CSP
- 無法在 server 端取得 session — 所有 auth 檢查只能在 client

### 升級觸發條件

任一成立即應從 implicit 升級到 PKCE：

1. 需要 SSR / server-rendered pages 取到 session
2. Token 洩漏事件（localStorage XSS）
3. 合規要求（SOC2 / HIPAA 要求 HTTP-only cookie）

升級會讓**所有既有 session 失效** — 需規劃停機窗口通知使用者重新登入。

## Secrets 管理

- **NEVER** commit `.env` 到 git — `.env.example` 可以，實際 `.env` 不行
- **NEVER** 把 secret 放 `NUXT_PUBLIC_*` / `VITE_*` / `PUBLIC_*` 前綴 — 這些會打包進 client bundle
- **Server-only secrets**：放 `runtimeConfig`（不加 `public`），透過 `useRuntimeConfig().xxx` 存取
- **Deploy secrets**：
  - Cloudflare Workers → `wrangler secret put`
  - Vercel → Environment Variables（敏感類型）
  - Nuxt Hub → Environment Variables
- **Rotation**：手動 rotate（改 provider → redeploy）— 無自動機制，除非接 Vault / KMS

### Supabase Vault（欄位加密）

Template 預設**未使用** Vault。若新專案有欄位級加密需求：

- 評估 `pgsodium` extension 或應用層加解密（通常優先應用層，避免 DB log 洩漏）
- Key 不落地：不寫進 migration，由環境變數或 Vault 管
- Key rotation 流程必須在 spec 階段就規劃好
