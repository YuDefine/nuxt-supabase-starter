# 開發手冊

> 此手冊是專案的單一事實來源：說明架構、開發流程、資料庫政策與程式風格。所有其他文件皆以本手冊為延伸補充。

---

## 1. 系統概覽

- **技術堆疊**：Nuxt 4 (SPA/SSR off)、Vue 3 `<script setup>`、TypeScript、Tailwind CSS、Nuxt UI、Pinia、Supabase（Postgres + Storage）。
- **模組定位**
  - Nuxt：所有元件採 Composition API，UI 走 Nuxt UI 組件 + Tailwind token。
  - Supabase：唯一資料來源。Migration 使用 Local-First 開發流程。
  - Pinia：集中狀態（使用者偏好等），禁止在頁面內直接呼叫 Supabase 查詢後儲存在 `useState`。

---

## 2. 目錄速查

```
app/            Nuxt 應用（layouts、pages、components、middleware、plugins）
server/api/     Nuxt server routes，僅呼叫 Supabase 或其他 API
supabase/       Migrations、seed、備份、Supabase CLI 設定
scripts/        CLI helper（db:backup、db:reset 等）
docs/verify/    穩定文件（本手冊、Quick Start、DB 操作、Auth、State ...）
```

**必讀文件**

| 類別       | 文件                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------- |
| Onboarding | [QUICK_START](../QUICK_START.md)                                                                                    |
| Supabase   | [SUPABASE_MIGRATION_GUIDE](./SUPABASE_MIGRATION_GUIDE.md), [DATABASE_OPTIMIZATION](./DATABASE_OPTIMIZATION.md)     |
| 認證/授權  | [AUTH_INTEGRATION](./AUTH_INTEGRATION.md)                                                                           |
| 環境變數   | [ENVIRONMENT_VARIABLES](./ENVIRONMENT_VARIABLES.md)                                                                 |
| API 設計   | [API_DESIGN_GUIDE](./API_DESIGN_GUIDE.md)                                                                           |
| 前端狀態   | [PINIA_ARCHITECTURE](./PINIA_ARCHITECTURE.md)                                                                       |
| RLS 規範   | [RLS_BEST_PRACTICES](./RLS_BEST_PRACTICES.md)                                                                       |

---

## 3. 認證與 Supabase 模組規範

1. **認證架構**：使用 `@onmax/nuxt-better-auth` 進行認證。
   - OAuth 登入：透過 `signIn.social({ provider: 'google' })` 等方式
   - Session 管理：`useUserSession()` composable
   - Server 端驗證：`requireUserSession(event)`
2. **Supabase 模組**：使用 `@nuxtjs/supabase` 進行資料庫操作。
   - Server 端使用 Service Role Client
   - Client 端僅執行讀取查詢
3. **環境變數命名**（詳見 [ENVIRONMENT_VARIABLES](./ENVIRONMENT_VARIABLES.md)）
   - OAuth：`NUXT_OAUTH_*_CLIENT_ID`、`NUXT_OAUTH_*_CLIENT_SECRET`
   - Supabase：`SUPABASE_URL`、`SUPABASE_KEY`、`SUPABASE_SERVICE_ROLE_KEY`
4. **資料庫同步**
   - 本機：`supabase db reset` → 重建資料庫 + 套用 migrations
   - 遠端：`supabase db push`（由 CI/CD 處理）

---

## 4. 開發流程

| 階段      | 說明                                                                                 |
| --------- | ------------------------------------------------------------------------------------ |
| Plan      | 梳理需求、更新 `docs/verify` 如有新規範、確認無人正在修改相同模組。                  |
| Implement | 遵守本手冊與相關專章（Auth/DB/State）。Nuxt 組件務必以 `<script setup>` + Tailwind。 |
| Stage     | `git add` 前先跑 `pnpm lint && pnpm typecheck`（若時間緊可至少跑 lint）。            |
| Review    | 自我 review diff，確認 migrations/Docs 一起更新，再送 PR。                           |

**開發環境指令**

| 指令             | 用途                               |
| ---------------- | ---------------------------------- |
| `pnpm dev`       | 啟動 Nuxt（.env.local 會自動載入） |
| `pnpm check`     | 執行 format → lint → typecheck → test |
| `supabase db reset` | 重建本機 Supabase              |
| `supabase db lint` | 檢查 search_path、RLS 等安全規範 |

---

## 5. 程式風格與最佳實踐

1. **Vue / Nuxt**
   - `<script setup lang="ts">`、Composition API only。
   - 模板綁定寫法：`<Component :prop />`、slot 使用 `<template #default>`.
   - 樣式一律使用 Tailwind token，不寫自訂色碼。
   - 函式命名：一般函式使用 `function doSomething() {}`；箭頭函式只放在 callback。
   - `watch`/`watchEffect` 需要 `try/catch` 捕捉 Supabase error，顯示 toast 或 console。
2. **Pinia**
   - Store 用 `defineStore` + `storeToRefs`。
   - 將 Supabase 呼叫集中在 store 或 server API，不在頁面散落 fetch。
3. **Supabase / SQL**
   - 所有 `SECURITY DEFINER` 函式 `SET search_path = ''`，並使用完整 schema 前綴。
4. **Git / Commit**
   - emoji 規範：`✨ feat`、`🐛 fix`、`🧹 chore`、`📝 docs`…等。
   - 不可修改或刪除已套用的 migration；需要修正請新增新檔。
   - 新規範或流程都要同步更新 `docs/verify`。

---

## 6. 常見情境速查

| 情境                       | 解法                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 本機資料庫跑壞             | `supabase db reset`                                                                                                      |
| 遠端 schema 與本機不一致   | `supabase migration repair --status reverted <遠端多出版本>` → `supabase db push`                                        |
| OAuth 無法登入             | 檢查 `.env.local` 的 OAuth 設定、Provider Redirect URL 設定                                                              |

---

## 7. 文件維護原則

1. `/docs/verify` 只放「目前狀態」；歷史沿革由 Git 保留。
2. 每次修改下列項目時必須同步更新文件：
   - 環境變數、新增 CLI 指令
   - Supabase schema、授權流程
   - Deployment / backup / reset 流程
3. 若文件與實作不一致，以實作為準並立即補文件。

---

## 8. 立即行動清單

- 新進成員：依序閱讀 `README → QUICK_START → AUTH_INTEGRATION → SUPABASE_*`，再開始開發。
- 模組負責人：調整功能時，同步更新對應章節（Auth/DB/State）。
- 任何變更 Supabase schema 的 PR：務必附上 `supabase db reset` 可成功的證明。

歡迎在 PR 中指出文件缺漏；當文件與程式碼同步，專案的維護與迭代才能保持可預測。
