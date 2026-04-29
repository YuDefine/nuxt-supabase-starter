---
audience: both
applies-to: post-scaffold
---

# Cloudflare Workers Subrequest 數量限制

## Problem

批量操作時部分資料寫入失敗。Supabase error 看起來像 DB 問題但實際是 Workers 限制。Free plan 上約 50 筆操作後開始失敗。

例：批量同步 50 筆資料：查詢 (1) + 現有資料查詢 (1) + 驗證 (3) + 逐一 update (50) + log (1) = 56 subrequests。超過 Free plan 的 50 限制，第 51 個 fetch 失敗。Supabase JS client 把 Workers 的截斷包裝成普通 error，**極難診斷**。

## Root Cause

Cloudflare Workers 限制每個 request 的 subrequest 數量（Free 50 / Standard 1000）。for-loop 逐一 `.update()` 超出限制。

## What Didn't Work

- 看 Supabase error message — 被 Workers 截斷，看起來像 DB 問題
- 在 Supabase Dashboard 查 — 前 50 筆正常，後面的根本沒到 DB
- 以為是 RLS 或 timeout — 實際是 Workers 的 subrequest 限制

## Solution

for-loop 逐一操作改為批次操作：

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

- Review 時**計算每個 endpoint 的最大 subrequest 數**
- 批次優先：用 `.upsert()` / `.insert()` 批次處理
- 留安全餘量（目標 < 限制的 50%）
- 記住：每個 Supabase `.select()` / `.update()` / `.insert()` 都是一個 subrequest
