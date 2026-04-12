# Cloudflare Workers Request Body Stream 只能讀一次

## Problem

Middleware 中的 `getUserSession(event)` 內部消耗了 request body stream。後續 API handler 呼叫 `readBody()` 時 stream 已空，導致無限等待（不是 error，是 hang）。

症狀：

- API 無限 hang 最終返回 500
- `Workers runtime canceled this request because it detected that your Workers code had hung`
- 只有 POST/PUT/DELETE 有 body 的請求會發生

## Root Cause

Cloudflare Workers 的 request body 是 stream，只能讀一次。Middleware 先讀了 body 導致 handler 的 `readBody()` 永遠等待。

## What Didn't Work

- 看 error log — 沒有明確錯誤，只有 Workers runtime 超時 cancel
- 在 handler 裡 try/catch — `readBody` 不會 throw，會永遠 pending
- 猜測是 Supabase 連線問題 — 漸進式隔離測試才發現是 `readBody`

## Solution

三種方案（依推薦順序）：

**1. DELETE 改用 query parameter（推薦）：**

```typescript
// DELETE 不用 body，用 query
const query = getQuery(event)
const email = query.email as string
```

**2. 在 middleware 之前讀取 body：**

```typescript
export default defineEventHandler(async (event) => {
  let requestBody = null
  if (['POST', 'PUT'].includes(event.method)) {
    requestBody = await readBody(event) // 最前面讀
  }
  const session = await getUserSession(event) // 之後才做其他 async
})
```

**3. 排除特定路徑不執行 middleware**

## Prevention

- Middleware 應只做輕量檢查，不要讀取 body
- DELETE 優先用 URL path/query 傳參數
- 遇到 API hang（非 error）→ 用漸進式隔離：空 handler → 逐步加功能 → 定位哪一步 hang
