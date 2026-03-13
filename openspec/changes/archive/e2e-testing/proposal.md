## Why

目前只有一個 `example.test.ts` 單元測試。TDMS 在引入 Playwright E2E 測試後，成功攔截了多個頁面渲染和路由權限的 regression。Starter 需要提供 E2E 測試基礎設施和有意義的測試範例，讓使用者知道如何測試認證流程和頁面渲染。

## What Changes

### Infrastructure（clean 版保留）

- 安裝 `@playwright/test` 作為 devDependency
- 建立 `playwright.config.ts`：
  - Chrome-only 設定（快速回饋）
  - Timeout 配置
  - Base URL 設定
  - WebServer 自動啟動
- 建立 `e2e/auth.setup.ts`：
  - 測試用登入流程（storage state 持久化）
  - 支援不同角色的 fixture
- 更新 `package.json` 新增 `pnpm test:e2e` script
- 更新 `.github/workflows/ci.yml` 新增 E2E step（可選）
- 建立 `test/unit/stores/user.test.ts`：User store 單元測試範例

### Demo（clean 版移除）

- 建立 `e2e/smoke.spec.ts`：
  - 驗證所有主要頁面正常渲染
  - 未登入時重導至 login
  - 登入後可訪問 protected pages
- 建立 `e2e/auth.spec.ts`：
  - Login 頁面渲染
  - 表單驗證錯誤顯示
  - 登入成功重導

## Capabilities

### New Capabilities

- `e2e-infrastructure`: Playwright 配置 + auth setup + CI 整合
- `e2e-smoke-tests`: 頁面渲染 smoke tests
- `e2e-auth-tests`: 認證流程 E2E tests
- `unit-test-examples`: 有意義的單元測試範例（user store）

### Modified Capabilities

(none)

## Impact

- 新增 `playwright.config.ts` (infrastructure)
- 新增 `e2e/auth.setup.ts` (infrastructure)
- 新增 `e2e/smoke.spec.ts` (demo)
- 新增 `e2e/auth.spec.ts` (demo)
- 新增 `test/unit/stores/user.test.ts` (demo)
- 修改 `package.json`（devDependency + script）
- 修改 `.github/workflows/ci.yml`（可選）
- 依賴：auth-system（需有 auth pages 可測試）
