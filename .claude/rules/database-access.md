---
description: 資料庫存取模式（Supabase client/server 分工）
globs: ['app/**/*.{vue,ts}', 'server/**/*.ts']
---

# Database Access Pattern

- **Client**: READ only via `useSupabaseClient<Database>()` + `.select()`
- **Server**: ALL writes via `/api/v1/*` endpoints
- **NEVER** `.insert()/.update()/.delete()/.upsert()` from client
- **NEVER** client 直讀 RLS `TO authenticated` 的表 — `anon` 角色會靜默回傳 0 筆
