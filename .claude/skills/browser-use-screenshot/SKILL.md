---
name: browser-use-screenshot
description: 截圖、看畫面、確認 UI、看一下頁面、幫我看 UI — nuxt-supabase-starter 的瀏覽器截圖流程（含自動登入）。處理 dev server 確認、認證登入（支援 better-auth 填表或 dev-login route）、頁面導航與截圖。優先於 generic browser-use skill，因為包含本專案必要的認證流程。
---

# Browser-Use 截圖調試

當使用者要求截圖、分析畫面、除錯 UI、調試介面、視覺檢查時，自動載入此流程。

使用 `browser-use` CLI，透過背景 daemon 保持瀏覽器開啟，延遲約 50ms。

---

## 觸發時機

- 使用者要求「截圖」「看一下畫面」「幫我看 UI」
- UI 實作或修正後，使用者要求確認結果
- 除錯、調試需要查看頁面狀態

---

## 前置條件（自動處理，不詢問使用者）

### 1. 確認 dev server 正在運行

```bash
# 找到本專案的 dev server 和 port
ps aux | grep -E 'nuxt-supabase-starter.*nuxt' | grep -v grep
```

- 有找到 → 從 process 資訊取得 port（預設 3000）
- 沒找到 → 自動找可用 port 並啟動：

```bash
# 找可用 port
for port in 3000 3001 3002 3003 3004; do
  lsof -iTCP:$port -sTCP:LISTEN -P >/dev/null 2>&1 || { echo $port; break; }
done

# 背景啟動（使用 Bash run_in_background）
cd /Users/charles/offline/nuxt-supabase-starter && pnpm dev --port <port>

# 等待就緒
for i in $(seq 1 30); do
  curl -s -o /dev/null -w "%{http_code}" http://localhost:<port>/ 2>/dev/null | grep -q '200' && break
  sleep 2
done
```

### 2. 認證方式

#### A. Dev-login route（推薦，適用所有 auth 模組）

若專案有 `server/routes/auth/_dev-login.get.ts`（dev-only route，`import.meta.dev` 保護）：

```bash
# 登入後直接跳轉到指定頁面（推薦用法）
browser-use open "http://localhost:<port>/auth/_dev-login?redirect=/admin"

# 指定 email
browser-use open "http://localhost:<port>/auth/_dev-login?email=user@example.com"

# 用預設 dev user 登入
browser-use open "http://localhost:<port>/auth/_dev-login"
```

**NEVER** patch auth middleware — 一律使用 dev-login route。

適用場景：nuxt-auth-utils（一律需要）、better-auth OAuth-only（無 email/password 表單）。

#### B. 填表登入（better-auth + emailAndPassword enabled）

若專案使用 better-auth 且啟用了 email/password（`server/auth.config.ts` 中 `emailAndPassword: { enabled: true }`），可直接填表：

```bash
browser-use open "http://localhost:<port>/auth/login"
browser-use state
browser-use input <email-index> "test@example.com"
browser-use input <password-index> "password"
browser-use click <submit-index>
```

若有設定 `E2E_USER_EMAIL` / `E2E_USER_PASSWORD` 環境變數，優先使用。

#### C. OAuth-only 且無 dev-login route → 需人工介入

若 better-auth 關閉 emailAndPassword、且沒有 `_dev-login` route，**無法自動化登入**。
此時必須先建立 `_dev-login` route（見下方模板）。

---

## 截圖流程

**NEVER** 直接 `browser-use open` 目標頁面 URL — 必須先完成登入。直接開頁面會被 auth middleware 導向登入頁，需要人工介入。

### Step 1：登入並導向目標頁面

```bash
# ✅ 方式 A：dev-login route（推薦，nuxt-auth-utils 或 OAuth-only better-auth）
browser-use open "http://localhost:<port>/auth/_dev-login?redirect=/目標頁面"

# ✅ 方式 B：填表登入（better-auth + emailAndPassword enabled）
browser-use open "http://localhost:<port>/auth/login?redirect=/目標頁面"
browser-use state
browser-use input <email-index> "test@example.com"
browser-use input <password-index> "password"
browser-use click <submit-index>

# ❌ 錯誤：直接開目標頁面（會被導到登入頁）
# browser-use open "http://localhost:<port>/目標頁面"
```

**如何判斷用哪種方式：**

- 有 `server/routes/auth/_dev-login.get.ts` → 方式 A
- 有 email/password 登入表單 → 方式 B
- OAuth-only 且無 dev-login route → 必須先建 dev-login route

### Step 2：等待頁面就緒（視需要）

```bash
browser-use wait text "目標文字"        # 等待特定文字出現
browser-use wait selector "css選擇器"   # 等待特定元素出現
```

### Step 3：截圖

```bash
browser-use screenshot temp/<descriptive-name>.png
```

截圖 **MUST** 存到 `temp/` 目錄（已在 `.gitignore`）。**NEVER** 存到其他位置。
使用 Playwright MCP 時同樣適用：`filename` 參數 **MUST** 以 `temp/` 開頭。

### Step 4：互動後截圖（可選）

```bash
browser-use state                              # 取得頁面元素與 index
browser-use click <index>                      # 點擊目標元素
browser-use screenshot temp/<next-state>.png   # 截圖新狀態
```

---

## UI 實作/修正後截圖

1. **跳過已完成的前置條件** — 若同一 conversation 已登入過，browser-use session 仍有效，直接截圖
2. **針對修改的頁面截圖** — 根據剛才修改的檔案推斷目標頁面路徑
3. **截圖前後對比** — 如果是修正 bug，先描述預期變化再截圖確認

---

## 常用命令速查

| 用途       | 命令                               |
| ---------- | ---------------------------------- |
| 開啟頁面   | `browser-use open <url>`           |
| 頁面狀態   | `browser-use state`                |
| 點擊元素   | `browser-use click <index>`        |
| 截圖       | `browser-use screenshot <path>`    |
| 等待文字   | `browser-use wait text "文字"`     |
| 等待元素   | `browser-use wait selector "css"`  |
| 輸入文字   | `browser-use input <index> "文字"` |
| 按鍵       | `browser-use keys "Enter"`         |
| 捲動       | `browser-use scroll down`          |
| 執行 JS    | `browser-use eval "js code"`       |
| 視窗大小   | **不支援**（固定 1920x1080）       |
| 關閉瀏覽器 | `browser-use close`                |

> **響應式截圖（行動版/平板）必須用 Playwright MCP**：browser-use CLI 無法調整視窗大小，
> `eval` 只能執行瀏覽器端 JS，無法呼叫 Playwright 的 `page.setViewportSize()`。
> 需要不同尺寸截圖時，改用 `browser_navigate` → `browser_resize` → `browser_take_screenshot`。

---

## 清理（MUST）

截圖流程結束後（所有截圖都完成、不再需要瀏覽器），**MUST** 關閉瀏覽器：

```bash
browser-use close   # 關閉 browser-use session
```

若使用 Playwright MCP，則呼叫 `browser_close`。

**不關閉瀏覽器會持續佔用系統資源，這是強制要求。**

- dev server 是 Claude Code 啟動的 → 工作結束時 `kill <pid>` 停止
- dev server 是使用者原本在跑的 → **不要停止**

---

## Dev-login route 模板

OAuth-only 專案（無 email/password 表單）必須建立 dev-login route 才能自動化截圖。

### nuxt-auth-utils 版

```typescript
// server/routes/auth/_dev-login.get.ts
export default defineEventHandler(async (event) => {
  // Production 禁用
  if (!import.meta.dev) {
    throw createError({ statusCode: 404 })
  }

  const { email = 'dev@localhost', redirect: redirectTo = '/' } = getQuery(event)

  await setUserSession(event, {
    user: {
      id: 'dev-user-001',
      email: email as string,
      name: 'Dev User',
      provider: 'test',
      providerId: 'dev-001',
    },
    loggedInAt: Date.now(),
  })

  return sendRedirect(event, redirectTo as string)
})
```

### better-auth 版

```typescript
// server/routes/auth/_dev-login.get.ts
import { auth } from '~~/server/utils/auth'

export default defineEventHandler(async (event) => {
  // Production 禁用
  if (!import.meta.dev) {
    throw createError({ statusCode: 404 })
  }

  const { email = 'dev@localhost', redirect: redirectTo = '/' } = getQuery(event)

  const password = process.env.E2E_USER_PASSWORD || 'dev-password'

  // 透過 better-auth internal API 建立 session
  const ctx = await auth.api.signInEmail({
    body: { email: email as string, password },
    asResponse: false,
  })

  if (!ctx?.token) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Dev login failed - ensure test account exists',
    })
  }

  // 設定 session cookie
  setCookie(event, 'better-auth.session_token', ctx.token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  })

  return sendRedirect(event, redirectTo as string)
})
```

> **注意：** better-auth 版需要預先建立測試帳號（seed 或 migration）。nuxt-auth-utils 版不需要，因為 session 是 stateless cookie。

---

## 常見問題

| 問題                | 解法                                                     |
| ------------------- | -------------------------------------------------------- |
| 被導向登入頁        | 確認有走登入流程（dev-login 或填表），不要直接開目標頁面 |
| OAuth-only 無法登入 | 建立 `_dev-login` route（見上方模板）                    |
| 頁面內容為空        | 確認 URL 正確、用 `browser-use state` 檢查頁面狀態       |
| 瀏覽器無法啟動      | `browser-use close` 後重試，或 `browser-use doctor` 檢查 |
| 元素找不到          | `browser-use scroll down` 後重新 `browser-use state`     |
| Dev server stale    | 重啟 dev server；若仍有問題，刪除 `.nuxt/` 後重啟        |
