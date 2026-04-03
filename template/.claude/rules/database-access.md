---
description: 資料庫存取模式（Supabase client/server 分工）
globs: ['app/**/*.{vue,ts}', 'server/**/*.ts']
---

# Database Access Pattern

- **Client**: READ only via `useSupabaseClient<Database>()` — **僅限 RLS SELECT `TO public` 的表**
- **Server**: ALL writes + RLS `TO authenticated` 表的讀取 via `/api/v1/*` endpoints
- **NEVER** `.insert()/.update()/.delete()/.upsert()` from client
- **NEVER** client 直讀 RLS `TO authenticated` 的表 — `anon` 角色會靜默回傳 0 筆（見 `supabase-rls` skill）

## MCP 存取

- **Dev** 查詢用 `dev-supabase` MCP（local Supabase instance）
- **NEVER** 使用 Kong port 8001 — Studio introspection 會觸發 PostgREST pool 重建，導致 REST API 中斷
- **NEVER** 在上班時間 `docker restart` 任何 Supabase 容器

## Seed 資料

seed.sql 使用 INSERT 格式（非 COPY FROM stdin），加 `SET session_replication_role = replica;` 和 `TRUNCATE CASCADE`。
