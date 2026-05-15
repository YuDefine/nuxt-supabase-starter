<!--
🔒 LOCKED — managed by clade
Source: rules/modules/db-schema/supabase/migration.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->

---
description: Supabase Migration 操作規範
paths: ['supabase/migrations/**/*.sql', 'server/**/*.ts']
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
- After migration：依 runtime variant 跑 reset → lint → gen types → typecheck（具體命令見對應 `db-runtime/<variant>` rule，例如 self-hosted 走 `pnpm db:reset` / `pnpm db:lint` / `pnpm db:types`；local docker 走 `supabase db reset` / `supabase db lint` / `supabase gen types typescript --local`）
- **SHOULD** run `supabase db advisors`（CLI v2.81.3+）檢查 schema 建議 — 涵蓋 index、security、performance 問題

> 本檔為 starter template 的預設規則，複製出去後依專案實際使用調整。

## Timestamp 順序契約

`supabase migration new <name>` 用**建立當下**的 local clock 命名（`YYYYMMDDHHMMSS_*.sql`），
**branch 久放會 timestamp drift**：day 1 跑 `migration new`、day 5 才 merge，
期間其他人在 day 3 加的 migration 先 merge 走 → 你的檔 timestamp 反而比已合併的早。

`supabase db push` 預設拒絕 out-of-order migration（fail with `--include-all` hint），
production deploy 直接紅燈。

### MUST

- **MUST** commit / push migration 前確認 timestamp 晚於 `origin/main` 上所有已存在的 migration
- **MUST** 走 `supabase migration new`，**NEVER** 手寫 timestamp
- **MUST** 偵測到 out-of-order 時用 `git mv` rename 到當下 UTC timestamp 並重發版本

### NEVER

- **NEVER** 在 `supabase db push` 加 `--include-all` flag — 永久關掉 supabase 的 out-of-order 保護，任何後續漂移都會默默放行
- **NEVER** 為了「保留 commit 順序」而手改 migration 檔 timestamp — 用 `supabase migration new` 重生

### 自動化

`vendor/scripts/pre-commit/checks/supabase-migration-safety.sh` 第 2 條
（clade v0.5.27+）會在 commit 階段擋 out-of-order migration，並印 `git mv` 建議命令。
hook 用 `origin/main` 已快取 ref 比對（不主動 fetch，避免拖慢 commit）。

### Out-of-order 修補 SOP

當 deploy workflow 報「Found local migration files to be inserted before the last migration on remote database」：

1. 確認遠端 `supabase_migrations.schema_migrations` 最後一筆 timestamp（SSH + psql）
2. `git mv supabase/migrations/<old>_<name>.sql supabase/migrations/$(date -u +%Y%m%d%H%M%S)_<name>.sql`
3. commit + push main → staging 重 deploy 驗證
4. staging 綠 → tag → push tag 觸發 production deploy
5. 若 dev 環境已 applied 舊 timestamp（schema_migrations 留舊 entry），跑
   `supabase migration repair --status reverted <old-timestamp>` 校正

### 為什麼 rename 是治標、hook 是治根

rename 解單次紅燈；hook 防再犯。兩者都不可繞過：

- **NEVER** 用 `git commit --no-verify` 跳過 hook
- **NEVER** 把 hook 的 fail 當 false positive 直接強推 — 先確認 `origin/main` 是否同步

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
