---
audience: both
applies-to: post-scaffold
---

# 部署指南

從開發到 Production 的完整部署流程（Cloudflare Workers）。

---

## 前置條件

- Cloudflare 帳號（免費方案即可）
- GitHub 帳號（用於 CI/CD）
- Supabase Cloud 專案（或免費 [Self-host](verify/SELF_HOSTED_SUPABASE.md)，Supabase 是開源的）

---

## Supabase Cloud 或 Self-hosted？

Supabase 是開源的，除了使用官方 Cloud 服務，也可以免費自架在自己的伺服器上。兩條路線的開發方式完全相同（Migration、RLS、API 都一樣），差別在部署與維運：

| 比較項目      | Cloud                         | Self-hosted                         |
| ------------- | ----------------------------- | ----------------------------------- |
| **適合情境**  | 快速上線、不想管基礎設施      | 資料隱私要求高、長期成本控制        |
| **費用**      | 免費方案有限額，Pro $25/月起  | 免費（僅付伺服器費用）              |
| **維運**      | Supabase 負責升級、備份、監控 | 自行維護 Docker Compose、備份、升級 |
| **Migration** | `supabase db push` 一鍵推送   | `docker exec` 或 psql 手動執行      |
| **Dashboard** | `supabase.com/dashboard`      | 自架 Studio（`localhost:3000`）     |

**建議**：剛開始用 Cloud 免費方案快速開發，之後可隨時遷移到 Self-hosted。程式碼不需要任何修改，只需更換環境變數。

- **選 Cloud** → 繼續下方 Step 1
- **選 Self-hosted** → 前往 [Self-hosted Supabase 部署指南](verify/SELF_HOSTED_SUPABASE.md)，完成後跳到 Step 2

---

## Auth Architecture Decision Guide

> **Read this before deploying.** If you are using **self-hosted Supabase** with **Cloudflare Workers**, your choice of auth solution has critical implications. This section explains the constraints and helps you pick the right path.

### The Problem: Cloudflare Workers Cannot TCP-Connect to Private Databases

Better Auth stores sessions, users, and accounts in PostgreSQL. It requires a TCP connection to the database via the `pg` driver's connection pool.

- **Supabase Cloud** exposes a public PostgreSQL endpoint. Workers can TCP-connect directly. **Better Auth works fine.**
- **Self-hosted Supabase** (e.g., on a private VM behind Cloudflare Tunnel) does not expose a public PostgreSQL port. Workers' `connect()` API fails with `Error: proxy request failed, cannot connect to the specified address`. **All auth operations return 500.**

This is not a code bug -- it is a fundamental networking constraint. Cloudflare Workers can only establish TCP connections to publicly routable addresses, not to origins behind Cloudflare Tunnel.

### Deployment Environment x Auth Solution Matrix

| Deployment Target                   | Database                  | Better Auth | nuxt-auth-utils | Notes                                                                                                                       |
| ----------------------------------- | ------------------------- | ----------- | --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Cloudflare Workers**              | Supabase Cloud            | Works       | Works           | No restrictions                                                                                                             |
| **Cloudflare Workers**              | Self-hosted (public IP)   | Works       | Works           | DB port must be publicly accessible                                                                                         |
| **Cloudflare Workers**              | Self-hosted (Tunnel only) | **Fails**   | Works           | TCP blocked -- see workarounds below                                                                                        |
| **Cloudflare Workers + Hyperdrive** | Self-hosted (Tunnel only) | Works\*     | Works           | \*Requires Workers Paid plan ($5/mo); known timeout issues ([#2274](https://github.com/cloudflare/workers-sdk/issues/2274)) |
| **Node.js / VM**                    | Any                       | Works       | Works           | Full TCP access, no restrictions                                                                                            |

### Workarounds for Self-hosted + Workers

If you want to keep Better Auth with a self-hosted database behind Cloudflare Tunnel:

#### Option A: Cloudflare Hyperdrive (recommended if staying with Better Auth)

Hyperdrive proxies TCP database connections from Workers. Configure it to point to your self-hosted PostgreSQL:

```bash
npx wrangler hyperdrive create my-db --connection-string="postgresql://user:pass@db.example.com:5432/postgres"
```

Then use the Hyperdrive connection string in your Better Auth config.

**Caveats:**

- Requires **Workers Paid plan** ($5/month minimum)
- Free plan allows only 1 Hyperdrive config
- There are known connection timeout issues in production workloads

#### Option B: Expose PostgreSQL publicly

Open port 5432 (or a custom port) on your host with proper firewall rules and `pg_hba.conf` restrictions. This removes the Tunnel limitation but increases your attack surface.

#### Option C: Switch to nuxt-auth-utils (recommended for most projects)

If your project only needs OAuth login + session management (no 2FA, team management, rate limiting, etc.), `nuxt-auth-utils` is a simpler and more compatible alternative. See the migration guide below.

### Better Auth vs nuxt-auth-utils Comparison

|                           | nuxt-auth-utils                                            | Better Auth                                          |
| ------------------------- | ---------------------------------------------------------- | ---------------------------------------------------- |
| **Session storage**       | Encrypted cookie (no DB needed)                            | PostgreSQL table (requires TCP)                      |
| **DB requirement**        | Optional (only to persist user profiles)                   | Required (session/user/account tables)               |
| **Workers compatibility** | Full (HTTP + cookies only)                                 | Requires TCP to DB (or Hyperdrive)                   |
| **Features**              | Basic: OAuth, password login, 15+ providers                | Rich: 2FA, teams, roles, rate limiting, 27+ plugins  |
| **Complexity**            | Low (composable + server routes)                           | Medium (DB adapter, migrations, schema)              |
| **When to choose**        | OAuth + session is enough; edge deployment; self-hosted DB | Need advanced auth features; have public DB endpoint |

### Migration Guide: Better Auth to nuxt-auth-utils

If you decide to migrate, here is the high-level process:

#### 1. Install nuxt-auth-utils

```bash
pnpm add nuxt-auth-utils
```

Add to `nuxt.config.ts`:

```ts
export default defineNuxtConfig({
  modules: ['nuxt-auth-utils'],
})
```

#### 2. Set session secret

Add `NUXT_SESSION_PASSWORD` to your environment (minimum 32 characters):

```bash
openssl rand -base64 32
```

#### 3. Replace auth server routes

- Remove Better Auth's `server/api/auth/[...all].ts` handler
- Create OAuth handlers using `nuxt-auth-utils` pattern:

```ts
// server/routes/auth/google.get.ts
export default defineOAuthGoogleEventHandler({
  async onSuccess(event, { user }) {
    await setUserSession(event, {
      user: {
        /* ... */
      },
    })
    return sendRedirect(event, '/')
  },
})
```

#### 4. Replace client-side composables

```diff
- import { useUserSession } from '~/composables/useAuth' // Better Auth
+ const { loggedIn, user, session, clear } = useUserSession() // nuxt-auth-utils
```

#### 5. Update session access in server routes

```diff
- const session = await getUserSession(event) // Better Auth
+ const { user } = await requireUserSession(event) // nuxt-auth-utils
```

#### 6. Remove Better Auth dependencies

```bash
pnpm remove better-auth @better-auth/cli
```

Remove Better Auth database tables (`user`, `session`, `account`, `verification`) via a migration if no longer needed.

#### 7. Clean up

- Remove `BETTER_AUTH_SECRET` from environment variables
- Remove Better Auth config files (`auth.ts`, `auth.client.ts`, etc.)
- Update `NUXT_SESSION_PASSWORD` in your GitHub Secrets

### Self-hosted Supabase: Additional Pitfalls

If you are running self-hosted Supabase behind Cloudflare Tunnel, watch out for these issues discovered in production:

1. **Supabase API returns 522**: If your reverse proxy (Caddy/Nginx) resolves `localhost` to IPv6, and Docker's IPv6 port mapping is broken, Kong won't respond. Fix: use `127.0.0.1` explicitly, or route through Cloudflare Tunnel instead of direct connection.

2. **CSRF failures with Better Auth**: Better Auth's `@better-fetch/fetch` does not use Nuxt's `$fetch`, so `nuxt-security`'s CSRF plugin cannot patch it. You must manually add CSRF headers in `createAuthClient`'s `fetchOptions.onRequest`.

3. **Tunnel DNS must be proxied**: Both TCP and HTTP tunnel DNS records must have the orange cloud (proxied) enabled. If your Supabase API was previously using an A record pointing directly to the VM, you need to change it to a CNAME pointing to the tunnel.

4. **Caddy TLS handshake failures**: Caddy v2.10+ with Cloudflare Origin Certificates may need explicit `protocols tls1.2 tls1.3` in the TLS config. Without it, TLS 1.3 handshake fails silently.

---

## Step 1：設定 Supabase Production（Cloud）

1. 前往 [Supabase Dashboard](https://supabase.com/dashboard) 建立新專案
2. 取得連線資訊：
   - `SUPABASE_URL`：Project Settings → API → Project URL
   - `SUPABASE_KEY`：Project Settings → API → anon public key
   - `SUPABASE_SECRET_KEY`：Project Settings → API → `service_role` key
3. 連結本地專案：

```bash
supabase link --project-ref <your-project-ref>
```

4. 推送 Migration 到遠端（首次需要）：

```bash
supabase db push --linked
```

---

## Step 2：設定 Cloudflare

1. 登入 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 取得 Account ID（首頁右側欄或任一 Workers 頁面）
3. 建立 API Token：My Profile → API Tokens → Create Token
   - 使用 **"Edit Cloudflare Workers"** 模板
   - 記錄 `CLOUDFLARE_API_TOKEN`

> 專案已內建 `wrangler.toml`，Nitro 使用 `cloudflare_module` preset，部署時無需額外設定。

---

## Step 3：設定 GitHub Secrets

在 GitHub repo → Settings → Secrets and variables → Actions 新增：

### 必要 Secrets

| Secret 名稱             | 說明                      | 取得方式                  |
| ----------------------- | ------------------------- | ------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Cloudflare API Token      | Cloudflare Dashboard      |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID     | Cloudflare Dashboard      |
| `SUPABASE_URL`          | Supabase Project URL      | Supabase Dashboard        |
| `SUPABASE_KEY`          | Supabase anon key         | Supabase Dashboard        |
| `SUPABASE_SECRET_KEY`   | Supabase service role key | Supabase Dashboard        |
| `BETTER_AUTH_SECRET`    | Auth 加密金鑰             | `openssl rand -base64 32` |
| `NUXT_SESSION_PASSWORD` | Session 加密金鑰          | `openssl rand -base64 32` |
| `NUXT_PUBLIC_SITE_URL`  | Production URL            | 你的網站網址              |

### 資料庫 CI/CD Secrets

CI workflow 的 `database` job 會自動推送 Migration，需要額外設定：

| Secret 名稱             | 說明               | 取得方式                           |
| ----------------------- | ------------------ | ---------------------------------- |
| `SUPABASE_ACCESS_TOKEN` | Supabase CLI Token | Supabase Dashboard → Access Tokens |
| `SUPABASE_DB_PASSWORD`  | 資料庫密碼         | 建立專案時設定的密碼               |

### 選用：OAuth Secrets

如果使用 OAuth 登入，依需要新增：

| Secret 名稱                       | 說明                       |
| --------------------------------- | -------------------------- |
| `NUXT_OAUTH_GOOGLE_CLIENT_ID`     | Google OAuth Client ID     |
| `NUXT_OAUTH_GOOGLE_CLIENT_SECRET` | Google OAuth Client Secret |
| `NUXT_OAUTH_GITHUB_CLIENT_ID`     | GitHub OAuth Client ID     |
| `NUXT_OAUTH_GITHUB_CLIENT_SECRET` | GitHub OAuth Client Secret |
| `NUXT_OAUTH_LINE_CLIENT_ID`       | LINE Login Channel ID      |
| `NUXT_OAUTH_LINE_CLIENT_SECRET`   | LINE Login Channel Secret  |

### 選用：Sentry Secrets

如果使用 Sentry 錯誤監控：

| Secret 名稱              | 說明                                      |
| ------------------------ | ----------------------------------------- |
| `NUXT_PUBLIC_SENTRY_DSN` | Sentry DSN                                |
| `SENTRY_AUTH_TOKEN`      | Sentry Auth Token（用於 Source Map 上傳） |
| `SENTRY_ORG`             | Sentry Organization Slug                  |
| `SENTRY_PROJECT`         | Sentry Project Slug                       |

### Variables（非機密）

在 GitHub repo → Settings → Secrets and variables → Actions → Variables 新增：

| Variable 名稱 | 說明                                                                                    | 用途                |
| ------------- | --------------------------------------------------------------------------------------- | ------------------- |
| `DEPLOY_URL`  | 部署後的網址（完整 URL 含 `https://`，不含結尾 `/`，例如 `https://my-app.workers.dev`） | 部署後的 Smoke Test |

---

## Step 4：CI/CD Workflow

專案提供 GitHub Actions workflow 範本，位於 `scripts/templates/github/.github/workflows/`。

建立新專案後，將範本複製到 `.github/workflows/`：

```bash
cp -r scripts/templates/github/.github .github
```

### CI（`ci.yml`）

觸發條件：所有 Pull Request + push 到 `main`

```
validate → lint → typecheck → unit tests
                                    ↓（僅 main branch）
                              e2e tests + database migration push
```

- **validate**：驗證 starter scaffold 結構
- **e2e**：Playwright 端對端測試（僅 `main` branch）
- **database**：推送 Migration + 驗證 table owner + lint 資料庫

### Deploy（`deploy.yml`）

觸發條件：push 到 `main` + 手動觸發

```
checkout → install → build → wrangler deploy → smoke test
```

- 支援手動選擇 `staging` / `production` 環境
- 使用 concurrency group 避免同時部署
- 部署後自動執行 Smoke Test（需設定 `DEPLOY_URL` variable）

> **DEPLOY_URL 格式**：完整 URL，包含 `https://`，不含結尾斜線。例如：`https://my-app.workers.dev` 或 `https://my-domain.com`
> 注意：`DEPLOY_URL` 是 GitHub **Variable**（Settings → Secrets and variables → Actions → Variables），不是 Secret。

> **重要**：所有環境變數透過 GitHub Secrets 管理，**禁止**直接在 Cloudflare Dashboard 設定。這確保環境變數有版本控制，且團隊成員可透過 GitHub 統一管理。

---

## 部署前檢查清單

- [ ] 所有檢查通過：`pnpm check`
- [ ] Build 成功：`pnpm build`
- [ ] 所有 GitHub Secrets 已設定（參考 Step 3）
- [ ] 資料庫 Migration 已推送：`supabase db push --linked`
- [ ] DNS 已設定（如使用自訂域名）

---

## Step 5：首次部署

### 1. 本地驗證

```bash
# 確認 build 成功
pnpm build

# 確認所有檢查通過
pnpm check
```

### 2. 推送到 GitHub

```bash
git push origin main
```

GitHub Actions 會自動執行：

1. **CI workflow**：lint → typecheck → test → database migration push
2. **Deploy workflow**：build → wrangler deploy → smoke test

### 3. 確認部署狀態

在 GitHub repo → Actions 頁面查看 workflow 執行狀態。

---

## Step 6：部署後驗證

### 驗證清單

- [ ] 應用程式在 Production URL 正常載入
- [ ] 登入/註冊流程正常運作
- [ ] API 端點回應正確（`/api/v1/profiles/me`）
- [ ] Supabase 連線正常（資料可讀取）
- [ ] OAuth 登入正常（如有設定）
- [ ] Sentry 收到事件（如有設定）

### 快速驗證指令

```bash
# 檢查應用程式是否回應
curl -I https://your-app.workers.dev

# 檢查 API 健康狀態
curl https://your-app.workers.dev/api/v1/profiles/me
```

---

## 回滾策略

### Cloudflare Workers

```bash
# 查看部署歷史
npx wrangler deployments list

# 回滾到上一個版本
npx wrangler rollback
```

### 資料庫 Migration

```bash
# 檢查 migration 狀態
supabase migration list --linked

# 標記有問題的 migration 為 reverted
supabase migration repair --status reverted <version>
```

> 資料庫回滾需要手動處理。建議在部署前備份：`pnpm db:backup`

---

## 常見部署問題

遇到問題？參考 [TROUBLESHOOTING.md](TROUBLESHOOTING.md)：

- [Cloudflare 部署失敗](TROUBLESHOOTING.md#10-cloudflare-部署失敗)
- [Wrangler 認證問題](TROUBLESHOOTING.md#18-wrangler-部署認證)
- [環境變數問題](TROUBLESHOOTING.md#23-環境變數-runtime-問題)
