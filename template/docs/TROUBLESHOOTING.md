# 疑難排解指南

依照「症狀」分類，格式：**問題** → **可能原因** → **診斷指令** → **解決方案**。

---

## 快速查找

| #   | 症狀關鍵字                      | 連結                              |
| --- | ------------------------------- | --------------------------------- |
| 1   | `supabase start` 失敗、Docker   | [→](#1-supabase-start-失敗)       |
| 2   | `pnpm dev` 無法啟動、port       | [→](#2-pnpm-dev-無法啟動)         |
| 3   | 型別產生失敗、`db:types`        | [→](#3-型別產生失敗)              |
| 4   | OAuth callback 錯誤             | [→](#4-oauth-callback-錯誤)       |
| 5   | RLS 拒絕存取、permission denied | [→](#5-rls-拒絕存取)              |
| 6   | Migration 部署失敗、table owner | [→](#6-migration-部署失敗)        |
| 7   | `pnpm install` 失敗             | [→](#7-pnpm-install-失敗)         |
| 8   | CORS 錯誤                       | [→](#8-cors-錯誤)                 |
| 9   | Auth session 不保持             | [→](#9-auth-session-不保持)       |
| 10  | Cloudflare 部署失敗             | [→](#10-cloudflare-部署失敗)      |
| 11  | Migration repair、reverted      | [→](#11-migration-repair)         |
| 12  | Nuxt hydration mismatch         | [→](#12-nuxt-hydration-mismatch)  |
| 13  | Auth token 過期、session 失效   | [→](#13-auth-token-過期)          |
| 14  | N+1 查詢、效能慢                | [→](#14-n1-查詢問題)              |
| 15  | Supabase emulator email 驗證    | [→](#15-supabase-emulator-quirks) |
| 16  | `pnpm check` 個別步驟失敗       | [→](#16-pnpm-check-步驟失敗)      |
| 17  | TypeScript strict 型別錯誤      | [→](#17-typescript-strict-錯誤)   |
| 18  | Wrangler 部署認證失敗           | [→](#18-wrangler-部署認證)        |
| 19  | Hot reload 不生效               | [→](#19-hot-reload-不生效)        |
| 20  | 資料庫連線池耗盡                | [→](#20-連線池耗盡)               |
| 21  | 新表缺少 RLS                    | [→](#21-新表缺少-rls)             |
| 22  | Seed data 未載入                | [→](#22-seed-data-未載入)         |
| 23  | 環境變數 runtime 無法取得       | [→](#23-環境變數-runtime-問題)    |
| 24  | Nuxt module 相容性錯誤          | [→](#24-nuxt-module-相容性)       |
| 25  | Git hook (Vite+) 失敗           | [→](#25-git-hook-失敗)            |

---

## 1. `supabase start` 失敗

### 1a. Docker 未啟動

**問題：** 出現 "Cannot connect to the Docker daemon" 錯誤。

**診斷：**

```bash
docker info
```

- 問題存在：`ERROR: Cannot connect to the Docker daemon...`
- 正常：顯示 `Server: Containers: ...` 等資訊

**修復：**

```bash
open -a Docker          # macOS 啟動 Docker Desktop
supabase start          # 等 Docker 完全啟動後再執行
```

### 1b. Port 衝突（54321 / 54322）

**問題：** 回報 port 已被佔用。

**診斷：**

```bash
lsof -i :54321
lsof -i :54322
```

- 問題存在：顯示佔用 port 的 process 及 PID
- 正常：無輸出

**修復：**

```bash
kill -9 <PID>           # 終止佔用的 process
# 或
supabase stop && supabase start   # 清除舊實例
```

---

## 2. `pnpm dev` 無法啟動

### 2a. 缺少 .env 檔案

**問題：** 環境變數未定義的錯誤。

**診斷：**

```bash
ls -la .env
```

- 問題存在：`No such file or directory`
- 正常：顯示檔案資訊

**修復：**

```bash
cp .env.example .env
# 填入必要值：
#   SUPABASE_URL=http://127.0.0.1:54321
#   SUPABASE_KEY=<從 supabase status 取得>
#   SUPABASE_SECRET_KEY=<從 supabase status 取得>
#   BETTER_AUTH_SECRET=<openssl rand -base64 32>
#   NUXT_SESSION_PASSWORD=<openssl rand -base64 32>
```

### 2b. Port 3000 被佔用

**問題：** "Port 3000 is already in use"。

**診斷：**

```bash
lsof -i :3000
```

- 問題存在：顯示佔用 port 的 node process
- 正常：無輸出

**修復：**

```bash
kill -9 <PID>                # 終止佔用的 process
# 或
pnpm dev -- --port 3001     # 使用其他 port
```

### 2c. 依賴未安裝

**問題：** "Cannot find module" 錯誤。

**診斷：**

```bash
ls node_modules/.pnpm | head -5
```

- 問題存在：`No such file or directory`
- 正常：列出套件目錄

**修復：**

```bash
pnpm install
```

---

## 3. Type generation 失敗（`pnpm db:types`）

### 3a. Supabase 未啟動

**問題：** 回報連線失敗。

**診斷：**

```bash
supabase status
```

- 問題存在：`Error: not running`
- 正常：顯示 API URL、DB URL、Studio URL 等

**修復：**

```bash
supabase start
pnpm db:types
```

### 3b. Migration 有語法錯誤

**問題：** 產生的型別不正確，或 migration 無法套用。

**診斷：**

```bash
supabase db reset
```

- 問題存在：`Error: syntax error at or near "..."` 並指出 migration 檔案
- 正常：`Finished supabase db reset.`

**修復：** 修正對應 migration 的 SQL 語法，再執行：

```bash
supabase db reset && supabase db lint --level warning && pnpm db:types && pnpm typecheck
```

---

## 4. OAuth callback 錯誤

### 4a. Redirect URI 不匹配

**問題：** OAuth 登入後收到 "redirect_uri_mismatch" 錯誤。

**診斷：**

```bash
grep NUXT_PUBLIC_SITE_URL .env
```

- 問題存在：值為空，或與 OAuth provider console 設定不一致
- 正常：`NUXT_PUBLIC_SITE_URL=http://localhost:3000`

**修復：**

1. `.env` 中 `NUXT_PUBLIC_SITE_URL` 填入正確值
2. OAuth provider console 的 redirect URI 設為：`{NUXT_PUBLIC_SITE_URL}/api/auth/callback/{provider}`
   - Google: https://console.cloud.google.com/apis/credentials
   - GitHub: https://github.com/settings/developers
   - LINE: https://developers.line.biz/console/

### 4b. OAuth credentials 未設定

**問題：** 點擊 OAuth 登入按鈕後出現 400 錯誤。

**診斷：**

```bash
grep NUXT_OAUTH_GOOGLE .env     # 以 Google 為例
```

- 問題存在：`NUXT_OAUTH_GOOGLE_CLIENT_ID=`（空值）
- 正常：`NUXT_OAUTH_GOOGLE_CLIENT_ID=123456789.apps.googleusercontent.com`

**修復：** 到對應的 OAuth provider console 取得 credentials，填入 `.env`。

---

## 5. RLS 拒絕存取

### 5a. 缺少 `service_role` bypass

**問題：** Server API 呼叫 Supabase 時回傳 403 或空結果。

**診斷：**

```bash
supabase db lint --level warning
```

另可在 Supabase Studio (http://127.0.0.1:54323) SQL Editor 查詢 policy：

```sql
SELECT schemaname, tablename, policyname, qual
FROM pg_policies WHERE tablename = '<table_name>';
```

- 問題存在：policy 的 `qual` 欄位缺少 `service_role` 條件
- 正常：包含 `(SELECT auth.role()) = 'service_role' OR <user_condition>`

**修復：**

```bash
supabase migration new fix_rls_policy
```

在產生的 migration 檔案中：

```sql
DROP POLICY IF EXISTS "policy_name" ON public.table_name;
CREATE POLICY "policy_name" ON public.table_name
  FOR ALL USING (
    (SELECT auth.role()) = 'service_role' OR auth.uid() = user_id
  );
```

### 5b. Client 端嘗試寫入

**問題：** Client 端 `.insert()` / `.update()` / `.delete()` 被 RLS 拒絕。

**診斷：** 瀏覽器 DevTools Network tab 顯示：`"code": "42501", "new row violates row-level security policy..."`

**修復：** Client 端禁止寫入，改用 server API：`Client → /api/v1/xxx` (`service_role`) `→ Supabase`

---

## 6. Migration 部署失敗

### 6a. Table owner 不是 postgres

**問題：** CI/CD 部署 migration 時權限不足。

**診斷：**

```sql
SELECT tablename, tableowner FROM pg_tables WHERE schemaname = 'public';
```

- 問題存在：`tableowner` 為 `supabase_admin`
- 正常：`tableowner` 為 `postgres`

**修復：** `ALTER TABLE public.table_name OWNER TO postgres;`

**預防：** 所有 DDL 必須透過 migration + CI/CD，禁止透過 MCP 建表。

### 6b. 用 MCP 建表導致 owner 錯誤

**問題：** 透過 MCP remote database 建立的 table 在 CI/CD 時衝突。

**診斷：**

```sql
SELECT tablename, tableowner FROM pg_tables
WHERE schemaname = 'public' AND tableowner != 'postgres';
```

- 問題存在：列出 owner 非 postgres 的 table
- 正常：空結果

**修復：** 刪除 MCP 建的 table，改用 migration 重建：

```bash
supabase migration new create_table_name   # 編輯 .sql 寫入 CREATE TABLE
supabase db reset && supabase db lint --level warning && pnpm db:types
```

---

## 7. `pnpm install` 失敗

### 7a. Node.js 版本不對

**問題：** 引擎版本不相容錯誤。

**診斷：**

```bash
node -v
```

- 問題存在：`v18.x.x` 或更低
- 正常：`v20.x.x` 或更高

**修復：**

```bash
nvm install 20 && nvm use 20    # 或 fnm install 20 && fnm use 20
pnpm install
```

### 7b. Lockfile 衝突

**問題：** lockfile 衝突或 checksum 錯誤。

**診斷：** `pnpm install` 輸出：

- 問題存在：`ERR_PNPM_OUTDATED_LOCKFILE` 或 `ERR_PNPM_LOCKFILE_BREAKING_CHANGE`
- 正常：安裝成功

**修復：**

```bash
rm pnpm-lock.yaml && pnpm install
```

---

## 8. CORS 錯誤

### 8a. Supabase URL 設錯

**問題：** 瀏覽器 console 出現 CORS 錯誤。

**診斷：**

```bash
grep SUPABASE_URL .env
```

- 問題存在：指向遠端 `https://xxx.supabase.co` 或使用 `localhost`
- 正常：`SUPABASE_URL=http://127.0.0.1:54321`

**修復：** 修改 `.env`：

```
SUPABASE_URL=http://127.0.0.1:54321
NUXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
```

### 8b. nuxt-security CSP 阻擋請求

**問題：** 瀏覽器 console 出現 `Refused to connect... violates Content Security Policy`。

**診斷：**

```bash
grep -A 20 "contentSecurityPolicy" nuxt.config.ts
```

**修復：** 在 `nuxt.config.ts` 的 `security.headers.contentSecurityPolicy` 加入：

```ts
'connect-src': ["'self'", process.env.SUPABASE_URL],
```

---

## 9. Auth session 不保持

### 9a. SSR cookies 未啟用

**問題：** 重新整理頁面後登出，或 server API 無法取得 session。

**診斷：**

```bash
grep -A 3 "supabase:" nuxt.config.ts
```

- 問題存在：`useSsrCookies: false` 或設定不存在
- 正常：`useSsrCookies: true`

**修復：** 確認 `nuxt.config.ts` 中 `supabase: { useSsrCookies: true, redirect: false }`。

### 9b. BETTER_AUTH_SECRET 未設定

**問題：** Auth 功能異常，token 驗證失敗。

**診斷：**

```bash
grep BETTER_AUTH_SECRET .env
grep NUXT_SESSION_PASSWORD .env
```

- 問題存在：值為空
- 正常：值為 32+ 字元的隨機字串

**修復：**

```bash
openssl rand -base64 32    # 產生 secret，分別填入兩個變數
```

---

## 10. Cloudflare 部署失敗

### 10a. wrangler 未安裝或未登入

**問題：** 部署指令失敗，未授權。

**診斷：**

```bash
npx wrangler whoami
```

- 問題存在：`Error: You are not authenticated.`
- 正常：顯示登入的 email

**修復：**

```bash
npx wrangler login
```

### 10b. 環境變數未在 GitHub Secrets 設定

**問題：** CI/CD 部署成功但應用程式 500 錯誤。

**診斷：**

```bash
gh run list --limit 5 && gh run view <run-id> --log-failed
```

- 問題存在：log 出現 `Missing required environment variable`
- 正常：部署成功無錯誤

**修復：** GitHub repo → **Settings** → **Secrets and variables** → **Actions**，新增：
`SUPABASE_URL`、`SUPABASE_KEY`、`SUPABASE_SECRET_KEY`、`BETTER_AUTH_SECRET`、`NUXT_SESSION_PASSWORD`、`NUXT_PUBLIC_SITE_URL`。

確認 `.github/workflows/deploy.yml` 有傳遞這些變數。**禁止**直接在 Cloudflare Dashboard 設定。

---

## 快速檢查清單

開發環境出問題時，依序執行：

```bash
docker info > /dev/null 2>&1 && echo "Docker: OK" || echo "Docker: 未啟動"
supabase status > /dev/null 2>&1 && echo "Supabase: OK" || echo "Supabase: 未啟動"
[ -f .env ] && echo ".env: OK" || echo ".env: 不存在"
node -v | grep -qE "^v(1[89]|[2-9][0-9])" && echo "Node: OK" || echo "Node: 需要 v18+"
[ -d node_modules ] && echo "node_modules: OK" || echo "node_modules: 需要 pnpm install"
grep -q "BETTER_AUTH_SECRET=." .env 2>/dev/null && echo "BETTER_AUTH_SECRET: OK" || echo "BETTER_AUTH_SECRET: 未設定"
grep -q "SUPABASE_URL=." .env 2>/dev/null && echo "SUPABASE_URL: OK" || echo "SUPABASE_URL: 未設定"
```

---

## 11. Migration repair

### 11a. 遠端 migration 被 revert

**問題：** 遠端資料庫的 migration 狀態為 `reverted`，導致 `supabase db push` 失敗。

**診斷：**

```bash
supabase migration list --db-url <remote_db_url>
```

- 問題存在：某些 migration 的 Status 欄位顯示 `reverted`
- 正常：所有 migration 為 `applied`

**修復：**

```bash
supabase migration repair --status reverted <version> --db-url <remote_db_url>
# <version> 為 migration 的時間戳，例如 20240101000000
supabase db push --db-url <remote_db_url>   # 重新套用
```

**注意：** 修復前請確認該 migration 的 SQL 與遠端 schema 不衝突。若衝突，需先手動清理遠端 schema。

---

## 12. Nuxt hydration mismatch

### 12a. Client/Server HTML 不一致

**問題：** Console 出現 `Hydration text/node mismatch` 警告，頁面閃爍。

**診斷：**

```bash
# 開啟 DevTools Console，搜尋以下關鍵字
# "Hydration" / "mismatch" / "Expected server rendered"
```

- 問題存在：出現黃色或紅色 hydration 相關警告
- 正常：Console 無此類警告

**常見原因：**

- 瀏覽器擴充套件注入 HTML（如 Grammarly、翻譯套件）
- 使用 `Date.now()`、`Math.random()` 等非確定性值
- `v-if` 條件在 server/client 結果不同

**修復：**

```vue
<!-- 方法一：ClientOnly 包裝非確定性內容 -->
<ClientOnly>
  <MyDynamicComponent />
  <template #fallback>
    <div>載入中...</div>
  </template>
</ClientOnly>

<!-- 方法二：使用 useId() 確保一致性 -->
<script setup>
  const id = useId()
</script>
```

---

## 13. Auth token 過期

### 13a. Session 過期時間設定

**問題：** 使用者反映登入後一段時間自動登出，或 API 回傳 401。

**診斷：**

```bash
grep -A 5 "session" nuxt.config.ts
grep BETTER_AUTH_SECRET .env
```

- 問題存在：`session.maxAge` 設定過短，或 `BETTER_AUTH_SECRET` 為空
- 正常：`maxAge` 為合理值（例如 `604800` = 7 天），`BETTER_AUTH_SECRET` 有值

**修復：**

```ts
// nuxt.config.ts
betterAuth: {
  session: {
    maxAge: 60 * 60 * 24 * 7, // 7 天
  },
}
```

### 13b. BETTER_AUTH_SECRET 更換後 session 失效

**問題：** 更換 `BETTER_AUTH_SECRET` 後所有使用者被登出。

**修復：** 這是預期行為。更換 secret 會使所有已簽發的 token 失效。部署新 secret 後，使用者需重新登入。建議在低流量時段進行更換。

---

## 14. N+1 查詢問題

### 14a. 偵測 N+1 查詢

**問題：** 頁面載入緩慢，Supabase Studio 的 SQL logs 顯示大量相似查詢。

**診斷：**

```bash
supabase db lint --level warning
```

另可在 Supabase Studio (http://127.0.0.1:54323) 的 Logs 頁面觀察查詢模式：

- 問題存在：相同 table 的 SELECT 在短時間內重複數十次
- 正常：使用 JOIN 的單一查詢取回所有資料

**修復：**

```ts
// 錯誤：先查詢 posts，再逐一查詢 author（N+1）
const { data: posts } = await client.from('posts').select('*')
for (const post of posts) {
  const { data: author } = await client.from('users').select('*').eq('id', post.user_id)
}

// 正確：使用關聯查詢一次取回
const { data: posts } = await client.from('posts').select('*, user:users(*)')
```

---

## 15. Supabase emulator quirks

### 15a. 本機 email 驗證行為不同

**問題：** 本機開發時 email 驗證沒有寄信，或驗證連結無效。

**診斷：**

```bash
# 確認 Inbucket（本機 email 服務）是否運行
curl -s http://127.0.0.1:54324 | head -5
```

- 問題存在：`Connection refused`
- 正常：回傳 HTML 內容

**修復：** 本機環境中，email 驗證信會送到 Inbucket。打開 http://127.0.0.1:54324 查看所有發送的 email。

### 15b. 本機 rate limit 與正式環境不同

**問題：** 本機測試正常但正式環境回傳 429 Too Many Requests。

**修復：** 本機 emulator 預設無 rate limit。正式環境有以下限制：

- Email 登入：每小時 30 次
- OAuth：每小時 30 次
- API 呼叫：依 Supabase 方案而定

測試時應模擬 rate limit 場景，避免上線後才發現問題。

---

## 16. `pnpm check` 步驟失敗

### 16a. 辨識失敗步驟

**問題：** `pnpm check` 失敗，但不確定是哪一步（lint / fmt / test / typecheck）。

**診斷：**

```bash
# 逐步執行，找出失敗步驟
vp fmt --check       # Step 1: 格式檢查
vp lint              # Step 2: Lint
pnpm typecheck       # Step 3: 型別檢查
vp test              # Step 4: 測試
```

- 問題存在：某個步驟回傳非零 exit code
- 正常：所有步驟通過

**修復：**

```bash
vp fmt               # 若 fmt --check 失敗，自動修正格式
vp lint --fix        # 若 lint 失敗，自動修正可修的問題
# typecheck / test 失敗則需手動修正程式碼
```

### 16b. 首次 scaffold 專案出現環境 warning（是否阻塞）

**問題：** 新建立的專案執行 `pnpm typecheck` 或 `pnpm check` 時看到 warning，不確定是否要中止。

**診斷：**

```bash
pnpm typecheck
pnpm test
pnpm check
echo $?   # 查看上一個指令 exit code
```

- 預期 warning（可先繼續）：
  - Supabase URL/Key 尚未設定
  - `NUXT_PUBLIC_SITE_URL` 使用 localhost
  - SEO/SSR 的部署情境提醒
- 阻塞問題（需先修）：
  - 任一指令 exit code 非 0
  - lint/format/typecheck/test 實際失敗

**修復：**

- 若是預期 warning：先繼續開發流程，待部署前補齊 `.env` 與站點設定
- 若是阻塞問題：回到對應步驟（fmt/lint/typecheck/test）逐一修正

---

## 17. TypeScript strict 錯誤

### 17a. 常見 strict 型別問題

**問題：** `pnpm typecheck` 出現大量型別錯誤。

**診斷：**

```bash
pnpm typecheck 2>&1 | head -30
```

- 問題存在：顯示 `TS2322`、`TS7006`、`TS2531` 等錯誤
- 正常：`✔ No type errors found`

**常見錯誤與修復：**

```ts
// TS7006: Parameter 'x' implicitly has an 'any' type
// 修復：明確標註型別
function handle(event: MouseEvent) { ... }

// TS2531: Object is possibly 'null'
// 修復：加入 null 檢查
const user = useUserSession()
if (user.data.value) {
  console.log(user.data.value.email)
}

// TS2322: Type 'string | undefined' is not assignable to type 'string'
// 修復：使用 nullish coalescing 或 non-null assertion
const name = user.name ?? 'Anonymous'
```

---

## 18. Wrangler 部署認證

### 18a. Wrangler 認證失敗

**問題：** 部署到 Cloudflare Workers 時出現認證錯誤。

**診斷：**

```bash
npx wrangler whoami
```

- 問題存在：`Error: You are not authenticated.`
- 正常：顯示登入的 email 與 account 資訊

**修復：**

```bash
npx wrangler login           # 互動式登入（本機開發）
```

### 18b. CI/CD 的 Wrangler 認證

**問題：** GitHub Actions 部署失敗，log 顯示 Wrangler 認證錯誤。

**診斷：**

```bash
gh secret list | grep CLOUDFLARE
```

- 問題存在：`CLOUDFLARE_API_TOKEN` 不在列表中
- 正常：列出 `CLOUDFLARE_API_TOKEN`

**修復：**

1. 到 Cloudflare Dashboard → My Profile → API Tokens → Create Token
2. 選擇 "Edit Cloudflare Workers" template
3. GitHub repo → Settings → Secrets → 新增 `CLOUDFLARE_API_TOKEN`

---

## 19. Hot reload 不生效

### 19a. 檔案不在 auto-import 路徑

**問題：** 修改檔案後瀏覽器未自動更新。

**診斷：**

```bash
# 確認檔案路徑是否在 Nuxt 監視範圍
ls app/composables/ app/components/ app/pages/ server/
```

- 問題存在：檔案放在自訂目錄但未在 `nuxt.config.ts` 註冊
- 正常：檔案在標準 Nuxt 目錄結構中

**修復：** 確認檔案在正確位置，或在 `nuxt.config.ts` 加入自訂路徑：

```ts
// nuxt.config.ts
imports: {
  dirs: ['utils', 'custom-dir'],
},
```

### 19b. `.nuxt` 快取過期

**問題：** 修改 `nuxt.config.ts` 或安裝新套件後 hot reload 異常。

**診斷：**

```bash
ls -la .nuxt/
```

- 問題存在：`.nuxt` 目錄存在且有過期的快取檔案
- 正常：重新建立後的 `.nuxt` 目錄

**修復：**

```bash
rm -rf .nuxt && pnpm dev
```

---

## 20. 連線池耗盡

### 20a. 資料庫連線數超限

**問題：** API 回傳 `FATAL: too many connections for role` 或回應極慢。

**診斷：**

```sql
-- 在 Supabase Studio SQL Editor 執行
SELECT count(*) FROM pg_stat_activity;
SELECT max_conn FROM pg_settings WHERE name = 'max_connections';
```

- 問題存在：活躍連線數接近或等於 `max_connections`
- 正常：活躍連線數遠低於上限

**修復：**

1. 使用 connection pooler（Supabase 的 pgbouncer，port 6543）：

```
# .env
DATABASE_URL=postgres://postgres:[password]@db.[project].supabase.co:6543/postgres
```

2. 檢查是否有未關閉的連線：

```sql
SELECT pid, state, query_start, query FROM pg_stat_activity
WHERE state != 'idle' ORDER BY query_start;
```

---

## 21. 新表缺少 RLS

### 21a. 建表後忘記啟用 RLS

**問題：** 新建的 table 任何人都能存取，沒有權限控制。

**診斷：**

```bash
supabase db lint --level warning
```

- 問題存在：`WARNING: table "xxx" is not protected by RLS`
- 正常：無 RLS 相關警告

**修復：** 建立新 migration 補上 RLS：

```bash
supabase migration new enable_rls_for_xxx
```

在 migration 檔案中加入：

```sql
ALTER TABLE public.xxx ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_bypass" ON public.xxx
  FOR ALL USING (
    (SELECT auth.role()) = 'service_role'
  );

CREATE POLICY "users_read_own" ON public.xxx
  FOR SELECT USING (
    auth.uid() = user_id
  );
```

---

## 22. Seed data 未載入

### 22a. seed.sql 未執行

**問題：** `supabase db reset` 後 table 存在但沒有測試資料。

**診斷：**

```bash
ls -la supabase/seed.sql
```

- 問題存在：檔案不存在，或檔案為空
- 正常：檔案存在且包含 INSERT 語句

**修復：**

```bash
# 確認 seed.sql 存在且語法正確
supabase db reset    # seed.sql 在所有 migration 套用後自動執行
```

### 22b. seed.sql 語法錯誤

**問題：** `supabase db reset` 執行到 seed 階段時失敗。

**診斷：**

```bash
supabase db reset 2>&1 | grep -A 3 "seed"
```

- 問題存在：`Error: error executing seed: ...` 後面接 SQL 語法錯誤
- 正常：`Seeding data supabase/seed.sql...` 後無錯誤

**修復：** 檢查 `supabase/seed.sql` 的語法，常見問題：

- 引用了不存在的 table（migration 順序問題）
- 資料與 constraint 衝突（如 unique、foreign key）

---

## 23. 環境變數 runtime 問題

### 23a. Cloudflare Workers 無法讀取環境變數

**問題：** 本機正常但部署到 Cloudflare Workers 後 `process.env.XXX` 為 `undefined`。

**診斷：**

```bash
grep -r "process\.env\." server/
```

- 問題存在：server 程式碼中直接使用 `process.env`
- 正常：使用 `useRuntimeConfig()`

**修復：**

```ts
// 錯誤：Cloudflare Workers 無 process.env
const apiKey = process.env.API_KEY

// 正確：使用 Nuxt runtimeConfig
const config = useRuntimeConfig()
const apiKey = config.apiKey
```

確認 `nuxt.config.ts` 有對應的 `runtimeConfig` 設定：

```ts
// nuxt.config.ts
runtimeConfig: {
  apiKey: '',  // 對應 NUXT_API_KEY 環境變數
  public: {
    siteUrl: '', // 對應 NUXT_PUBLIC_SITE_URL 環境變數
  },
},
```

---

## 24. Nuxt module 相容性

### 24a. Module 版本衝突

**問題：** 安裝或更新 Nuxt module 後出現相容性錯誤。

**診斷：**

```bash
npx nuxi info
```

- 問題存在：顯示的 module 版本間有衝突，或 Nuxt 版本與 module 不相容
- 正常：所有 module 版本相容

**修復：**

```bash
# 檢查哪些套件有可用更新
pnpm outdated

# 鎖定特定版本避免衝突
# package.json 中將 "^x.y.z" 改為 "x.y.z"（移除 ^）

# 更新後清除快取重啟
rm -rf .nuxt node_modules/.cache && pnpm install && pnpm dev
```

---

## 25. Git hook 失敗

### 25a. Vite+ hook 無執行權限

**問題：** `git commit` 時出現 `permission denied` 或 hook 未觸發。

**診斷：**

```bash
ls -la .vite-hooks/pre-commit
```

- 問題存在：權限欄位未包含 `x`（如 `-rw-r--r--`）
- 正常：權限包含 `x`（如 `-rwxr-xr-x`）

**修復：**

```bash
chmod +x .vite-hooks/pre-commit
chmod +x .vite-hooks/commit-msg
```

### 25b. Vite+ hooks 未正確安裝

**問題：** Hook 完全沒有觸發。

**診斷：**

```bash
git config core.hooksPath
```

- 問題存在：輸出為空或指向錯誤路徑
- 正常：`.vite-hooks/_`

**修復：**

```bash
pnpm prepare    # 重新執行 vp config 安裝 hooks
```
