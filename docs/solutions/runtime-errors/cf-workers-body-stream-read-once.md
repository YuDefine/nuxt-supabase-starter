---
module: server/middleware
date: 2025-01-01
problem_type: runtime-errors
component: server middleware + API handlers
symptoms:
  - API 無限 hang 最終返回 500
  - 'Workers runtime canceled this request — code had hung'
  - 只有 POST/PUT/DELETE 有 body 的請求會發生
root_cause: Cloudflare Workers request body 是 stream 只能讀一次，middleware 先讀了 body 導致 handler 的 readBody() 永遠等待
resolution_type: workaround
severity: critical
tags:
  - cloudflare-workers
  - request-body
  - stream
  - middleware
---

## Problem

Middleware 內部消耗了 request body stream（可能透過 `getUserSession` 或其他 async 操作）。後續 handler 的 `readBody()` 永遠等待（不是 error，是 hang）。

## What Didn't Work

- 看 error log — 只有 Workers runtime 超時 cancel，無明確錯誤
- try/catch — `readBody` 不 throw，永遠 pending
- 漸進式隔離才能定位

## Solution

1. **DELETE 改用 query parameter（推薦）** — RESTful DELETE 本就該用 URL 傳參數
2. **在 middleware 之前讀取 body** — handler 最前面先 `readBody()`，再做 async 操作
3. **Middleware 不要觸碰 body** — 只做輕量檢查

## Prevention

- Middleware 應只做輕量檢查，不讀取 body
- 遇到 API hang → 漸進式隔離：空 handler → 逐步加功能 → 定位哪步 hang
