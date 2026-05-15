<!--
🔒 LOCKED — managed by clade
Source: rules/modules/db-schema/supabase/query-optimization.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->

---
description: 查詢優化、EXPLAIN、index 設計與 RLS 效能測量
paths: ['supabase/migrations/**/*.sql', 'server/api/**/*.ts']
---

# Query Optimization

> 本檔為 starter template 的預設規則，複製出去後依專案實際使用調整。

RLS 會放大任何 N+1 或 full scan。**MUST** 在以下情境先跑 `EXPLAIN ANALYZE` 再合併：

- 新增涉及 policy join 的表
- 修改既有 RLS policy 的 WHERE 條件
- 新增 API endpoint 含 pagination / filter
- 遇到 `PGRST003`（504 timeout）或使用者抱怨變慢
- 部署在 edge runtime 時出現 timeout（Cloudflare Workers 30 秒）

## EXPLAIN ANALYZE 模板

```sql
-- 1. 模擬目標 role（不是 postgres superuser！）
set local role authenticated;
set local request.jwt.claims to '{"sub": "<user_uuid>", "role": "authenticated"}';

-- 2. 跑實際 query
explain (analyze, buffers, verbose, format text)
select ... from public.<table> where ...;

-- 3. 還原
reset role;
```

**Superuser 跑 EXPLAIN 會 bypass RLS，測出來的 plan 跟 production 完全不同** — 一定要 `set local role`。

## 讀 plan 的重點

| Plan 片段                        | 意義                         | 處理                               |
| -------------------------------- | ---------------------------- | ---------------------------------- |
| `Seq Scan on xxx`                | 全表掃描                     | 檢查 WHERE 欄位是否有 index        |
| `Rows Removed by Filter: > 1000` | Index 取太多又濾掉           | Composite index 或 partial index   |
| `Subquery Scan ... InitPlan`     | `(SELECT auth.uid())` 有快取 | ✅ 正確模式                        |
| `Filter: (auth.uid() = user_id)` | **沒快取**                   | 改 subselect `(SELECT auth.uid())` |
| `Nested Loop` + 高 rows          | Policy 內 per-row JOIN       | 改 subselect 預先算 ID set         |

## Index 設計原則

### 必須加 index 的欄位

- **Policy WHERE/USING 引用的欄位** — `user_id`, `tenant_id`, `org_id` 等（RLS per-row 檢查）
- **FK 欄位**（`xxx_id`）— JOIN 效能 + delete cascade
- **常用 filter 欄位**（`status`, `created_at`, `type`）
- **Order by 欄位**（用於 pagination）

### Index 類型選擇

| 資料特性                 | Index 類型       | 範例                                            |
| ------------------------ | ---------------- | ----------------------------------------------- |
| 等值查找（`= ?`）        | B-tree（預設）   | `create index on x (user_id)`                   |
| 範圍查找（`> ?`）        | B-tree           | `create index on x (created_at)`                |
| 不常更新的遞增 timestamp | BRIN             | `create index on x using brin(created_at)`      |
| JSONB 欄位過濾           | GIN              | `create index on x using gin(details)`          |
| 全文搜尋                 | GIN (`tsvector`) | `create index on x using gin(to_tsvector(...))` |

### Composite Index 順序

欄位順序影響命中：`(a, b)` 能用於 `WHERE a=? AND b=?` 與 `WHERE a=?`，但**不能**用於 `WHERE b=?`。放最常過濾的欄位在前。

### Partial Index

對「只關心部分資料」的 query 效果顯著：

```sql
create index idx_tasks_pending on public.tasks (assigned_to)
where status = 'pending';
```

### 過度 index 的代價

- 每個 index 都會拖慢 INSERT / UPDATE / DELETE
- 定期用 `pg_stat_user_indexes` 找零使用 index 並移除

## 效能測量

```sql
-- 查慢 query（需 pg_stat_statements extension）
select
  calls,
  total_exec_time::int as total_ms,
  mean_exec_time::int as mean_ms,
  left(query, 100) as query
from pg_stat_statements
where query ilike '%public.%'
order by total_exec_time desc
limit 20;
```

### 預期延遲基準

| Query 類型                    | 可接受延遲 | 異常訊號     |
| ----------------------------- | ---------- | ------------ |
| Single row by PK              | < 5ms      | > 50ms 要查  |
| List with filter + pagination | < 50ms     | > 200ms 要查 |
| Aggregation / group by        | < 200ms    | > 1s 告警    |

## Pagination

- **NEVER** 用純 `limit + offset` 做深層 pagination（offset 很大時仍會掃過所有 rows 再丟掉）
- **Keyset pagination**：`where (created_at, id) < (:last_at, :last_id) order by created_at desc, id desc limit :page_size`
- 前端 `pageSize` **MUST** 有上限（建議 ≤100）

## 效能事故處理

API 變慢時：

1. 先看 log 是否有 `PGRST003`（pool 耗盡）
2. 跑 `pg_stat_activity`（見 `database-access.md`）找 long-running query
3. 取該 query 跑 `EXPLAIN ANALYZE`
4. 若是 RLS policy 問題 → 改 policy 或加 index
5. 若是 N+1 → 改用 `select(*, related(*))` embed 或 RPC

## Supabase Advisors

Supabase CLI v2.81.3+ 提供 `supabase db advisors` 自動檢查：

- Missing index on FK
- Unused index
- RLS policy 效能問題
- Security 建議

**SHOULD** 在每次大量 migration 後跑一次：`supabase db advisors`。
