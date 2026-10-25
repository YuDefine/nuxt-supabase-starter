
# Rule 1 - 依症狀對表處置

- Level: `SHOULD`

| 症狀 | 原因 | 處置 |
| --- | --- | --- |
| `must be owner of table xxx` | 表格 owner 是 `supabase_admin` | 走 Rule 2 的 owner 修復 |
| `duplicate key violates unique constraint` | 資料匯入後 sequence 未同步 | 重設 sequence 為 `max(id) + 1`（`DDL撰寫慣例判準.md` Rule 3） |
| `type "xxx" already exists` | 遠端尚有舊 schema | 使用 `IF NOT EXISTS` 或 `migration repair` |
| `function_search_path_mutable` | 函式缺少 `SET search_path = ''` | 用新 migration 重寫函式 |
| `schema_migrations` 不一致 | 有人手動改遠端 | `supabase migration list --linked` 比對後 `migration repair` |
| `Remote migration versions not found in local migrations directory` | 已 apply 的 migration 被改名或重生 timestamp，或共用 DB 有別 repo 的 version | 依 `migration.md` § Timestamp 不可變 還原檔名；共用 DB 走該檔的 catalog-alignment stub |

## Good Example

- 這個例子是好的，因為它先對症狀找原因再處置。

```text
CI：duplicate key violates unique constraint "orders_pkey"
→ 前一支 migration 以指定 ID 匯入 → 新 migration 補 setval
```

## Bad Example

- 這個例子是壞的，因為它直接用 MCP 在遠端改資料繞過症狀。

```text
CI：duplicate key → 用 MCP execute_sql 刪掉衝突的 row
```

# Rule 2 - owner 修復是 MCP 跑 DDL 的唯一例外，只做這四步

- Level: `MUST`
- CI/CD 報 `must be owner of table xxx` 時，物件 owner 已是 `supabase_admin`，`postgres` 改不了它，只能由同一條 MCP 連線把 owner 交還給 `postgres`。除了下列四步，remote MCP 仍 **NEVER** 跑 DDL。

## Good Example

- 這個例子是好的，因為它只做查詢、交還 owner、補 migration 記錄，再重跑 CI/CD。

```sql
-- 1. 透過 MCP 查詢問題表格
SELECT schemaname, tablename, tableowner
FROM pg_tables
WHERE schemaname IN ('your_schema', 'core') AND tableowner != 'postgres';

-- 2. 透過 MCP 修正 owner
ALTER TABLE your_schema.xxx OWNER TO postgres;

-- 3. 透過 MCP 標記 migration 為已套用
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('20260127161029', 'migration_name', ARRAY['...'])
ON CONFLICT (version) DO NOTHING;

-- 4. 重新執行 CI/CD
```

## Bad Example

- 這個例子是壞的，因為它趁 owner 修復順手用 MCP 補其他 DDL。

```sql
ALTER TABLE your_schema.xxx OWNER TO postgres;
ALTER TABLE your_schema.xxx ADD COLUMN note text;
```
