---
name: supabase-migration
description: >-
  Supabase migration 檔與 schema DDL 規範。觸發：supabase migration new、CREATE FUNCTION / ALTER TABLE / CREATE INDEX。NOT for RLS policy 的內容設計（走 supabase-rls）。
---


# Supabase Migration 規範

Migration 核心規則已定義在 `rules/modules/db-schema/supabase/migration.md`（Local-First、MCP 禁止 DDL、search_path、不可變原則）——該規約帶 `paths:` gating，三端都投影。
本 skill 補充該規約未涵蓋的實作細節。

> **PR-isolated DB preview env / schema diff gate / production data sanitization** 規約見 `rules/core/db-preview-env.md`（capability + safety contract）與 `rules/modules/db-runtime/supabase-self-hosted/preview-env.md`（self-host 實作層 + image trip-wires）。Cookbook 範本：`vendor/snippets/db-preview-env/`。

## MCP 禁止執行 DDL

**禁止使用以下 MCP 工具執行 DDL（CREATE / ALTER / DROP）：**

- `mcp__remote-supabase__apply_migration`
- `mcp__remote-supabase__execute_sql`

**原因：** MCP 使用 `supabase_admin` role 連線，透過它建立的 table/index/function 的 owner 是 `supabase_admin` 而非 `postgres`。當 CI/CD 用 migration 檔案部署時，`postgres` role 無法修改這些物件，導致部署失敗。

**正確做法：**

- 所有 DDL 透過 `supabase migration new` 建立 migration 檔案
- 透過 CI/CD pipeline 部署（owner = `postgres`）
- Remote MCP **只能用於**：SELECT 查詢、除錯、檢查 table owner

**與官方 skill 的分界（不是矛盾）**：上游 `supabase` skill 說「用 `execute_sql` / `supabase db query`
改 schema 再生成 migration」，講的是**本機 local DB 的迭代**。本節禁的是 **remote** MCP
（`mcp__remote-supabase__*`）跑 DDL —— 兩者針對不同的資料庫。對 local DB 迭代照上游做法沒問題，
對 remote **NEVER** 跑 DDL。

## View 安全與 SECURITY DEFINER

`security_invoker = true`（view 預設繞過 RLS）與「`SECURITY DEFINER` 函式不放 exposed schema」
兩條的**原理**由官方 `supabase` skill 的 Security checklist 提供，本檔只補自家落地形態：

```sql
-- private schema 放實作 + 明確 GRANT
CREATE FUNCTION your_schema.safe_func() ... SECURITY DEFINER SET search_path = '' ...;
GRANT EXECUTE ON FUNCTION your_schema.safe_func TO authenticated;
```

需要透過 PostgREST（Data API）呼叫時，在 `public` 建 thin wrapper（`SECURITY INVOKER`）呼叫
private schema 的實作，**NEVER** 直接把 `SECURITY DEFINER` 函式放進 `public`。

## 開發流程

```bash
supabase migration new <description>    # 建立 migration
# 編輯 SQL（保持單一主題）
supabase db reset                       # 套用到本機
supabase db lint --level warning        # 安全檢查
supabase db advisors                    # Schema 建議（CLI v2.81.3+，涵蓋 index/security/performance）
supabase gen types typescript --local | tee app/types/database.types.ts > /dev/null
pnpm typecheck                          # 類型檢查
```

> `supabase db advisors` 需 CLI v2.81.3+。若版本不足，可用 MCP `get_advisors` 替代。

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

### 為什麼

Supabase `db push` 比對 remote `supabase_migrations.version` 與 local `supabase/migrations/` 的 timestamp prefix。Remote 有 `20260604051558`（已 apply）但 local 改成 `20260605065826`（同內容不同 timestamp）→ `db push` 報 `Remote migration versions not found in local migrations directory` → deploy 失敗。Local `db:reset` 從 scratch 永遠成功（不知道 remote state），是典型 dev-prod parity gap。

Reference: [[pitfall-migration-rename-breaks-remote-db-push]]

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
- 可用 clade script prototype，來源 `plugins/hub-db-runtime-supabase-self-hosted/scripts/postgrest-resilience/`，由本 skill 的 resource declaration 投影到各 runtime 的 skill-local `scripts/postgrest-resilience/`。
- `classify-migration.mjs <migration.sql>`、`ready-watch.mjs --url=<admin-ready-url>`、`smoke-runner.mjs --endpoint=<name=url>` 均從該 skill-local 目錄以 Node 執行；找不到投影資源時 **NEVER** 改用其他 runtime 的路徑猜一個，回報標準未送達並保留 evidence 要求。

## Schema 規範

### Schema 邊界

- **core / auth**: 授權相關（user_roles、allowed_emails、user_preferences）
- **app / 專案名稱**: 業務資料表
- **public**: 不存放業務資料，僅作 RPC 入口薄 wrapper

### 命名規則

- 表名：snake_case 複數（tool_inserts）
- 欄位：snake_case（created_at）
- 函式：snake_case（get_user_role）
- Enum：snake_case（user_role）

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

## 檢查清單

- [ ] 使用 `supabase migration new` 建立（遵循 `db-schema/supabase` migration 規約）
- [ ] 所有函式有 `SET search_path = ''`（遵循 `db-schema/supabase` migration 規約）
- [ ] **SECURITY DEFINER 函式不在 `public` schema**（放 private schema + GRANT）
- [ ] 所有 View 有 `security_invoker = true`
- [ ] 表格/函式引用使用 schema 前綴
- [ ] Production migration 已分類：online-safe / expand-contract / maintenance-required
- [ ] Self-host production reload 有 PostgREST `/ready` gate 與 smoke evidence
- [ ] `supabase db reset` + `db lint` + `db advisors` + `pnpm typecheck` 通過
- [ ] RLS 已設定（如適用）


## Cursor host contract

The resource declaration projects helpers under `.cursor/skills/supabase-migration/scripts/postgrest-resilience/`. Run each `.mjs` helper with the Cursor terminal command facility and Node from the repository cwd; preserve the returned terminal output as evidence.
