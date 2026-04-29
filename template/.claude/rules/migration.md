<!--
🔒 LOCKED — managed by clade
Source: rules/modules/db-schema/supabase/migration.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->

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

> 本檔為 starter template 的預設規則，複製出去後依專案實際使用調整。

## Schema 暴露策略

Template 預設只使用 `public` schema，並被 PostgREST 自動暴露為 Data API。

### 新增 private schema 的情境

- 有一批 `SECURITY DEFINER` function 不應被 PostgREST 自動暴露為 RPC
- 需要隔離 system-level helper 與業務表
- 需要記錄 audit / internal log 表不對外

### 規約

```sql
-- 1. 建 schema
create schema if not exists core;

-- 2. 不要 grant usage 給 anon/authenticated（保持不暴露）
-- 預設 role 沒有 usage → PostgREST 看不到

-- 3. 在 core 中 create function
create or replace function core.fn_helper(...)
returns ...
language plpgsql
security definer
set search_path = ''
as $$ ... $$;

-- 4. 需要讓 client 呼叫時，在 public 建薄 wrapper
create or replace function public.fn_helper_wrapper(...)
returns ...
language plpgsql
security invoker
as $$
begin
  -- 權限檢查
  if not (select auth.role() = 'authenticated') then
    raise exception 'unauthorized';
  end if;
  return core.fn_helper(...);
end;
$$;
```

### 暴露多個 schema（Dashboard 設定）

若要讓 PostgREST 暴露額外 schema（如 `api`）：

1. Supabase Dashboard → API Settings → Exposed schemas 加入
2. `GRANT USAGE ON SCHEMA <name> TO anon, authenticated, service_role;`
3. `GRANT ALL ON ALL TABLES IN SCHEMA <name> TO anon, authenticated, service_role;`
4. `ALTER DEFAULT PRIVILEGES ...` 確保新表自動繼承權限

**NEVER** 暴露 `core` / `internal` / `audit` 這類 helper schema。
