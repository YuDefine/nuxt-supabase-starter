---
name: rls-performance
description: >-
  Postgres + Supabase RLS 效能診斷與優化手冊。Use when 寫/改 RLS policy、
  跑 EXPLAIN ANALYZE、排查 PGRST003 pool timeout、設計 index、
  優化 pagination、使用者抱怨 API 變慢、或需要診斷 connection pool
  問題時。涵蓋 pg_stat_activity 診斷、角色對照、self-hosted LXC
  責任模型、效能基準與事故恢復 SOP。
---

# RLS Performance Playbook

專案有 345+ RLS policy 與 206+ SECURITY DEFINER function，加上 self-hosted LXC 的 connection pool 限制，任何 N+1 或 full scan 都會被放大。本 skill 是遇到效能問題時的操作手冊。

決策原則（「MUST 做 / NEVER 做」）仍在 `.claude/rules/{database,database-design}.md`，本檔提供**實際診斷與優化工具**。

## 何時開啟本 skill

- 新增涉及 policy join 的表
- 修改既有 RLS policy 的 WHERE 條件
- 新增 server API endpoint 含 pagination / filter
- 遇到 `PGRST003`（504 timeout）或 pool 耗盡
- 使用者抱怨特定頁面 / endpoint 變慢
- 需要稽核 production 效能或清理無用 index
- 排查 LXC 連線問題 / Tunnel 斷線

**核心原則**：policy 改動前先量，改動後驗證，不要憑感覺優化。

## EXPLAIN ANALYZE — 正確的 RLS 測量方式

**關鍵陷阱**：superuser 跑 EXPLAIN 會 **bypass RLS**，測出來的 plan 跟 production 完全不同。**一定要** `set local role` 模擬目標角色。

```sql
-- 1. 模擬目標 role（不是 postgres superuser！）
set local role authenticated;
set local request.jwt.claims to '{"sub": "<user_uuid>", "role": "authenticated"}';

-- 2. 跑實際 query
explain (analyze, buffers, verbose, format text)
select ... from tdms.xxx where ...;

-- 3. 還原
reset role;
```

### 讀 plan 重點

| Plan 片段                          | 意義                         | 處理                                               |
| ---------------------------------- | ---------------------------- | -------------------------------------------------- |
| `Seq Scan on xxx`                  | 全表掃描                     | 檢查 WHERE 欄位是否有 index                        |
| `Rows Removed by Filter: > 1000`   | Index 取太多又濾掉           | Composite index 或 partial index                   |
| `Subquery Scan ... InitPlan`       | `(SELECT auth.uid())` 有快取 | ✅ 正確模式                                        |
| `Filter: (auth.uid() = user_id)`   | **沒快取**                   | 改 subselect `(SELECT auth.uid())`                 |
| `Nested Loop` + 高 rows            | Policy 內 per-row JOIN       | 改 subselect 預先算 ID set                         |
| `Planning Time` > `Execution Time` | Plan cache 沒命中            | 通常是 schema cache 過期或 prepared statement 問題 |

## Index 設計

### 必須加 index 的欄位

- **Policy WHERE/USING 引用的欄位**（`user_id`, `tenant_id`, `department_id`）— RLS per-row 檢查
- **FK 欄位**（`xxx_id`）— JOIN 效能 + delete cascade
- **常用 filter 欄位**（`status`, `created_at`, `date`）
- **Order by 欄位**（用於 `limit + offset` pagination）

### Index 類型選擇

| 資料特性                 | Index 類型       | 範例                                                            |
| ------------------------ | ---------------- | --------------------------------------------------------------- |
| 等值查找（`= ?`）        | B-tree（預設）   | `create index on x (user_id)`                                   |
| 範圍查找（`> ?`）        | B-tree           | `create index on x (created_at)`                                |
| 不常更新的遞增 timestamp | BRIN             | `create index on x using brin(created_at)` — 比 B-tree 小 10 倍 |
| JSONB 欄位過濾           | GIN              | `create index on x using gin(details)`                          |
| 全文搜尋                 | GIN (`tsvector`) | `create index on x using gin(to_tsvector('simple', name))`      |

### Partial Index

對「只關心部分資料」的 query 效果顯著：

```sql
-- 只查未完成的任務
create index idx_tasks_pending on tasks (assigned_to)
where status = 'pending';
```

### Composite Index 順序

欄位順序影響命中：`(a, b)` 能用於 `WHERE a=? AND b=?` 與 `WHERE a=?`，但**不能**用於 `WHERE b=?`。放最常過濾的欄位在前。

### 過度 index 的代價

- 每個 index 都會拖慢 INSERT / UPDATE / DELETE
- Index 佔 disk、記憶體
- **MUST** 定期用 `pg_stat_user_indexes` 找出零使用量的 index 並移除

## Pagination

- **NEVER** 用純 `limit + offset` 做深層 pagination（offset 很大時 Postgres 仍會讀過所有 rows 再丟掉）
- **Cursor-based pagination**：用 `where id > :last_id order by id limit :page_size`
- `PAGE_SIZE_MAX` 從 `shared/schemas/pagination` 取用 — 避免前端傳巨大 pageSize

## Connection Pool 診斷（pg_stat_activity）

Self-hosted Supabase 的連線結構：

- **PostgREST (`authenticator` role)** 佔用 pool，所有 `/rest/v1/*` 請求共用
- **Auth (`supabase_auth_admin`)**、**Storage (`supabase_storage_admin`)**、**Realtime (`supabase_admin`)** 各自佔用
- **Supavisor pool** 是所有 client 的總閘口，預設 pool size 不應超過 DB `max_connections` 的 **40%**（若重度使用 PostgREST），其餘留給 Auth / Storage / admin

### 診斷 query

當 API 變慢或 `PGRST003`（504 timeout）出現，在目標 LXC 上跑：

```sql
-- 所有 live connection
SELECT
  pid, usename, application_name, client_addr,
  state, query_start, backend_start,
  left(query, 80) as query
FROM pg_stat_activity
WHERE datname = 'postgres'
ORDER BY backend_start DESC;

-- 按角色分組統計
SELECT usename, state, count(*)
FROM pg_stat_activity
WHERE datname = 'postgres'
GROUP BY usename, state
ORDER BY count DESC;

-- 找 idle connection 超過 5 分鐘
SELECT pid, usename, state, query_start, left(query, 80)
FROM pg_stat_activity
WHERE state = 'idle' AND state_change < now() - interval '5 minutes';
```

### 角色對照表

| `usename`                    | 來源                      |
| ---------------------------- | ------------------------- |
| `authenticator`              | PostgREST（Data API）     |
| `supabase_auth_admin`        | GoTrue                    |
| `supabase_storage_admin`     | Storage                   |
| `supabase_admin`             | Realtime / 監控           |
| `supabase_replication_admin` | Read replica sync         |
| `postgres`                   | Dashboard / psql / Prisma |

### 症狀 → 原因速查

- **大量 `authenticator` idle in transaction** → 前端有未完成的 transaction，或 `db_pre_request` hook 異常
- **`supabase_admin` 連線數突然暴增** → Studio schema introspection（通常來自 MCP `list_tables` / Kong 8001）
- **pool 滿到拒絕新連線** → 檢查 Supavisor pool size 配置、Compute add-on 的 max_connections

## pg_stat_statements — 找慢 query

```sql
-- 開啟 pg_stat_statements（已啟用）
select
  calls,
  total_exec_time::int as total_ms,
  mean_exec_time::int as mean_ms,
  query
from pg_stat_statements
where query ilike '%tdms.%'
order by total_exec_time desc
limit 20;
```

## 效能基準

### Query 延遲

| Query 類型                    | 可接受延遲 | 異常訊號             |
| ----------------------------- | ---------- | -------------------- |
| Single row by PK              | < 5ms      | > 50ms 要查          |
| List with filter + pagination | < 50ms     | > 200ms 要查         |
| Aggregation / group by        | < 200ms    | > 1s 告警            |
| Full-text search              | < 100ms    | > 500ms 查 GIN index |

### RLS policy 開銷

| Policy 類型                          | 可接受延遲增量 |
| ------------------------------------ | -------------- |
| 單欄位比對（`user_id = auth.uid()`） | < 1ms          |
| 單層 subselect（`IN (select ...)`）  | < 5ms          |
| JOIN 到另一表（應避免）              | > 10ms（警訊） |

**異常訊號**：若 `Execution Time` 在有/無 policy 差異 > 50%，或出現 `Seq Scan` → 檢查 index 與 policy 寫法。

## Transaction 與批次寫入

- **批次寫入 ≤500 筆/transaction** — 超過會造成 WAL bloat 與 replica lag
- **避免 long-running transaction** — `idle in transaction` > 5 分鐘會卡 vacuum、blocking lock
- **Server 端遇到 `40001`（serialization_failure）** — retry transaction，但需有 idempotency 保證（見 `api-patterns.md`）
- **NEVER** 在 RLS policy 中放重型 JOIN 或外部函式 — 會被 per-row 執行
- **Dry run**：production 大量 UPDATE/DELETE 前先跑 `EXPLAIN` 確認 plan，避免 full scan

## Self-Hosting LXC 責任模型

本專案自建 `fc-supabase-dev` / `fc-supabase-prod`（LXC + Docker Compose），Supabase Cloud 提供的功能我們需要自己維護：

| 面向              | Cloud 提供                 | 自建需自行處理                              |
| ----------------- | -------------------------- | ------------------------------------------- |
| OS 與 kernel 更新 | 自動                       | `apt upgrade` 週期 + 重啟排程               |
| Postgres 備份     | PITR + 每日 snapshot       | `pg_dump` 排程 + Tailscale 拉到 NAS         |
| 監控告警          | Dashboard charts + Grafana | 目前無 — 倚賴 `docker logs` + 手動 SSH 檢查 |
| SSL / HTTPS       | 自動                       | Cloudflare Tunnel 代管（cloudflared）       |
| Rate limiting     | Platform 層                | Nuxt 層自行實作（目前無）                   |
| Schema cache 重載 | 自動                       | `notify pgrst, 'reload schema'` 手動        |
| Postgres 升級     | 一鍵                       | 需手動規劃 + 停機                           |

### 關鍵依賴

- **Cloudflare Tunnel**：fc-supabase-prod 對外唯一入口。Tunnel 斷 = 全站掛（登入 / API 都不通）。任何影響 host 頻寬的操作都會波及（見 `database.md` Production 存取安全規範）
- **Tailscale**：Dev / 備份 / SSH 的通道。若 relay mode 密集連線會癱瘓整條網路
- **無自動備份**（目前狀態）— 若 LXC 壞掉，復原倚賴最近一次手動 dump。**Action item**：應建立排程備份到 Synology NAS

## 效能事故處理 SOP

API 變慢或 `PGRST003` 出現時：

1. 先看 `log.error` 是否有 `PGRST003`（pool 耗盡）
2. SSH 到 fc-supabase-dev/prod 跑 `pg_stat_activity`（上方診斷 query）找 long-running query
3. 取該 query 跑 `EXPLAIN ANALYZE`（記得 `set local role`）
4. 若是 RLS policy 問題 → 改 policy 或加 index
5. 若是 N+1 → 改用 `select(*, related(*))` embed 或 RPC

## 定期稽核

- `pg_stat_user_indexes` — 找零使用量 index
- `pg_stat_statements` — 找 total_exec_time 最高的 query
- `pg_stat_activity` idle > 5 min — 找連線洩漏
