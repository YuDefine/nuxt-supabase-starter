## Why

目前只有 `app.vue` 作為根元件，沒有 layout 系統。所有主流 starter 都提供至少兩套 layout（default + auth），以及自訂 error page。沒有這些，使用者需要自己從零搭建基礎 UI 架構，違背 starter 的目的。

## What Changes

- 建立 `app/layouts/default.vue`：含 header（logo + nav + user menu + dark mode toggle）、main content area、footer
- 建立 `app/layouts/auth.vue`：居中卡片 layout，適用 login/register 等認證頁面
- 建立 `app/error.vue`：處理 404 / 500 等錯誤，提供返回首頁按鈕
- 建立 `app/app.config.ts`：Nuxt UI 主題色彩自訂（primary、neutral color tokens）
- 修改 `app/app.vue`：整合 `<NuxtLayout>` + `<NuxtPage>`

## Capabilities

### New Capabilities

- `layout-default`: 含 header/footer 的標準應用 layout，支援 responsive sidebar/header nav
- `layout-auth`: 認證頁面專用的居中卡片 layout
- `error-page`: 自訂錯誤頁面，根據 statusCode 顯示對應訊息
- `app-config`: Nuxt UI 主題色彩配置

### Modified Capabilities

(none)

## Impact

- 新增 `app/layouts/default.vue`
- 新增 `app/layouts/auth.vue`
- 新增 `app/error.vue`
- 新增 `app/app.config.ts`
- 修改 `app/app.vue`
- **Infrastructure 層**：clean 版本保留，非 demo 內容
- 不需要 migration
