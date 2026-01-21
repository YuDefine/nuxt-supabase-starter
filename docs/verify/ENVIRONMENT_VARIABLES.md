# 環境變數與密鑰策略

> 此文件說明命名規則、必填變數、常見錯誤以及如何安全地分享設定。

---

## 1. 檔案與優先序

| 檔案              | Git | 用途                                       |
| ----------------- | --- | ------------------------------------------ |
| `.env.example`    | ✅  | 範例，列出所有需要的 key（不得保留真實值） |
| `.env.local`      | ❌  | 本地開發與 `pnpm dev` 使用，最優先         |
| `.env.production` | ❌  | 部署時由 CI 產生，repo 內目前不使用        |

Nuxt 讀取順序：`.env.local` → `.env.{mode}` → `.env`。若同名，後者覆蓋前者。

---

## 2. 命名規則

| 用途        | 命名                   | 備註                                                                                       |
| ----------- | ---------------------- | ------------------------------------------------------------------------------------------ |
| 前端可存取  | `NUXT_PUBLIC_*`        | 在瀏覽器端可直接讀到，僅能放非敏感資訊                                                     |
| Server 專用 | 無 `NUXT_PUBLIC_`      | 僅 `server/api`、`runtimeConfig`、腳本可讀                                                 |
| OAuth       | `NUXT_OAUTH_*`         | OAuth 設定（Google、GitHub 等）                                                            |
| Supabase    | `SUPABASE_*`           | `SUPABASE_URL`、`SUPABASE_KEY`、`SUPABASE_SERVICE_ROLE_KEY` 等                             |
| Sentry      | `NUXT_PUBLIC_SENTRY_*` | 必須使用 `NUXT_PUBLIC_` 前綴，因為 Sentry config 在 build time 執行                        |

禁止在程式內直接引用 `process.env.SOMETHING` 而無 fallback，請統一經 `runtimeConfig` 或 `useRuntimeConfig()` 取得。

---

## 3. 必填清單

```bash
# Supabase：資料庫連線
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_KEY=<publishable_anon_key>
SUPABASE_SERVICE_ROLE_KEY=<service_role_key>      # Server 端專用，繞過 RLS

# OAuth（根據需要選擇 Provider）
NUXT_OAUTH_GOOGLE_CLIENT_ID=<client>.apps.googleusercontent.com
NUXT_OAUTH_GOOGLE_CLIENT_SECRET=<client-secret>

# Nuxt 站點
NUXT_PUBLIC_SITE_URL=http://localhost:3000
```

## 3.1. 可選變數

```bash
# GitHub OAuth
NUXT_OAUTH_GITHUB_CLIENT_ID=<github-client-id>
NUXT_OAUTH_GITHUB_CLIENT_SECRET=<github-client-secret>

# Sentry 錯誤追蹤
SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
NUXT_PUBLIC_SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
```

---

## 4. 認證架構說明

本系統使用 **@onmax/nuxt-better-auth** 進行認證：

### 4.1. 認證流程

```
使用者 → signIn.social({ provider: 'google' }) → OAuth Provider
                                                     ↓
                      ← Session ← Server 驗證 + 建立 Session
```

### 4.2. Server 端使用

```ts
// 要求登入
const { user } = await requireUserSession(event)

// 取得 Supabase Client
const client = await getSupabaseWithContext(event)
```

### 4.3. Client 端使用

```ts
const { user, loggedIn, signIn, signOut } = useUserSession()

// OAuth 登入
await signIn.social({ provider: 'google' })

// 登出
await signOut()
```

---

## 5. 分享 / 版本控管

| 情境          | 建議做法                                                                             |
| ------------- | ------------------------------------------------------------------------------------ |
| 新成員加入    | 直接複製 `.env.example`，再由資深成員透過安全渠道（1Password、Vault）提供實際值      |
| PR 需要新變數 | 同步更新 `.env.example`、本文件、相關程式                                            |
| CI/CD         | 透過平台（GitHub Actions、GitLab、Fly.io）設定 Secret，不要將 `.env.production` 上版 |
| NuxtHub       | 透過 NuxtHub dashboard 設定環境變數，建議將敏感變數設為 Secret                       |

---

## 6. 常見錯誤

| 症狀                         | 可能原因                                         | 解法                                     |
| ---------------------------- | ------------------------------------------------ | ---------------------------------------- |
| OAuth 登入失敗               | `NUXT_OAUTH_*_CLIENT_ID` 或 `SECRET` 不正確      | 檢查 OAuth Provider Console 設定         |
| API 回傳 401 Unauthorized    | Session 過期或未登入                             | 重新登入，檢查 Cookie 是否正確設定       |
| RLS 無法讀取資料             | Service Role Key 未設定                          | 確認 `SUPABASE_SERVICE_ROLE_KEY` 已設定  |
| `NUXT_PUBLIC_*` 泄漏祕密     | 將 Service Role、私有 API key 放在 public 變數   | 立即旋轉金鑰並改為 server-only 變數      |

---

## 7. 範例 `.env.local`

```bash
# Supabase（資料庫）
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# OAuth
NUXT_OAUTH_GOOGLE_CLIENT_ID=12345.apps.googleusercontent.com
NUXT_OAUTH_GOOGLE_CLIENT_SECRET=GOCSPX-xxxx

# 站點 URL
NUXT_PUBLIC_SITE_URL=http://localhost:3000
```

只要 `.env.example` 與本文件保持同步，新人複製後即可立即使用 `pnpm dev`。
