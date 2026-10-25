---
description: Supabase Migration 操作規範
paths: ['supabase/migrations/**/*.sql', 'server/**/*.ts', 'packages/*/server/**/*.ts']
---
<!-- Clade native rule; source: rules/modules/db-schema/supabase/migration.md; edit canonical source -->
<!-- clade-targets: claude,agents -->

# Migration

- **每一個** migration 檔的檔名與 timestamp **MUST** 由 Supabase CLI 產生：`supabase migration new <name>`；已採用宣告式 schema 的 repo 也可用 `supabase db schema declarative sync`（產出是草稿，處置義務見 `declarative-schema.md`）— **NEVER** create .sql manually
- **MUST** `SET search_path = ''` in ALL SECURITY DEFINER functions
- **NEVER** put SECURITY DEFINER functions in exposed schemas（`public`）— 放在 private schema，僅透過 GRANT 開放
- **MUST** use `WITH (security_invoker = true)` on ALL views — view 預設 bypass RLS（以 owner 權限執行），不加等於 RLS 失效
- **NEVER** modify or delete applied migrations
- **NEVER** use MCP `execute_sql` for DDL — `supabase_admin` owner breaks CI/CD。唯一例外：修 `must be owner of table` 時，由同一條 MCP 連線 `ALTER ... OWNER TO postgres` 並補 `schema_migrations` 記錄（步驟見 `supabase-migration` skill 的 `rules/疑難排解與Owner修復判準.md`）
- **MUST** use `bigint GENERATED ALWAYS AS IDENTITY` for new table primary keys — **NEVER** `bigserial`（SQL 標準，避免 sequence ownership 問題）
- Existing tables using `bigserial` **SHALL NOT** be migrated（風險高、收益低）
- **每一個** migration 檔新增或修改後都 **MUST** 依 runtime variant 跑 reset → lint → gen types → typecheck，**不是只處理最後一個**（具體命令見對應 `db-runtime/<variant>` rule，例如 self-hosted 走 `pnpm db:reset` / `pnpm db:lint` / `pnpm db:types`；local docker 走 `supabase db reset` / `supabase db lint` / `supabase gen types typescript --local`）
- **生成型別檔（`supabase gen types` 的輸出）NEVER 手改**：型別不對就改 migration 再重生；手改會在下一次重生時被蓋掉，且期間 typecheck 驗的是假的 schema
- **API 驗證 schema MUST 綁在生成型別上**：寫入用的 Zod schema 以 `z.ZodType<TablesInsert<'x'>>`／`TablesUpdate<'x'>`（或等價的型別斷言）與生成型別連結，讓上一條的 gen types → typecheck 能抓到欄位漂移；**NEVER** 寫一份與生成型別毫無編譯期連結的平行 Zod
- 寫入後要觸發非同步副作用（寄信、通知、索引、webhook）時，事件與業務資料 **MUST** 在同一個 transaction（RPC 或 pgmq）寫入，派送與冪等判準見 [[audit-pattern]] § Domain events（非同步副作用）
- **看到 `relation … does not exist` / `column … does not exist` / `PGRST204` / `PGRST205` 先診斷，NEVER 先 migrate 或 reset**：先跑唯讀檢查——`supabase migration list`（local 與 remote 的套用差異）與 `supabase db diff`（schema 與 migration 歷史的 drift，不帶 `-f` 只印不寫；已採用宣告式 schema 的 repo 改用 `declarative-schema.md` 第 4 步的 `sync --no-apply` 判 drift）。有未套 migration 才套；有 drift 先補 migration；兩者都乾淨才往 code、schema cache 或連錯環境方向查
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
  view、`auth.users` 暴露、function `search_path` 未設等）**MUST** 當場修掉，或依 [[follow-up-register]] 登記（lifecycle repo：plan § Open work；
  未遷移 consumer：`docs/tech-debt.md` entry）並在完成報告寫明 work id 或編號
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
- **MUST** 由 CLI 產生檔名（見本檔開頭第一條），**NEVER** 手寫 timestamp
- **MUST** 偵測到 out-of-order 時用 `git mv` rename 到當下 UTC timestamp 並重發版本

### NEVER

- **NEVER** 在 `supabase db push` 加 `--include-all` flag — 永久關掉 supabase 的 out-of-order 保護，任何後續漂移都會默默放行
- **NEVER** 為了「保留 commit 順序」而手改 migration 檔 timestamp — 用 `supabase migration new` 重生

### Timestamp 不可變

Migration 檔名的 timestamp prefix 是 `supabase_migrations.version` 的 identity key；remote DB apply 之後就不可變。上方「rename 到當下 UTC timestamp」只適用於**尚未 apply 到任何 remote** 的 migration。

- 已 commit 進 main **且** remote DB 已 apply 的 migration **NEVER** rename、delete 或 regenerate timestamp——即使 SQL 內容完全相同
- Worktree 內跑 `supabase db reset`／`supabase migration new` 後 **MUST** 比對既有 migration 檔名與 main 相同；不同就 STOP、還原成 main 的檔名，不 commit 新 timestamp
- **NEVER** 在 worktree 重新 `supabase migration new <已存在的 migration 名>`——會產生新 timestamp 取代舊的
- **NEVER** 假設「local `db:reset` 過了 = remote 也會過」：local 從 scratch apply，不知道 remote 的 `supabase_migrations` 記錄；timestamp 一變，`db push` 就報 `Remote migration versions not found in local migrations directory`（[[pitfall-migration-rename-breaks-remote-db-push]]）
- commit 前偵測：`git diff --cached --diff-filter=R -- 'supabase/migrations/' | grep -q . && echo "BLOCK: migration renamed" || echo "OK"`

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

Header 是部署決策證據，不能覆寫分類器結果。`maintenance_required` 與 `review_required` 仍 **MUST** hard stop，完成 rollback／maintenance／review decision 後才可核准；宣告值不是合法等級時分類器以 `review_required` 處理。

## Schema 暴露策略

Template 預設只使用 `public` schema，並被 PostgREST 自動暴露為 Data API。

需要不被 PostgREST 暴露的 `SECURITY DEFINER` function、system-level helper 或 audit / internal log 表時，新增 private schema：

```sql
-- 1. 建 schema（不加進 exposed schemas：Cloud 是 Dashboard → API Settings，self-hosted 是 PGRST_DB_SCHEMAS；
--    PostgREST 只看那份清單）
create schema if not exists core;

-- 2. 給會呼叫 core 物件的 role USAGE（RLS policy 內的 helper 與下方 INVOKER wrapper 都以
--    caller 身分解析 core.*，沒有 USAGE 會 permission denied）。USAGE 不等於暴露，core 仍不進 Data API
grant usage on schema core to authenticated;

-- 3. 在 core 中 create function；function EXECUTE 預設給 PUBLIC，先收回再明確授權
create or replace function core.fn_helper(...)
returns ...
language plpgsql
security definer
set search_path = ''
as $$ ... $$;

revoke execute on function core.fn_helper from public, anon;
grant execute on function core.fn_helper to authenticated;

-- 4. 需要讓 client 呼叫時，在 public 建薄 wrapper（SECURITY INVOKER，RLS 在 caller 身分下執行；
--    權限檢查放在 core 的實作內）。public 的新 function 由 Supabase default privileges 自動給
--    anon / authenticated EXECUTE，GRANT 不會縮小範圍，MUST 先 revoke
create or replace function public.fn_helper_wrapper(...)
returns ...
language sql
security invoker
set search_path = ''
as $$
  select core.fn_helper(...);
$$;

revoke execute on function public.fn_helper_wrapper from public, anon;
grant execute on function public.fn_helper_wrapper to authenticated;
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

`declarative sync` 產生的 migration 受同一份 checklist 約束，見 `declarative-schema.md`。

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
