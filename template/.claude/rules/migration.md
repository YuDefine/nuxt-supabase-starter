---
description: Supabase Migration 操作規範
globs: ['supabase/migrations/**/*.sql', 'server/**/*.ts']
---

# Migration

- **MUST** use `supabase migration new <name>` — **NEVER** create .sql manually
- **MUST** `SET search_path = ''` in ALL SECURITY DEFINER functions
- **NEVER** put SECURITY DEFINER functions in exposed schemas（`public`）— 放在 private schema，僅透過 GRANT 開放
- **MUST** use `WITH (security_invoker = true)` on ALL views — view 預設 bypass RLS（以 owner 權限執行），不加等於 RLS 失效
- **NEVER** modify or delete applied migrations
- **NEVER** use MCP `execute_sql` for DDL — `supabase_admin` owner breaks CI/CD
- **MUST** use `bigint GENERATED ALWAYS AS IDENTITY` for new table primary keys — **NEVER** `bigserial`（SQL 標準，避免 sequence ownership 問題）
- Existing tables using `bigserial` **SHALL NOT** be migrated（風險高、收益低）
- After migration: `supabase db reset` → `supabase db lint --level warning` → `supabase gen types typescript --local` → `pnpm typecheck`
- **SHOULD** run `supabase db advisors`（CLI v2.81.3+）檢查 schema 建議 — 涵蓋 index、security、performance 問題
