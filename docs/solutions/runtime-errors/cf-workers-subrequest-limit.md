---
module: server/api
date: 2025-01-01
problem_type: runtime-errors
component: server API batch operations
symptoms:
  - 批量操作時部分資料寫入失敗
  - Supabase error 看起來像 DB 問題
  - Free plan 約 50 筆操作後失敗
root_cause: Cloudflare Workers 限制 subrequest 數量（Free 50/Standard 1000），for-loop 逐一操作超出限制
resolution_type: fix
severity: critical
tags:
  - cloudflare-workers
  - subrequest-limit
  - batch-operation
  - supabase
---

## Problem

每個 Supabase `.select()` / `.update()` / `.insert()` 都是一個 subrequest。for-loop 逐一操作容易超出限制。錯誤訊息被 Workers 截斷後看起來像 DB 問題，極難診斷。

## What Didn't Work

- 看 Supabase error — 被截斷，誤導為 DB 問題
- 在 Supabase Dashboard 查 — 前 N 筆正常，後面的根本沒到 DB

## Solution

```typescript
// ❌ BAD: N subrequests
for (const item of items) {
  await supabase.from('table').update({ ... }).eq('id', item.id)
}

// ✅ GOOD: 1 subrequest
await supabase.from('table').upsert(
  items.map(item => ({ id: item.id, ... })),
  { onConflict: 'id' }
)
```

## Prevention

- Review 時計算每個 endpoint 的最大 subrequest 數
- 批次優先（`.upsert()` / `.insert()` 陣列）
- 目標 < 限制的 50%（Free: 25, Standard: 500）
