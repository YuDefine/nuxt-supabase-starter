# 部署指南

從開發到 Production 的完整部署流程（Cloudflare Workers）。

---

## 前置條件

- Cloudflare 帳號（免費方案即可）
- GitHub 帳號（用於 CI/CD）
- Supabase Cloud 專案（或 Self-hosted）

---

## Step 1：設定 Supabase Production

1. 前往 [Supabase Dashboard](https://supabase.com/dashboard) 建立新專案
2. 取得連線資訊：
   - `SUPABASE_URL`：Project Settings → API → Project URL
   - `SUPABASE_KEY`：Project Settings → API → anon public key
   - `SUPABASE_SECRET_KEY`：Project Settings → API → service_role key
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

專案提供 GitHub Actions workflow 範本，位於 `docs/templates/.github/workflows/`。

建立新專案後，將範本複製到 `.github/workflows/`：

```bash
cp -r docs/templates/.github .github
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
