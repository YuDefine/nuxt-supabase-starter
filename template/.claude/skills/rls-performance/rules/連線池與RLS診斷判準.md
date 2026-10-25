
# Rule 1 - 依 `usename` 判斷是哪個元件在佔連線

- Level: `SHOULD`
- `pg_stat_activity` 按 `usename` 分組後，依下表對回元件：

| `usename` | 來源 |
| --- | --- |
| `authenticator` | PostgREST（Data API） |
| `supabase_auth_admin` | GoTrue（Auth） |
| `supabase_storage_admin` | Storage |
| `supabase_admin` | Realtime／Studio／監控 |
| `supabase_replication_admin` | Read replica sync |
| `postgres` | Dashboard／psql／Prisma |

- 症狀對應：
  - 大量 `authenticator` 處於 `idle in transaction` → 前端或 server 有未完成的 transaction，或 `db_pre_request` hook 異常。
  - `supabase_admin` 連線數突然暴增 → Studio schema introspection，通常來自 MCP `list_tables` 或走 Kong 8001。
  - pool 滿到拒絕新連線 → 查各元件 pool size 是否超出 Rule 2 的預算。

## Good Example

- 這個例子是好的，因為它從分組結果對回元件與成因。

```text
authenticator | idle in transaction | 38
→ PostgREST 連線被未完成的 transaction 佔住；查最近新增的 RPC 是否有未 COMMIT 的路徑
```

## Bad Example

- 這個例子是壞的，因為它只看總數就直接加大 pool。

```text
連線 95/100 → PGRST_DB_POOL 從 10 調到 30
```

# Rule 2 - Supavisor pool 預算不超過 `max_connections` 的 40%

- Level: `SHOULD`
- 重度使用 PostgREST 的 self-hosted 部署，Supavisor pool 預設不超過 DB `max_connections` 的 40%，其餘留給 Auth、Storage 與 admin。
- 這是 db-runtime `database.md` § Connection Pool Runbook 第 1 點預算公式中 Supavisor 那一項的上限；全部元件加總仍受該公式約束，兩者同時成立才算合格。

## Good Example

- 這個例子是好的，因為 Supavisor 在 40% 以內，且總和仍低於上限。

```text
max_connections=100；Supavisor 40、PGRST_DB_POOL 20、GoTrue 10、Storage 10、headroom 10 → 合計 90 ≤ 100
```

## Bad Example

- 這個例子是壞的，因為 Supavisor 吃掉 70%，Auth 與 Storage 只能搶剩下的連線。

```text
max_connections=100；Supavisor 70、PGRST_DB_POOL 20、GoTrue 10 → 合計 100，沒有 headroom
```

# Rule 3 - 有／無 policy 的 Execution Time 差超過 50% 即視為 policy 問題

- Level: `SHOULD`
- 以相同角色、相同 query 比較有 policy 與停用 policy（或改用不受該 policy 影響的對照查詢）的 `Execution Time`；差異超過 50%，或 plan 出現 `Seq Scan`，就檢查 policy 欄位的 index 與 policy 寫法。
- `Planning Time` 大於 `Execution Time` 時多半是 plan cache 沒命中（schema cache 過期或 prepared statement 問題），不是 policy 本身慢。

## Good Example

- 這個例子是好的，因為它用相同角色量兩次再判定。

```text
有 policy 18.4 ms／無 policy 3.1 ms（+494%），plan 出現 Nested Loop 高 rows
→ policy 內 per-row JOIN，改成 subselect 預先算 ID set
```

## Bad Example

- 這個例子是壞的，因為它用 superuser 量測，RLS 根本沒套用。

```text
psql -U postgres：有 policy 3.0 ms／無 policy 3.1 ms → 判定 policy 沒問題
```
