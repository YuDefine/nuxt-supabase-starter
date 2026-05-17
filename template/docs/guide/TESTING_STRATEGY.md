---
audience: both
applies-to: post-scaffold
---

# 三層測試策略（Testing Strategy）

本專案的測試分三層，分別用不同工具、跑在不同環境，解決不同類型的回歸風險。下面這張表是決策樹的入口，後面分節說明每層的範圍與何時往上爬一層。

## 概覽

| 層        | 工具                                       | 目錄                          | 跑在哪           | 平均耗時 (一個檔) |
| --------- | ------------------------------------------ | ----------------------------- | ---------------- | ----------------- |
| Unit      | Vitest                                     | `test/unit/**/*.test.ts`      | Node + happy-dom | < 0.5s            |
| Component | Vitest + `@nuxt/test-utils`                | `test/nuxt/**/*.nuxt.test.ts` | Nuxt runtime     | 1–3s              |
| E2E       | Playwright (`@nuxt/test-utils/playwright`) | `e2e/**/*.spec.ts`            | 真實 Nuxt build  | 5–30s             |

跑法：

- `pnpm test`：整套（unit + component；E2E 走 `pnpm test:e2e`）
- `pnpm test:unit`：只跑 `test/unit/`，最快回饋
- `pnpm test:e2e`：Playwright 端對端

## 決策樹：寫測試前先回答兩個問題

### Q1：被測對象需要 Nuxt runtime 才能跑嗎？

需要 = 用到 `useRuntimeConfig`、Nuxt UI 元件、auto-import、`useNuxtApp`、Pinia store、Nuxt UI 的 `<UButton>` / `<UAlert>` 等。

| 答案 | 走哪層                   |
| ---- | ------------------------ |
| 否   | **Unit**（最快、最便宜） |
| 是   | 看 Q2                    |

### Q2：要驗的東西是「一個元件 / 一段程式邏輯」還是「真實使用者流程」？

| 答案                                     | 走哪層                                 |
| ---------------------------------------- | -------------------------------------- |
| 元件 / 邏輯（隔離測）                    | **Component**（Nuxt runtime 內 mount） |
| 真實使用者流程（含登入、跨頁面、跨 API） | **E2E**                                |

「真實使用者流程」典型例子：登入 → 建立資料 → 看到資料出現在列表 → 編輯 → 看到更新。涉及多個頁面、多次 round-trip、瀏覽器層的互動。

## 三層各自的範圍

### Unit

**目的**：純函式、composable、utils 的快速回歸保護。

- 路徑：`test/unit/**/*.test.ts`
- 環境：happy-dom（不 boot Nuxt）
- 適合：
  - `app/utils/**`、`server/utils/**`、`shared/schemas/**`
  - 不依賴 Nuxt runtime 的 composable（用 `vi.stubGlobal` stub 掉 `ref` / `computed`）
  - Zod schema 驗證、formatter、parser
- **不要**：mount 真元件、import Nuxt UI 元件、依賴 `useRuntimeConfig`

範例：`test/unit/example.test.ts`、`test/unit/composables/useModalForm.test.ts`。

### Component

**目的**：驗證單一元件的 props / emit / 內部狀態。

- 路徑：`test/nuxt/**/*.nuxt.test.ts`
- 環境：`// @vitest-environment nuxt` + `mountSuspended()`
- 適合：
  - 用 Nuxt UI primitive 的展示元件（`AppEmptyState`、`AppPageShell`、`AppFormLayout`）
  - 用 auto-import 的 composable wrapper
  - props → render output / emit 對應
- **不要**：點擊整個頁面流程（那是 E2E）、mock 整個 server API（那是 unit + service-layer test）

範例：`test/nuxt/AppEmptyState.nuxt.test.ts`。

### E2E

**目的**：跨頁面 / 跨 API 的真實使用者流程，最後一道防線。

- 路徑：`e2e/**/*.spec.ts`
- 環境：`@nuxt/test-utils/playwright` 啟動真實 Nuxt server，chromium 跑互動
- 適合：
  - 登入 → 受保護頁面顯示
  - 表單送出 → API round-trip → DB 寫入 → 列表 refetch
  - 角色權限：admin 看得到 / member 看不到
- **不要**：把 unit test 能驗的東西放這裡（慢、flaky）、驗純樣式（去做 visual regression）

關鍵 helper：

- `e2e/auth.setup.ts`：跑一次，建立 `e2e/.auth/user.json` 給 `chromium` project 用
- `e2e/fixtures/index.ts`：三角色 fixture（`adminPage` / `memberPage` / `guestPage` / `unauthPage`），每 test 各自 fresh context
- `server/api/_dev/login.post.ts`：dev-only POST route，`import.meta.dev` 自動 tree-shake，production build 看不到

範例：`e2e/roles.example.spec.ts`、`e2e/smoke.spec.ts`。

## 何時往上爬一層

往上爬 = 越貴。下面是「該爬」的信號：

- **Unit → Component**：unit test 的 mock 比實作還複雜（mock 太多 Nuxt auto-import）→ 改用 Component test 讓 Nuxt 自己處理
- **Component → E2E**：要驗的東西涉及兩個以上元件 / 一個頁面以上的互動 → 改用 E2E
- **永遠不要**：因為「想全面覆蓋」就把同一個功能在三層都寫一遍 — 那是浪費 CI 時間。每層只擋它能擋的回歸

## 何時考慮加 simulator 層

預設**不加** simulator 層（mock Supabase / mock 第三方 API 的 in-memory replacement）。下列三條件命中兩條才考慮：

1. E2E 數量超過 30 個檔，且大量重複 setup 同樣的 DB 狀態
2. CI 跑滿一輪 E2E > 10 分鐘
3. 真實 backend 上游頻寬 / quota 受限（例：production Supabase 連線數有上限、第三方 API 有 rate limit）

兩條未到 = 直接跑真 backend；省下維護兩套 backend 的工。

## Anti-patterns

- **NEVER** `.skip` 或註解掉 test — 壞的 test 是 signal，要修不要藏
- **NEVER** 在 unit test 裡 mount 整個 Nuxt page — 用 Component layer
- **NEVER** 在 E2E 裡用真實密碼登入測試帳號 — 用 `POST /api/_dev/login`
- **NEVER** 把 secret（包含 `NUXT_DEV_LOGIN_PASSWORD`）寫進 git — `.env.example` 留 placeholder，實際值放 `.env`（已 gitignore）
- **NEVER** 在 production runtime config 開啟 `import.meta.dev` 條件下才該啟用的 route — 走 build flag，不要靠 env

## Reference

- [Vitest 文件](https://vitest.dev/)
- [`@nuxt/test-utils`](https://nuxt.com/docs/getting-started/testing)
- [Playwright](https://playwright.dev/)
- `docs/verify/TEST_DRIVEN_DEVELOPMENT.md` — Red → Green → Refactor 流程
- `docs/manual-review-checklist.md` — Spectra 收尾的人工檢查清單
