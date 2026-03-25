---
description: Supabase Migration 操作規範
globs: ['supabase/migrations/**/*.sql', 'server/**/*.ts']
---

# Migration

- **MUST** use `supabase migration new <name>` — **NEVER** create .sql manually
- **MUST** `SET search_path = ''` in ALL SECURITY DEFINER functions
- **NEVER** modify or delete applied migrations
- **NEVER** use MCP `execute_sql` for DDL — `supabase_admin` owner breaks CI/CD
- After migration: `supabase db reset` → `db lint` → `gen types` → `typecheck`
