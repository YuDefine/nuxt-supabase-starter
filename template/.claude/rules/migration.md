---
description: Supabase Migration 操作規範
globs: ['supabase/migrations/**/*.sql', 'server/**/*.ts']
---

# Migration

- **MUST** use `supabase migration new <name>` — **NEVER** create .sql manually
- **MUST** `SET search_path = ''` in ALL SECURITY DEFINER functions
- **NEVER** modify or delete applied migrations
- **NEVER** use MCP `execute_sql` for DDL — `supabase_admin` owner breaks CI/CD
- **MUST** use `bigint GENERATED ALWAYS AS IDENTITY` for new table primary keys — **NEVER** `bigserial`（SQL 標準，避免 sequence ownership 問題）
- Existing tables using `bigserial` **SHALL NOT** be migrated（風險高、收益低）
- After migration: `supabase db reset` → `supabase db lint --level warning` → `supabase gen types typescript --local` → `pnpm typecheck`
