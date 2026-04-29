---
audience: both
applies-to: post-scaffold
---

# Sentry 錯誤追蹤配置

## 架構

- **Client**：`sentry.client.config.ts` — 在 Nuxt 初始化前執行
- **Server**：透過 `@sentry/nuxt/module` 自動配置

## 為什麼用 import.meta.env

`sentry.client.config.ts` 在 Nuxt 初始化前執行，`useRuntimeConfig()` 此時無法使用。
因此 DSN 透過 `import.meta.env.NUXT_PUBLIC_SENTRY_DSN`（build time Vite 注入）讀取。

## 環境變數

| 變數                     | 用途              | 階段       |
| ------------------------ | ----------------- | ---------- |
| `NUXT_PUBLIC_SENTRY_DSN` | Client DSN        | Build time |
| `SENTRY_DSN`             | Server DSN        | Runtime    |
| `SENTRY_ORG`             | Organization slug | Build time |
| `SENTRY_PROJECT`         | Project slug      | Build time |
| `SENTRY_AUTH_TOKEN`      | Source map 上傳   | Build time |

## 僅 Production 啟用

使用 `!import.meta.dev` 判斷，確保：

- 本地開發不啟用（不影響 DX）
- Build 時不啟用（不影響 CI）
- 僅 Cloudflare Workers production 環境啟用

## 過濾策略

### ignoreErrors

過濾無害的瀏覽器錯誤：

- ResizeObserver loop（瀏覽器內部）
- Network request failed（使用者網路問題）
- AbortError（使用者取消）
- Chrome/Firefox extension 錯誤
- Chunk load 錯誤（部署新版本後舊 chunk）

### denyUrls

過濾第三方腳本：

- Google Analytics / GTM
- Facebook Connect
- 瀏覽器擴充套件

## Release 追蹤

使用 `__APP_VERSION__`（Vite define 注入）作為 release 版本，與 `package.json` version 一致。
