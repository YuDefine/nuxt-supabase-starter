---
description: 錯誤處理規範（Server 驗證 + Client 顯示）
globs: ['app/**/*.{vue,ts}', 'server/**/*.ts']
---

# Error Handling

**Server-side**：使用 Zod schema 驗證請求資料，錯誤回傳 `statusMessage`
**NEVER** 在 `createError()` 中傳遞 `data` 屬性 — 可能洩漏內部錯誤細節

**Client-side**：錯誤訊息統一透過 toast 或友善 UI 顯示
**NEVER** 直接讀取 `error.message` 顯示給使用者 — 可能包含堆疊追蹤或內部資訊
