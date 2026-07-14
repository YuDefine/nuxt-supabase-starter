---
description: RLS Policy 撰寫規範
paths: ['supabase/migrations/**/*.sql']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/modules/db-schema/supabase/rls-policy.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# RLS Policy

- **NEVER** 在 write policy 加 `(SELECT auth.role()) = 'service_role'` 當 bypass 條件 — Supabase `service_role` 具備 PostgreSQL `BYPASSRLS`，本來就略過所有 RLS，policy 內加這條件對 service role **沒有任何實際保護作用**，只會讓後續 agent 誤以為 privileged write path 由 policy 控制。privileged 寫入的安全邊界見下方「service_role 與 privileged client isolation」。
- SELECT: `TO public` for client reads, `TO authenticated` for server-only
- **UPDATE policy 需要搭配 SELECT policy** — Postgres RLS 的 UPDATE 必須先 SELECT row，缺少 SELECT policy 會靜默回傳 0 rows（無報錯）
- **Storage upsert 需要 INSERT + SELECT + UPDATE 三個 policy** — 只有 INSERT 時新上傳正常，但覆蓋（upsert）會靜默失敗
- **NEVER** use `user_metadata`（`raw_user_meta_data`）in RLS policies — 使用者可自行修改，改用 `app_metadata`
- See `supabase-rls` skill for policy templates and `TO public` 陷阱

> 本檔為 starter template 的預設規則，複製出去後依專案實際使用調整。

## GRANT 先於 RLS——table privilege 驗證

PostgreSQL 先檢查 table-level privilege（`GRANT`）再評估 RLS policy。只建 `CREATE POLICY ... TO authenticated` 但沒有對應的 `GRANT SELECT ON <table> TO authenticated`，結果是 `42501`（permission denied），RLS policy **完全不被評估**。

Migration 新增 RLS policy 時 **MUST**：

1. 同一支 migration 內顯式 `GRANT <privilege> ON <table> TO <role>`，或
2. 註明 table 已有既存 GRANT（引用授予 GRANT 的 migration 編號）

驗證方式——在 dev DB 查 `pg_catalog`：

```sql
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = '<schema>' AND table_name = '<table>';
```

若目標 role 不在結果中，RLS policy 寫再多都是死的。

## 靜默失敗陷阱

- **`auth.uid() IS NULL` 陷阱** — 未認證時 `auth.uid()` 回傳 null，`null = user_id` 永遠 false，policy 靜默拒絕。要明確區分「沒登入」與「沒權限」，在 policy 開頭寫 `auth.uid() IS NOT NULL AND ...`
- **DELETE 同理 UPDATE** — 沒有 SELECT policy 時 DELETE 也靜默成功但不刪除任何 row
- **缺 `TO` role 指定的 policy 會對所有 role 執行** — 明確指定 `TO authenticated` 或 `TO public`，避免 `anon` 不必要地觸發 policy 評估
- **Views 預設繞過 RLS** — `CREATE VIEW` 必須加 `WITH (security_invoker = true)`，見 `migration.md`

## service_role 與 privileged client isolation

`service_role` 具備 PostgreSQL `BYPASSRLS`，任何用它建立的連線都**無條件略過**所有 RLS policy — 因此 privileged 寫入的安全**不由 RLS policy 保證**，而是靠以下 server-side isolation：

- **service role key 只留在 server-only boundary** — **NEVER** 把 service role key 打包進 client bundle、放進 `NUXT_PUBLIC_*` / `VITE_*` / 任何 browser-exposed env、或回傳給前端。key 外洩 = 整個 RLS 失效。
- **privileged client 獨立建立** — 用專屬 factory（例如 `useServiceClient()`）建 service_role client，**NEVER** 重用 request-scoped 的 user client 再「升級」權限。
- **禁止 SSR / user token 覆蓋 privileged client 的 `Authorization` header** — 若 privileged client 被塞入使用者 JWT，PostgREST 會以該 JWT 的 role 執行、privileged 操作靜默降權失敗（或更糟：以錯誤 role 寫入）。建立 privileged client 後**不得**再套用 user session token。
- **privileged 操作在 API handler 明確做權限檢查** — `requireRole()` + 業務授權邏輯是 privileged path 的真正 gate；RLS policy 對 service_role 不生效，不能當作授權層。
- **對照**：需要真的「以使用者身分」讀寫並讓 RLS 生效時，**MUST** 用 request-scoped 的 user client（帶使用者 JWT），**NEVER** 用 service_role 代打再自己過濾。

## RLS Hardening（owner bypass / restrictive policy / JWT staleness）

- **`FORCE ROW LEVEL SECURITY`** — table owner（含 migration 執行者、`postgres` superuser 以外的 owner role）預設**繞過** RLS。若某表的 owner bypass 不可接受（例如 owner role 會被業務程式重用），**MUST** `ALTER TABLE <t> FORCE ROW LEVEL SECURITY`，強制連 owner 也套 policy。判斷：table 由非 `service_role` 的 application role 擁有、且該 role 可能執行業務查詢 → 加 FORCE。
- **Restrictive policy 用於 deny-style 疊加約束** — 預設 policy 是 `PERMISSIVE`（多條之間 **OR**，任一通過即放行）。要表達「**無論如何都必須**滿足」的硬約束（例如「一律不可跨 tenant」），**MUST** 用 `AS RESTRICTIVE`（多條之間 **AND**，全部通過才放行）。典型：一條 permissive 表達「誰可以看」，一條 restrictive 表達「絕不可洩漏到別 tenant」。**NEVER** 只靠新增 permissive policy 來「限縮」— permissive 只會放寬不會收緊。
- **JWT staleness** — RLS policy 讀的 `auth.jwt()` claims 來自請求當下的 access token，**不會**即時反映 server 端剛改的權限。做 policy-critical authorization 時：
  - **短命 claims** — 授權相關 claims（role、tenant、permission set）放進**短 TTL** 的 access token，靠 refresh 收斂；**NEVER** 依賴長命 JWT 的 claim 當唯一授權來源。
  - **權限變更後強制 refresh** — 使用者角色 / 停用狀態改變時，server **MUST** 使既有 session 失效或觸發 token refresh，避免舊 JWT 仍帶已撤銷的權限。
  - **policy-critical 決策不吃 stale claim** — 對「停用帳號能否寫入」「降權後能否讀敏感表」這類決策，**MUST** 由 DB 內即時狀態（例如 join `user_roles` 現值）判定，**NEVER** 只信 JWT claim。

## RLS 效能

- **`auth.uid()` / `auth.jwt()` 要用 subselect 快取** — `(SELECT auth.uid()) = user_id` 用 initPlan 快取，比直接 `auth.uid() = user_id` 快 99%+（同樣模式適用 `(SELECT auth.jwt())` 等）。
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
