---
description: UI 錯誤訊息必須本地化（繁體中文），禁止直接顯示原始英文 error code 或 message
paths: ['app/**/*.vue', 'packages/*/app/**/*.vue', 'components/**/*.vue', 'packages/*/components/**/*.vue', 'pages/**/*.vue']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/modules/framework/nuxt/nuxt-error-localization.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# UI 錯誤訊息本地化

UI **MUST NOT** 出現未經處理的原始英文錯誤代碼或訊息（`not_found`、`unauthorized`、`PGRST116`、堆疊追蹤等）。所有對使用者顯示的錯誤都必須是專案語系（預設繁體中文）的友善訊息。

## 禁止 pattern

| 禁止 | 應改為 |
| --- | --- |
| `errorMessages[code] ?? code` | `errorMessages[code] ?? '發生未預期的錯誤'` |
| `error.message` / `e.statusMessage` 直接綁 template | `parseError(error)` / `getErrorMessage(error, '預設中文訊息')` |
| `route.query.error` 直接顯示 | `parseError(route.query.error)` |
| `toast.add({ title: error.message })` | `toastError(title, error)` 或先 `getErrorMessage` |

## 核心原則

- UI 一律經過正規化 helper，**NEVER** 把 raw error 物件 / API code 餵給 template
- server 拋的 `statusMessage` 是給 log 用的英文 enum，前端不可直接顯示
- 新增 server-side error code 時 **MUST** 同步更新前端 `errorMessages` 對照表
- URL query 來源不可信，必須先過對照表

## 例外

開發環境 debug toast / dev-only banner 可保留原始訊息，但 **MUST** 用 `if (import.meta.dev)` 包起來。
