---
description: RLS Policy 撰寫規範
globs: ['supabase/migrations/**/*.sql']
---

# RLS Policy

- Write policies **MUST** include `(SELECT auth.role()) = 'service_role'` bypass
- SELECT: `TO public` for client reads, `TO authenticated` for server-only
- **UPDATE policy 需要搭配 SELECT policy** — Postgres RLS 的 UPDATE 必須先 SELECT row，缺少 SELECT policy 會靜默回傳 0 rows（無報錯）
- **Storage upsert 需要 INSERT + SELECT + UPDATE 三個 policy** — 只有 INSERT 時新上傳正常，但覆蓋（upsert）會靜默失敗
- **NEVER** use `user_metadata`（`raw_user_meta_data`）in RLS policies — 使用者可自行修改，改用 `app_metadata`
- See `supabase-rls` skill for policy templates and `TO public` 陷阱

> 本檔為 starter template 的預設規則，複製出去後依專案實際使用調整。

## 靜默失敗陷阱

- **`auth.uid() IS NULL` 陷阱** — 未認證時 `auth.uid()` 回傳 null，`null = user_id` 永遠 false，policy 靜默拒絕。要明確區分「沒登入」與「沒權限」，在 policy 開頭寫 `auth.uid() IS NOT NULL AND ...`
- **DELETE 同理 UPDATE** — 沒有 SELECT policy 時 DELETE 也靜默成功但不刪除任何 row
- **缺 `TO` role 指定的 policy 會對所有 role 執行** — 明確指定 `TO authenticated` 或 `TO public`，避免 `anon` 不必要地觸發 policy 評估
- **Views 預設繞過 RLS** — `CREATE VIEW` 必須加 `WITH (security_invoker = true)`，見 `migration.md`

## RLS 效能

- **`auth.uid()` / `auth.role()` 要用 subselect 快取** — `(SELECT auth.role()) = 'service_role'` 用 initPlan 快取，比直接 `auth.role() = 'service_role'` 快 99%+
- **Policy 欄位要有 index** — policy 中 WHERE/USING 引用的欄位（`user_id`, `org_id`, `tenant_id` 等）必須有 index，否則 per-row evaluation 會觸發 full table scan
- **Policy 中避免昂貴 JOIN** — 跨表 JOIN 在 policy 中是 per-row 執行，改用 subselect 預先算 ID set 再比對

## RLS 效能測量

**MUST** 在新增/修改 policy 後用 `EXPLAIN ANALYZE` 驗證：

```sql
-- 模擬目標 role（不是 postgres superuser！superuser 會 bypass RLS）
set local role authenticated;
set local request.jwt.claims to '{"sub": "<user_uuid>", "role": "authenticated"}';

explain (analyze, buffers)
select * from public.<table> where ...;

reset role;
```

### 預期 RLS 開銷基準

| Policy 類型                          | 可接受延遲增量 |
| ------------------------------------ | -------------- |
| 單欄位比對（`user_id = auth.uid()`） | < 1ms          |
| 單層 subselect（`IN (select ...)`）  | < 5ms          |
| JOIN 到另一表（應避免）              | > 10ms（警訊） |

詳見 `query-optimization.md`。
