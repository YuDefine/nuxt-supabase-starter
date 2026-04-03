# 疑難排解

| 問題                                       | 原因                          | 解法                                              |
| ------------------------------------------ | ----------------------------- | ------------------------------------------------- |
| `must be owner of table xxx`               | 表格 owner 是 supabase_admin  | 透過 MCP 執行 `ALTER TABLE xxx OWNER TO postgres` |
| `duplicate key violates unique constraint` | 資料匯入後 sequence 未同步    | 重設 sequence 為 max(id) + 1                      |
| `type "xxx" already exists`                | 遠端尚有舊 schema             | 使用 IF NOT EXISTS 或 repair                      |
| `function_search_path_mutable`             | 函式缺少 SET search_path = '' | 重寫函式                                          |
| schema_migrations 不一致                   | 有人手動改遠端                | `migration list --linked` → repair                |

## Owner 問題修復流程

若 CI/CD 出現 `must be owner of table xxx` 錯誤：

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
