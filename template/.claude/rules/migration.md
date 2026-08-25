---
description: Supabase Migration 操作規範
paths: ['supabase/migrations/**/*.sql', 'server/**/*.ts', 'packages/*/server/**/*.ts']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/modules/db-schema/supabase/migration.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# Migration

- **MUST** use `supabase migration new <name>` — **NEVER** create .sql manually
- **MUST** `SET search_path = ''` in ALL SECURITY DEFINER functions
- **NEVER** put SECURITY DEFINER functions in exposed schemas（`public`）— 放在 private schema，僅透過 GRANT 開放
- **MUST** use `WITH (security_invoker = true)` on ALL views — view 預設 bypass RLS（以 owner 權限執行），不加等於 RLS 失效
- **NEVER** modify or delete applied migrations
- **NEVER** use MCP `execute_sql` for DDL — `supabase_admin` owner breaks CI/CD
- **MUST** use `bigint GENERATED ALWAYS AS IDENTITY` for new table primary keys — **NEVER** `bigserial`（SQL 標準，避免 sequence ownership 問題）
- Existing tables using `bigserial` **SHALL NOT** be migrated（風險高、收益低）
- **每一個** migration 檔新增或修改後都 **MUST** 依 runtime variant 跑 reset → lint → gen types → typecheck，**不是只處理最後一個**（具體命令見對應 `db-runtime/<variant>` rule，例如 self-hosted 走 `pnpm db:reset` / `pnpm db:lint` / `pnpm db:types`；local docker 走 `supabase db reset` / `supabase db lint` / `supabase gen types typescript --local`）
- **MUST** run `supabase db advisors`（CLI v2.81.3+；版本不足退 MCP `get_advisors`）並**逐條**處置 security 類 finding — 見下方 § Lint 與 advisors 的處置義務


> 本檔為 starter template 的預設規則，複製出去後依專案實際使用調整。

## Lint 與 advisors 的處置義務

上面兩條的機械執行點是 `/commit` **Step 1.4 / 1.5**（`plugins/hub-core/skills/commit/schema-sync.md`）——
它在 Step 1.3 的 reset 之後跑，那是 DB 剛好處於「migrations 全部重放一次」狀態的唯一時刻。
本節定義**義務**，執行流程不在這裡複述。

### `supabase db lint` — hard block，零容忍

- **MUST** 用 `--level warning` 門檻，輸出非空即停止 commit
- **NEVER** 分級或維護「已知可忽略」清單 —— 那是會與現實漂開的第二份平行文件
- **NEVER** 以「非本次 diff 引入」「既有 debt」為由放行；gate 不區分新舊

### `supabase db advisors` — advisory，但義務逐條

advisors 沒有文件化的 exit code 與輸出契約，所以**不做 hard gate**（flaky gate 的下場是被繞過，
比 advisory 更糟）。但輸出 **MUST** 讀，且處置義務是逐條的：

- **每一條** security 類 finding（RLS disabled、policy exists but RLS disabled、security definer
  view、`auth.users` 暴露、function `search_path` 未設等）**MUST** 當場修掉，或在
  `docs/tech-debt.md` 登一條 entry 並在完成報告寫明編號
- **「每一條」是字面意思**：advisors 回 5 條就要 5 條都有著落，**NEVER** 修最嚴重的那條就往下走，
  **NEVER** 只處理「跟本次 diff 相關」的那幾條
- performance 類 finding（unindexed FK、unused index、`auth_rls_initplan`、multiple permissive
  policies）純參考，不強制處置

> **為什麼不把 advisors 交給 Dashboard**：官方文件把 advisors 定位成 Dashboard 巡檢面板，
> 那個擺法的前提是 hosted 專案。self-hosted 沒有這兩個面板，照抄官方等於這個訊號沒有消費端。
> 本 fleet 的消費端是**正在跑 `/commit` 的 agent**（commit-time）與 **CI 的 `supabase-check`
> action**（lint 那半，見 `vendor/snippets/supabase-ci/`）。

### CI 兜底

commit gate 依賴 agent 走完流程；機械兜底在 CI。**每一個**有 `supabase/migrations/` 的 consumer
都 **MUST** 有一份引用 `./.github/actions/supabase-check` 的 workflow，對碰到 `supabase/**` 的 PR
跑冷啟重放 + types drift + lint。範本與落地步驟見 `vendor/snippets/supabase-ci/README.md`。

CI 用 `supabase db start` 在 runner 上起本機 stack，**NEVER** 讓 CI 連 dev / staging 的實體 DB ——
本機冷啟另外免費驗掉「依賴 dev DB 既有狀態才跑得起來的 migration」，那是在 dev DB 上 reset 驗不出來的。

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

### 例外：catalog-alignment stub（多 repo 共用一台 Postgres）

多個 repo 共用同一台 Postgres 時，`supabase_migrations.schema_migrations` 是**整個 DB 一份、
不分 schema**。於是 remote catalog 會出現本 repo 沒有的 version，`supabase db push` 以
`Remote migration versions not found in local migrations directory` **整批拒絕**，deploy 全卡。

解法是在本 repo 補一個**同名、零 SQL** 的對齊檔。它的 version **MUST 逐字等於** remote 那筆——
rename 到當下 timestamp 會製造一個新的 pending version，而原本那筆仍然「local 找不到」，
push 照樣拒絕。**這是 § MUST 第 3 條「rename 到當下 UTC timestamp」的唯一例外**，
pre-commit hook 對它的 out-of-order 判定也 MUST 放行。

豁免條件**兩條都要成立**（hook 逐條檢查，缺一不可）：

1. 檔案含 `CLADE:CATALOG-ALIGNMENT-STUB` marker —— 表明是刻意的對齊檔
2. 檔案不含任何非註解、非空白行 —— 零 SQL 就不可能造成 out-of-order DDL

只看 marker 會放行「加了 marker 又寫 SQL」的檔；只看零 SQL 會放行「忘了貼內容」的半成品。

- **MUST** 在 stub 內註明該 version 的 DDL 由哪個 repo 擁有、何時套用到哪個環境
- **NEVER** 在 stub 內加任何 SQL —— 該 version 在 remote 已記為 applied，production 永遠不會執行它，
  只有 ephemeral replay 會跑，兩邊會就此分歧
- catalog-alignment stub 是**過渡措施**：每次對方新增 migration 就要再補一次。根治方向是讓
  非擁有者改用自有 catalog table，或分離資料庫——**MUST** 在採用 stub 的同時登記根治待辦

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

## DML Data Fix Checklist

寫 DML `UPDATE` / `DELETE` migration 修 prod 髒資料時：

1. **MUST** 同一 commit 內更新 `seed.sql` 對應 row — migration 修了 prod，seed.sql 仍帶舊值 → `db:reset` 重新引入髒資料
2. 若無法立即 commit，**MUST** 在 `HANDOFF.md` 登記「seed.sql 待同步 — migration `<name>` 修了 `<table>.<column>`，seed.sql L`<lines>` 待改」
3. **NEVER** 只寫 migration 就當作完成

## Zero-Downtime Migration Checklist（production）

Production migration 在有流量時執行，一個 naive `ALTER TABLE` 就可能拿到 `ACCESS EXCLUSIVE` lock 卡住所有讀寫。對 production DB 的每個 DDL migration **MUST** 逐項過下列 checklist：

1. **`lock_timeout` — 先設短 lock 等待上限**：DDL 前 `SET lock_timeout = '<Ns>'`（如 `3s`），拿不到 lock 時**快速失敗**而不是無限期 block 整張表的請求。**NEVER** 讓 DDL 無 `lock_timeout` 直接跑在有流量的表上。
2. **`statement_timeout` — 限制單一 statement 執行上限**：長 backfill / 全表 rewrite `SET statement_timeout` 設合理上限，避免單一 statement 佔住連線 + lock 拖垮 pool；backfill 用分批（見第 6 點）而非一條巨大 statement。
3. **`CREATE INDEX CONCURRENTLY` — 建 index 不鎖寫入**：production 建 index **MUST** 用 `CREATE INDEX CONCURRENTLY`（不拿 write lock）。注意 CONCURRENTLY **不能**在 transaction block 內執行 → 該 migration 檔不可被包在 BEGIN/COMMIT，且失敗會留下 `INVALID` index 需 `DROP` 後重建。
4. **`DROP INDEX CONCURRENTLY` — 移除 index 不鎖表**：production 刪 index 同理用 `DROP INDEX CONCURRENTLY`，避免 `ACCESS EXCLUSIVE` lock 卡住查詢。
5. **`ADD CONSTRAINT ... NOT VALID` + `VALIDATE CONSTRAINT` — 兩段式加約束**：加 FK / CHECK constraint **MUST** 先 `ALTER TABLE ... ADD CONSTRAINT ... NOT VALID`（只鎖短暫、不掃全表），再另一步 `ALTER TABLE ... VALIDATE CONSTRAINT ...`（只拿 `SHARE UPDATE EXCLUSIVE`，不鎖寫入）。**NEVER** 一步加 validated constraint — 那會全表掃描期間鎖寫入。
6. **Nullable → chunked backfill → not-null — 三段式加非空欄**：加 `NOT NULL` 欄 **MUST** 分三步：(a) `ADD COLUMN <c> <type>`（nullable，秒級）；(b) 分批 backfill（每批 `WHERE <c> IS NULL LIMIT <N>` 或依 PK range，批量 ≤ 數千、批間 sleep 讓 autovacuum / replica 跟上）；(c) backfill 完成後 `ADD CONSTRAINT <c>_not_null CHECK (<c> IS NOT NULL) NOT VALID` → `VALIDATE CONSTRAINT`（或 PG12+ `SET NOT NULL` 前已有 validated CHECK 可免全表掃描）。**NEVER** 直接 `ADD COLUMN ... NOT NULL DEFAULT ...` 在大表上做同步 rewrite。
7. **Expand-contract — rename / drop / type change 分階段**：rename column / drop column / 改型別 **MUST** 走 expand-contract：**expand**（加新欄 / 新 nullable column，app 同時雙寫新舊、讀舊）→ **migrate**（backfill + app 切成讀新）→ **contract**（確認無程式再讀舊後，另一次部署才 drop 舊欄）。**NEVER** 在同一個 migration 內 rename / drop 仍被線上程式引用的欄位 — 舊 instance 會即刻 500。

> 對照 `database.md`（self-hosted 操作面）的 production migration classification（`online_safe` / `expand_contract_required` / `maintenance_required`）與 PostgREST `/ready` gate — 本 checklist 是 SQL 層的 zero-downtime 手法，classification 決定部署流程走哪條。

## Data-Transform Migration Disposition

含 `UPDATE` / `INSERT ... SELECT` / `ALTER ... USING` 的資料轉換 migration，既有資料的每種狀態都**MUST**被顯式考慮。漏掉某類資料 = silent data corruption 或 migration 中途 crash。

### MUST

每個資料轉換 migration 的 SQL 檔頭 **MUST** 宣告 per-class disposition comment block，列出既有資料的每種預期狀態與對應處置：

```sql
-- Disposition:
--   valid_rows (status IN ('active','resigned')): UPDATE SET new_col = derived_value
--   null_source (old_col IS NULL): SET new_col = 'default_fallback'
--   unexpected_format (old_col !~ pattern): SKIP (WHERE clause excludes)
--   orphan_fk (ref table missing): SET new_col = NULL, log warning
```

每條 disposition 包含三要素：

1. **Class label**（如 `valid_rows`、`null_source`）— 人可讀的分類名稱
2. **Predicate**（如 `status IN ('active','resigned')`）— 識別該類資料的 SQL 條件
3. **Action**（如 `UPDATE SET ...` / `SKIP` / `SET NULL`）— 對該類資料的處置

### 判定「是否為資料轉換 migration」

SQL 內含下列任一 pattern 即視為資料轉換 migration，MUST 附 disposition：

- `UPDATE <table> SET` — 批次修改既有欄位值
- `INSERT INTO <table> SELECT` — 從既有資料衍生新 row
- `ALTER TABLE ... ALTER COLUMN ... USING` — 改型別時的值轉換
- `ALTER TABLE ... ADD COLUMN ... DEFAULT <expression>` 且 expression 非 literal（依賴既有欄位）

純 DDL（`ADD COLUMN ... DEFAULT 'literal'` / `CREATE TABLE` / `CREATE INDEX`）不算，不需 disposition。

### NEVER

- **NEVER** 在資料轉換 migration 漏列任何可預見的資料狀態（尤其 NULL / 空字串 / 外鍵孤兒）
- **NEVER** 假設「全部 row 都符合 valid_rows 條件」不寫 fallback — prod 資料永遠有例外

## Staging Rehearsal

### SHOULD

資料轉換 migration 在 merge 前 **SHOULD** 在 staging-like 資料上跑過一次驗證。

`pnpm db:reset` 只用乾淨 seed — seed 是理想資料，缺乏 prod 常見的髒資料殘留（NULL / orphan FK / 格式不一致 / 歷史遺留）。staging 或 prod snapshot 才能暴露 disposition 漏列的 class。

### 驗證步驟

1. 在 staging DB 上 `supabase migration up`（或等效命令）跑該 migration
2. 檢查 migration 輸出有無 error / warning
3. 抽查每個 disposition class 至少一筆 row 的結果
4. 確認未被 disposition 涵蓋的 row 數量為 0（`SELECT count(*) WHERE <negation of all predicates>`）

### 何時從 SHOULD 升級為 MUST

- 目標表 row 數 > 10,000
- migration 含 `ALTER COLUMN ... USING`（型別轉換不可逆）
- migration 含 `DELETE` 或 `TRUNCATE`（資料不可逆）
