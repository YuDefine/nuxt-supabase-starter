---
name: supabase-migration
description: >-
  Supabase migration 檔與 schema DDL 規範。觸發：supabase migration new、CREATE FUNCTION / ALTER TABLE / CREATE INDEX。NOT for RLS policy 的內容設計（走 supabase-rls）。
---

<!-- clade-skill-scope: project -->

# Supabase Migration 規範

核心規則（`supabase migration new`、search_path、SECURITY DEFINER 不放 exposed schema、view `security_invoker`、不改已 apply 的 migration、MCP 禁 DDL、reset → lint → gen types → typecheck、advisors、expand-contract）在 `rules/modules/db-schema/supabase/migration.md`，本 skill 不複述，只補實作細節。

> **PR-isolated DB preview env / schema diff gate / production data sanitization** 規約見 `rules/core/db-preview-env.md`（capability + safety contract）與 `rules/modules/db-runtime/supabase-self-hosted/preview-env.md`（self-host 實作層 + image trip-wires）。Cookbook 範本：`vendor/snippets/db-preview-env/`。

## MCP 與 DDL

remote MCP（`mcp__remote-supabase__apply_migration` / `execute_sql`）**NEVER** 跑 DDL：它以 `supabase_admin` 建物件，CI/CD 的 `postgres` role 之後改不動。remote MCP 只用於 SELECT、除錯、檢查 owner。上游 `supabase` skill 說用 `execute_sql` 改 schema 再生成 migration，指的是**本機** local DB 迭代，照做沒問題。

## SECURITY DEFINER 落地形態

```sql
-- private schema 放實作 + 明確 GRANT
CREATE FUNCTION your_schema.safe_func() ... SECURITY DEFINER SET search_path = '' ...;
GRANT EXECUTE ON FUNCTION your_schema.safe_func TO authenticated;
```

需要透過 PostgREST（Data API）呼叫時，在 `public` 建 thin wrapper（`SECURITY INVOKER`）呼叫
private schema 的實作，**NEVER** 直接把 `SECURITY DEFINER` 函式放進 `public`。

一個 migration 保持單一主題。

## Migration Timestamp Immutability（hard rule）

Migration 檔名的 timestamp prefix 是 `supabase_migrations.version` 的 identity key。Remote DB apply 後，該 timestamp 就是**不可變的**。

### MUST

- 已 commit 進 main **且** remote DB 已 apply 的 migration **NEVER** rename / delete / regenerate timestamp
- Worktree 內跑 `supabase db reset` / `supabase migration new` 後 **MUST** 驗證既有 migration 檔名未變（`ls supabase/migrations/ | head` 比對 main）
- 發現 worktree 內 migration 檔名與 main 不同 → **STOP**，還原成 main 的檔名，不 commit 新 timestamp

### NEVER

- **NEVER** 在 worktree 重新 `supabase migration new <已存在的 migration 名>` — 會產生新 timestamp 取代舊的
- **NEVER** 手動 rename migration 檔案的 timestamp prefix — 即使 SQL 內容完全相同
- **NEVER** 假設「local db:reset 過了 = remote 也會過」— local 從 scratch apply 不知道 remote 的 `supabase_migrations` 記錄

### 偵測

```bash
# commit 前檢查有無 migration rename
git diff --cached --diff-filter=R -- 'supabase/migrations/' | grep -q . && echo "BLOCK: migration renamed" || echo "OK"
```

timestamp 一變，`db push` 就報 `Remote migration versions not found in local migrations directory`，而 local `db:reset` 從 scratch 照樣成功（[[pitfall-migration-rename-breaks-remote-db-push]]）。

## Production Resilience Classification

Self-host Supabase production migration 前，先分類 migration 風險：

| Classification | Examples | Required action |
| --- | --- | --- |
| `online_safe` | add nullable column, create table, create function v2, create index concurrently, add FK/check `NOT VALID` | 可在線上跑，但仍需 PostgREST `/ready` gate 與 smoke |
| `expand_contract_required` | rename/drop column, change type, drop function signature, replace exposed RPC | 拆成 expand → app rollout → contract，不可一次 deploy |
| `maintenance_required` | unavoidable `ACCESS EXCLUSIVE`, table rewrite, large blocking DML, non-concurrent hot-table index | hard stop；需 rollback/maintenance decision |

規則：

- **NEVER** 宣稱所有 migration 都能零停機。
- **NEVER** 把 app code retry/session fix 當成 migration safety。
- **MUST** 區分 PostgREST schema cache reload 與 DB lock；split surface 不能解除同一張 table 的 blocking lock。
- **MUST** 在 self-host production deploy 保存 `/ready` evidence、traffic smoke summary、PostgREST logs。
- 可用 clade script prototype，來源 `capabilities/modules/db-runtime/supabase-self-hosted/scripts/postgrest-resilience/`，由本 skill 的 resource declaration 投影到各 runtime 的 skill-local `scripts/postgrest-resilience/`。
- `classify-migration.mjs <migration.sql>`、`ready-watch.mjs --url=<admin-ready-url>`、`smoke-runner.mjs --endpoint=<name=url>` 均從該 skill-local 目錄以 Node 執行；找不到投影資源時 **NEVER** 改用其他 runtime 的路徑猜一個，回報標準未送達並保留 evidence 要求。

## Schema 規範

Schema 邊界見 `supabase-arch` skill。命名一律 snake_case：表名複數（`tool_inserts`）、欄位（`created_at`）、函式（`get_user_role`）、enum（`user_role`）。

## Sequence 同步

當使用 INSERT 直接指定 ID 匯入資料時，sequence 不會自動更新：

```sql
SELECT setval(
  'your_schema.table_name_id_seq',
  (SELECT COALESCE(MAX(id), 0) + 1 FROM your_schema.table_name),
  false
);
```

## 參考資料

| 檔案                                                               | 內容                  |
| ------------------------------------------------------------------ | --------------------- |
| [references/function-template.md](references/function-template.md) | DB 函式模板           |
| [references/troubleshooting.md](references/troubleshooting.md)     | 疑難排解 + Owner 修復 |

## 檢查清單（規約之外）

- [ ] 表格／函式引用使用 schema 前綴
- [ ] Production migration 已分類：online-safe / expand-contract / maintenance-required
- [ ] Self-host production reload 有 PostgREST `/ready` gate 與 smoke evidence
- [ ] RLS 已設定（如適用）


## Claude host contract

The resource declaration projects helpers under `.claude/skills/supabase-migration/scripts/postgrest-resilience/`. Run each `.mjs` helper with Claude `Bash` and the Node runner from the repository cwd; preserve the returned terminal output as evidence.
