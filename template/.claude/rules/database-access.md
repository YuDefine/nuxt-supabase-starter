<!--
🔒 LOCKED — managed by clade
Source: rules/modules/db-runtime/cf-workers/database-access.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->

---
description: 資料庫存取模式（Supabase client/server 分工）
globs: ["app/**/*.{vue,ts}", "server/**/*.ts"]
---

# Database Access Pattern

- **Client**: READ only via `useSupabaseClient<Database>()` — **僅限 RLS SELECT `TO public` 的表**
- **Server**: request-scoped 讀寫一律經 `/api/v1/*` + `getSupabaseWithContext(event)`
- **Privileged system tasks**: `getServerSupabaseClient()` 僅用於 audit logging、backfill、資料修復、背景工作
- **Optional transactional query layer**: `server/utils/drizzle.ts` 僅用於 service 層 / 系統任務；**NEVER** 讓 Drizzle 接管 migration、RLS、trigger
- **NEVER** `.insert()/.update()/.delete()/.upsert()` from client
- **NEVER** client 直讀 RLS `TO authenticated` 的表 — `anon` 角色會靜默回傳 0 筆（見 `supabase-rls` skill）

## MCP 存取

- **Dev** 查詢用 `dev-supabase` MCP（local Supabase instance）
- **NEVER** 使用 Kong port 8001 — Studio introspection 會觸發 PostgREST pool 重建，導致 REST API 中斷
- **NEVER** 在上班時間 `docker restart` 任何 Supabase 容器

## Seed 資料

seed.sql 使用 INSERT 格式（非 COPY FROM stdin），加 `SET session_replication_role = replica;` 和 `TRUNCATE CASCADE`。

> 本檔為 starter template 的預設規則，複製出去後依專案實際使用調整。

## Client 查詢效能

- **Client SELECT 要加 filter** — 不帶 `.eq()` 的 SELECT 會強制 Postgres 掃全表再套 RLS policy，加 filter 可減少 95%+ 開銷
- 這是 RLS 效能陷阱的延伸：特權系統任務可使用 `service_role` bypass，但 request handler 的預設學習路徑仍應保留 request context 與 contract 邊界

## Connection Pool 與監控

Supabase 的連線結構：

- **PostgREST (`authenticator` role)** 佔用 pool，所有 `/rest/v1/*` 請求共用
- **Auth (`supabase_auth_admin`)**、**Storage (`supabase_storage_admin`)**、**Realtime (`supabase_admin`)** 各自佔用
- **Supavisor pool** 總量不應超過 DB `max_connections` 的 **40%**（若重度使用 PostgREST）

### 診斷連線問題（pg_stat_activity）

當 API 變慢或出現 `PGRST003`（504 timeout，見 `error-handling.md`），跑以下 query：

```sql
-- 所有 live connection
SELECT pid, usename, application_name, client_addr,
       state, query_start, backend_start,
       left(query, 80) as query
FROM pg_stat_activity
WHERE datname = 'postgres'
ORDER BY backend_start DESC;

-- 按角色統計
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

| `usename`                | 來源                   |
| ------------------------ | ---------------------- |
| `authenticator`          | PostgREST（Data API）  |
| `supabase_auth_admin`    | GoTrue                 |
| `supabase_storage_admin` | Storage                |
| `supabase_admin`         | Realtime / 監控        |
| `postgres`               | Dashboard / psql / MCP |

## Transaction 與批次寫入

- **批次寫入 ≤500 筆/transaction** — 超過會造成 WAL bloat 與 replica lag
- **避免 long-running transaction** — `idle in transaction` > 5 分鐘會卡 vacuum、blocking lock
- **Server 端遇到 `40001`（serialization_failure）** — retry transaction，但需有 idempotency 保證（見 `api-patterns.md`）
- **NEVER** 在 RLS policy 中放重型 JOIN 或外部函式 — 會被 per-row 執行

## Drizzle 使用邊界

- `drizzle.config.ts` 與 `server/utils/drizzle.ts` 是**選用能力**，不是預設 handler 路徑
- **MUST** 繼續用 Supabase CLI 管 migration，**NEVER** 讓 `drizzle-kit generate/push` 成為正式 schema 變更來源
- 若用 `postgres-js` 直連 Supavisor，**MUST** `prepare: false`
- 遠端 / 雲端建議使用 pooler port `6543`；本地 Supabase 直連預設 `54322`

## 部署目標的連線限制

### Cloudflare Workers / Pages（Edge runtime）

- **每個 request 都是新連線** — 無 persistent connection
- **MUST** 用 `@supabase/supabase-js` client 走 HTTP → PostgREST
- **NEVER** 嘗試直接 Postgres TCP 連線（`pg` / `postgres` node driver）— Edge runtime 不支援持久 socket
- **30 秒 CPU 限制**（付費 plan）— 任何 query 超過數百 ms 都會嚴重佔用 budget

### Node.js runtime（Vercel / Nuxt Hub）

- 可用 persistent connection，但仍建議走 PostgREST 避免繞過 RLS
- 若直連 Postgres，**MUST** 用連線池（`pg-pool`）並設合理 max

### Local Supabase（預設）

`.env.example` 指向 `127.0.0.1:54321`。開發階段用 `supabase start` 跑本地容器；部署前需切到正式 Supabase URL（Cloud 或自建）。
