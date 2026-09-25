---
description: Supabase Migration 操作規範
paths: ['supabase/migrations/**/*.sql', 'server/**/*.ts', 'packages/*/server/**/*.ts']
---
<!-- Clade native rule; source: rules/modules/db-schema/supabase/migration.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->

# Migration

- **MUST** use `supabase migration new <name>` — **NEVER** create .sql manually
- **MUST** `SET search_path = ''` in ALL SECURITY DEFINER functions
- **NEVER** put SECURITY DEFINER functions in exposed schemas（`public`）— 放在 private schema，僅透過 GRANT 開放
- **MUST** use `WITH (security_invoker = true)` on ALL views — view 預設 bypass RLS（以 owner 權限執行），不加等於 RLS 失效
- **NEVER** modify or delete applied migrations
- **NEVER** use MCP `execute_sql` for DDL — `supabase_admin` owner breaks CI/CD。唯一例外：修 `must be owner of table` 時，由同一條 MCP 連線 `ALTER ... OWNER TO postgres` 並補 `schema_migrations` 記錄（步驟見 `supabase-migration` skill 的 troubleshooting reference）
- **MUST** use `bigint GENERATED ALWAYS AS IDENTITY` for new table primary keys — **NEVER** `bigserial`（SQL 標準，避免 sequence ownership 問題）
- Existing tables using `bigserial` **SHALL NOT** be migrated（風險高、收益低）
- **每一個** migration 檔新增或修改後都 **MUST** 依 runtime variant 跑 reset → lint → gen types → typecheck，**不是只處理最後一個**（具體命令見對應 `db-runtime/<variant>` rule，例如 self-hosted 走 `pnpm db:reset` / `pnpm db:lint` / `pnpm db:types`；local docker 走 `supabase db reset` / `supabase db lint` / `supabase gen types typescript --local`）
- **MUST** run `supabase db advisors`（CLI v2.81.3+；版本不足退 MCP `get_advisors`）並**逐條**處置 security 類 finding — 見下方 § Lint 與 advisors 的處置義務


> 各 runtime 中載入的本檔是 clade 投影，**NEVER** 就地編輯。專案特化寫進自家 `.clade/rules/`；既有 `.claude/rules/local/` 經顯式 local rule migration 接管前保留。要改共同義務請回 clade 源檔並 propagate。

## Lint 與 advisors 的處置義務

機械執行點是共同 commit 流程（`/commit`）**Step 1.4 / 1.5**（`capabilities/core/skills/commit/schema-sync.md`，在 Step 1.3 reset 之後跑）；本節只定義義務。入口沒有原生 slash command 時載入該流程的完整 skill 正文完成同一組 gates，沒有流程或工具就回報 gate 未完成，不改用另一套檢查。db-runtime variant 指應用資料庫部署方式，與 AI runtime 無關。

### `supabase db lint` — hard block，零容忍

- **MUST** 用 `--level warning` 門檻，輸出非空即停止 commit
- **NEVER** 分級或維護「已知可忽略」清單 —— 那是會與現實漂開的第二份平行文件
- **NEVER** 以「非本次 diff 引入」「既有 debt」為由放行；gate 不區分新舊

### `supabase db advisors` — advisory，但義務逐條

advisors 沒有文件化的 exit code 與輸出契約，所以**不做 hard gate**，但輸出 **MUST** 讀，處置義務逐條：

- **每一條** security 類 finding（RLS disabled、policy exists but RLS disabled、security definer
  view、`auth.users` 暴露、function `search_path` 未設等）**MUST** 當場修掉，或在
  `docs/tech-debt.md` 登一條 entry 並在完成報告寫明編號
- **「每一條」是字面意思**：advisors 回 5 條就要 5 條都有著落，**NEVER** 修最嚴重的那條就往下走，
  **NEVER** 只處理「跟本次 diff 相關」的那幾條
- performance 類 finding（unindexed FK、unused index、`auth_rls_initplan`、multiple permissive
  policies）純參考，不強制處置

> advisors 在本 fleet 的消費端是正在跑 `/commit` 的 agent 與 CI 的 `supabase-check` action（lint 那半），不是 Dashboard（self-hosted 沒有）。

### CI 兜底

commit gate 依賴 agent 走完流程；機械兜底在 CI。**每一個**有 `supabase/migrations/` 的 consumer
都 **MUST** 有一份引用 `./.github/actions/supabase-check` 的 workflow，對碰到 `supabase/**` 的 PR
跑冷啟重放 + types drift + lint。範本與落地步驟見 `vendor/snippets/supabase-ci/README.md`。

CI 用 `supabase db start` 在 runner 上起本機 stack，**NEVER** 讓 CI 連 dev / staging 的實體 DB（冷啟另外驗掉依賴 dev DB 既有狀態的 migration）。

## Timestamp 順序契約

`supabase migration new` 用建立當下的 clock 命名，branch 久放後 timestamp 可能早於已合併的 migration，而 `supabase db push` 預設拒絕 out-of-order，production deploy 直接紅燈。

### MUST

- **MUST** commit / push migration 前確認 timestamp 晚於 `origin/main` 上所有已存在的 migration
- **MUST** 走 `supabase migration new`，**NEVER** 手寫 timestamp
- **MUST** 偵測到 out-of-order 時用 `git mv` rename 到當下 UTC timestamp 並重發版本

### NEVER

- **NEVER** 在 `supabase db push` 加 `--include-all` flag — 永久關掉 supabase 的 out-of-order 保護，任何後續漂移都會默默放行
- **NEVER** 為了「保留 commit 順序」而手改 migration 檔 timestamp — 用 `supabase migration new` 重生

### 例外：catalog-alignment stub（多 repo 共用一台 Postgres）

多個 repo 共用同一台 Postgres 時 `supabase_migrations.schema_migrations` 整個 DB 一份，remote 會出現本 repo 沒有的 version，`supabase db push` 以 `Remote migration versions not found in local migrations directory` 整批拒絕。解法是補一個**同名、零 SQL** 的對齊檔，version **MUST 逐字等於** remote 那筆——**這是 § MUST 第 3 條「rename 到當下 UTC timestamp」的唯一例外**，pre-commit hook 也放行。豁免條件**兩條都要成立**：檔案含 `CLADE:CATALOG-ALIGNMENT-STUB` marker，且不含任何非註解、非空白行。

- **MUST** 在 stub 內註明該 version 的 DDL 由哪個 repo 擁有、何時套用到哪個環境
- **NEVER** 在 stub 內加任何 SQL（production 永遠不會執行它，只有 ephemeral replay 會跑）
- stub 是過渡措施，**MUST** 在採用的同時登記根治待辦（自有 catalog table 或分離資料庫）

### 自動化

`vendor/scripts/pre-commit/checks/supabase-migration-safety.sh` 第 2 條在 commit 階段擋 out-of-order migration 並印 `git mv` 建議（用已快取的 `origin/main` ref，不主動 fetch）。

### Out-of-order 修補 SOP

當 deploy workflow 報「Found local migration files to be inserted before the last migration on remote database」：

1. 確認遠端 `supabase_migrations.schema_migrations` 最後一筆 timestamp（SSH + psql）
2. `git mv supabase/migrations/<old>_<name>.sql supabase/migrations/$(date -u +%Y%m%d%H%M%S)_<name>.sql`
3. commit + push main → staging 重 deploy 驗證
4. staging 綠 → tag → push tag 觸發 production deploy
5. 若 dev 環境已 applied 舊 timestamp（schema_migrations 留舊 entry），跑
   `supabase migration repair --status reverted <old-timestamp>` 校正

**NEVER** 用 `git commit --no-verify` 跳過 hook；**NEVER** 把 hook 的 fail 當 false positive 直接強推，先確認 `origin/main` 是否同步。

## Pending Migration 分類

**每一個**尚未套用到目標環境的 migration 都 **MUST** 在 deploy 前通過 canonical 分類器：

```bash
node vendor/scripts/classify-migrations.ts --migrations-dir supabase/migrations
```

分類器輸出 `online_safe`、`expand_contract_required`、`maintenance_required` 或 `review_required`。CI／deploy pipeline **MUST** 以目標環境的 applied migration versions 判定 pending 集合，並逐一讀取分類器輸出的對應 migration 結果；既有已套用 migration 的分類不得掩蓋 pending migration。

分類為 `expand_contract_required`、`maintenance_required` 或 `review_required` 的高風險 migration，SQL 檔頭 **MUST** 註記：

```sql
-- Migration risk: maintenance_required
-- Root cause: <觸發高風險分類的 DDL／資料量／相容性原因>
-- Lock strategy: <lock_timeout、concurrent／分階段做法、maintenance window 或無鎖理由>
```

Header 是部署決策證據，不能覆寫分類器結果。`maintenance_required` 仍 **MUST** hard stop，完成 rollback／maintenance decision 後才可核准。

## Schema 暴露策略

Template 預設只使用 `public` schema，並被 PostgREST 自動暴露為 Data API。

需要不被 PostgREST 暴露的 `SECURITY DEFINER` function、system-level helper 或 audit / internal log 表時，新增 private schema：

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

額外 schema（如 `api`）：Dashboard → API Settings → Exposed schemas 加入，再 `GRANT USAGE` / `GRANT ALL ON ALL TABLES` 給 anon, authenticated, service_role，並 `ALTER DEFAULT PRIVILEGES` 讓新表繼承。

**NEVER** 暴露 `core` / `internal` / `audit` 這類 helper schema。

## DML Data Fix Checklist

寫 DML `UPDATE` / `DELETE` migration 修 prod 髒資料時 **MUST** 同一 commit 內更新 `seed.sql` 對應 row（否則 `db:reset` 重新引入髒資料）；無法立即 commit 就 **MUST** 在 `HANDOFF.md` 登記「seed.sql 待同步 — migration `<name>` 修了 `<table>.<column>`」。**NEVER** 只寫 migration 就當作完成。

## Zero-Downtime Migration Checklist（production）

對 production DB 的每個 DDL migration **MUST** 逐項過（naive `ALTER TABLE` 可能拿 `ACCESS EXCLUSIVE` 卡住所有讀寫）：

1. **`lock_timeout`**：DDL 前 `SET lock_timeout = '3s'` 之類，拿不到 lock 快速失敗。**NEVER** 讓 DDL 無 `lock_timeout` 跑在有流量的表上
2. **`statement_timeout`**：長 backfill / rewrite 設上限，backfill 用分批而非一條巨大 statement
3. **`CREATE INDEX CONCURRENTLY` / `DROP INDEX CONCURRENTLY`**：production 建 / 刪 index **MUST** 用 CONCURRENTLY（不可包在 BEGIN/COMMIT 內；失敗留下 `INVALID` index 要 `DROP` 重建）
4. **兩段式加約束**：FK / CHECK **MUST** 先 `ADD CONSTRAINT ... NOT VALID` 再另一步 `VALIDATE CONSTRAINT`。**NEVER** 一步加 validated constraint
5. **三段式加非空欄**：nullable `ADD COLUMN` → 分批 backfill（每批 ≤ 數千、批間 sleep）→ `CHECK (<c> IS NOT NULL) NOT VALID` + `VALIDATE`。**NEVER** 在大表上 `ADD COLUMN ... NOT NULL DEFAULT ...` 同步 rewrite
6. **Expand-contract**：rename / drop / 改型別 **MUST** 分 expand（加新欄、雙寫）→ migrate（backfill、切讀新）→ contract（另一次部署才 drop 舊欄）。**NEVER** 在同一個 migration 內 rename / drop 仍被線上程式引用的欄位

> 部署流程走哪條由 § Pending Migration 分類 決定；本 checklist 是 SQL 層手法。

## Data-Transform Migration Disposition

資料轉換 migration 的 SQL 檔頭 **MUST** 宣告 per-class disposition，列出既有資料每種預期狀態（class label ＋ predicate ＋ action）：

```sql
-- Disposition:
--   valid_rows (status IN ('active','resigned')): UPDATE SET new_col = derived_value
--   null_source (old_col IS NULL): SET new_col = 'default_fallback'
--   unexpected_format (old_col !~ pattern): SKIP (WHERE clause excludes)
--   orphan_fk (ref table missing): SET new_col = NULL, log warning
```

資料轉換 migration = 含 `UPDATE <table> SET`、`INSERT INTO <table> SELECT`、`ALTER COLUMN ... USING`、或 `ADD COLUMN ... DEFAULT <依賴既有欄位的 expression>`；純 DDL 不算。**NEVER** 漏列可預見的資料狀態（尤其 NULL / 空字串 / 外鍵孤兒），**NEVER** 假設全部 row 都符合 valid 條件而不寫 fallback。

## Staging Rehearsal

資料轉換 migration 在 merge 前 **SHOULD** 在 staging-like 資料（不是乾淨 seed）上跑一次：`supabase migration up` → 看 error / warning → 每個 disposition class 抽查一筆 → 確認未被涵蓋的 row 數為 0（`SELECT count(*) WHERE <negation of all predicates>`）。目標表 > 10,000 row、含 `ALTER COLUMN ... USING`、或含 `DELETE` / `TRUNCATE` 時升級為 **MUST**。
