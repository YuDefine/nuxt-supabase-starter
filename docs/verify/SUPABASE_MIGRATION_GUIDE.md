# Supabase Migration & Schema Playbook

> 目標：任何人都能在不問人的情況下新增/修改 schema、同步遠端，並確保安全性。若無法照以下流程完成，請在 PR 中修正文檔。

---

## 1. 核心原則

1. **Local-First**：所有 migration 必須先在本地建立、測試通過後，才能 push 到 remote。禁止直接在 remote 建立 migration。
2. **Schema-first**：所有變更必須以 migration SQL 呈現；Supabase Studio 只能用來觀察或做 PoC，結束後必須產生 diff。
3. **search_path 為空字串**：任何 `SECURITY DEFINER` 函式皆需 `SET search_path = ''` 並寫完全限定名稱，否則 `supabase db lint` 會擋下。
4. **View 為 security_invoker**：所有 view 需設定 `security_invoker = true`，避免以 definer 權限繞過 RLS 與 lint。

---

## 2. 開發流程（Schema-first）

```bash
# 1. 產生新 migration
supabase migration new add_new_table

# 2. 編輯 SQL（保持單一主題：新增欄位 / 建表 / 改 policy）

# 3. 套用到本機
supabase db reset

# 4. 安全檢查
supabase db lint --level warning

# 5. 重新產生 TypeScript types
supabase gen types typescript --local | tee app/types/database.types.ts > /dev/null

# 6. 執行測試 / 手動驗證
pnpm typecheck
```

> 若在 Supabase Studio 先操作 → 使用 `supabase db diff --use-migra -f from_gui` 產生 migration 檔，再回到上述流程。

---

## 3. 命名規則

- 表名：snake_case 複數（`tool_inserts`）
- 欄位：snake_case（`created_at`）
- 函式：snake_case（`get_user_role`）
- Enum：snake_case（`user_role`）

---

## 4. 函式模板

```sql
CREATE OR REPLACE FUNCTION your_schema.my_function(
  p_param1 uuid,
  p_param2 text DEFAULT NULL
)
RETURNS TABLE (id uuid, name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- 權限檢查（如需要）
  IF your_schema.current_user_role() NOT IN ('admin', 'manager') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  -- 業務邏輯
  RETURN QUERY
  SELECT t.id, t.name
  FROM your_schema.some_table t
  WHERE t.param = p_param1;
END;
$$;

-- 設定權限
GRANT EXECUTE ON FUNCTION your_schema.my_function TO authenticated;
```

---

## 5. 遠端環境同步

> ⚠️ **重要**：所有 migration 必須遵循 **Local → Test → Push** 流程。
>
> 🚫 **禁止直接在 remote 建立 migration**

### 開發者流程

```bash
# 1. 本地建立 migration
supabase migration new <description>

# 2. 編輯 migration 內容

# 3. 本地測試
supabase db reset
supabase db lint --level warning
pnpm typecheck

# 4. 提交並推送（CI 會處理 supabase db push）
git add .
git commit -m "🗄️ migration: <description>"
git push
```

### 手動同步（僅供除錯或緊急情況）

```bash
# 手動推送 migrations
supabase db push

# 標記已棄用版本
supabase migration list --linked
supabase migration repair --status reverted <timestamp>

# 重建遠端（僅在確定可刪資料時）
supabase db reset --linked
```

---

## 6. GUI 使用準則

| 功能                  | 可否使用 | 備註                                                 |
| --------------------- | -------- | ---------------------------------------------------- |
| 查看資料 / RLS        | ✅       | 無需額外動作                                         |
| 快速修改欄位或 policy | ⚠️       | 僅限 PoC，用完記得 `supabase db diff` 產出 migration |
| 直接在 GUI 建立函式   | ❌       | 無法控制 `search_path`，請改在 repository 編寫       |
| 匯入 SQL              | ❌       | 可能與 Repo diff，不允許                             |

---

## 7. Pre-commit Checklist

- [ ] 所有新增函式皆 `SET search_path = ''`，使用完整 schema 前綴
- [ ] 所有 view 已設定 `security_invoker = true`
- [ ] `supabase db lint --level warning` 無錯誤
- [ ] `supabase db reset` 能順利重建
- [ ] TypeScript types 已更新並納入 Git
- [ ] 文件同步更新

---

## 8. Sequence 同步（資料匯入後必做）

當使用 `INSERT ... (id, ...)` 直接指定 ID 匯入資料時，sequence 不會自動更新。

### 問題徵兆

```
ERROR: duplicate key value violates unique constraint "xxx_pkey"
```

### 修正方式

```sql
-- 重設單一表的 sequence
SELECT setval(
  'your_schema.table_name_id_seq',
  (SELECT COALESCE(MAX(id), 0) + 1 FROM your_schema.table_name),
  false
);
```

---

## 9. 表格 Owner 權限問題

### 問題背景

Self-hosted Supabase 環境中：

- `supabase_admin` 是真正的 superuser
- `postgres` 用戶**不是** superuser，無法修改 `supabase_admin` 擁有的物件
- CI/CD 使用 `postgres` 連線執行 `db push`
- MCP 工具使用 `supabase_admin` 連線

若透過 MCP 執行 DDL（如建立表格），該物件的 owner 會是 `supabase_admin`，導致 CI/CD 無法對其建立索引或修改。

### 預防措施

1. **禁止透過 MCP 建立新表格**：所有 DDL 必須透過 migration 檔案

2. **Migration 中明確指定 owner**（建議做法）：

   ```sql
   CREATE TABLE your_schema.new_table (...);
   ALTER TABLE your_schema.new_table OWNER TO postgres;
   ```

3. **定期檢查 owner 一致性**：

   ```sql
   -- 檢查是否有非 postgres owner 的表格
   SELECT schemaname, tablename, tableowner
   FROM pg_tables
   WHERE schemaname IN ('your_schema', 'core')
     AND tableowner != 'postgres';
   ```

4. **CI/CD 加入 owner 檢查**（可選）：在 deploy 前驗證所有表格 owner 正確

### 修復方式

若發現 owner 不正確，透過 MCP（有 `supabase_admin` 權限）修正：

```sql
ALTER TABLE your_schema.table_name OWNER TO postgres;
```

---

## 10. 疑難排解

| 問題                                                  | 可能原因                        | 解法                                           |
| ----------------------------------------------------- | ------------------------------- | ---------------------------------------------- |
| `must be owner of table xxx`                          | 表格 owner 是 `supabase_admin`  | 參考第 9 節，透過 MCP 修正 owner 為 `postgres` |
| `duplicate key violates unique constraint "xxx_pkey"` | 資料匯入後 sequence 未同步      | 重設 sequence 為 `max(id) + 1`                 |
| `type "xxx" already exists`                           | 遠端尚有舊 schema               | 使用 `IF NOT EXISTS` 或 `repair`               |
| `schema_migrations` 不一致                            | 有人手動改遠端                  | `migration list --linked` → `repair`           |
| `function_search_path_mutable`                        | 函式缺少 `SET search_path = ''` | 重寫函式                                       |

---

使用本指南可以確保所有環境（本機、遠端）保持一致。若流程有遺漏，請直接更新此文件。

---

## 11. Self-hosted Supabase 部署

> Self-hosted 模式適用於需要完全控制資料與基礎設施的情境。開發流程不變，僅部署方式不同。

### 11.1 架構差異

| 項目           | Cloud              | Self-hosted            |
| -------------- | ------------------ | ---------------------- |
| Migration 同步 | `supabase db push` | `docker exec` 執行 SQL |
| CI/CD 整合     | 自動推送           | 手動執行或腳本觸發     |
| 資料庫存取     | API Gateway        | 直接連線或 Tunnel      |
| 回滾機制       | `migration repair` | 手動執行回滾 SQL       |

### 11.2 開發流程（不變）

本地開發流程與 Cloud 完全相同：

```bash
# 1. 建立 migration
supabase migration new <description>

# 2. 編輯 SQL 檔案

# 3. 本地測試
supabase db reset
supabase db lint --level warning

# 4. 產生 TypeScript types
pnpm db:types

# 5. 執行測試
pnpm typecheck
```

### 11.3 部署到 Self-hosted

**方法一：docker exec（推薦）**

```bash
# 複製 migration 到容器
docker cp supabase/migrations/<timestamp>_<name>.sql supabase-db:/tmp/

# 執行 migration
docker exec supabase-db psql -U postgres -d postgres -f /tmp/<timestamp>_<name>.sql
```

**方法二：批次執行**

```bash
# 複製所有 migration 檔案
for f in supabase/migrations/*.sql; do
  docker cp "$f" supabase-db:/tmp/
done

# 依序執行
docker exec supabase-db bash -c \
  'for f in /tmp/*.sql; do psql -U postgres -d postgres -f "$f"; done'
```

**方法三：psql 直連（需 VPN 或內網）**

```bash
PGPASSWORD=<password> psql \
  -h <host> -p 5432 -U postgres -d postgres \
  -f supabase/migrations/<timestamp>_<name>.sql
```

### 11.4 驗證部署

```bash
# 查看 migration 狀態
docker exec supabase-db psql -U postgres -d postgres -c \
  "SELECT * FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 5;"

# 檢查表格結構
docker exec supabase-db psql -U postgres -d postgres -c "\dt public.*"

# 測試 API
curl -s "https://supabase-api.example.com/rest/v1/<table>?select=id&limit=1" \
  -H "apikey: <ANON_KEY>"
```

### 11.5 重啟 PostgREST

如果新增了表格或函式，需要讓 PostgREST 重新載入 schema cache：

```bash
cd /opt/supabase
docker compose restart rest
```

### 11.6 回滾方案

> ⚠️ Self-hosted 沒有 `supabase migration repair` 可用，需手動處理。

**正確做法**：建立修正 migration

```bash
# 1. 建立新的修正 migration
supabase migration new fix_<issue_description>

# 2. 編輯修正 SQL（DROP、ALTER 等）

# 3. 本地測試
supabase db reset

# 4. 部署修正到 Self-hosted
docker cp supabase/migrations/<fix_migration>.sql supabase-db:/tmp/
docker exec supabase-db psql -U postgres -d postgres -f /tmp/<fix_migration>.sql
```

**緊急回滾**：執行回滾腳本

```bash
# 執行預先準備的回滾 SQL
docker exec -i supabase-db psql -U postgres -d postgres \
  < supabase/rollback/<timestamp>_rollback.sql
```

### 11.7 注意事項

- **不要**在 CI/CD 自動推送 migrations 到 Self-hosted（除非有完整測試機制）
- 部署前務必在 staging 環境測試
- 建議為每個 migration 準備對應的回滾腳本
- 部署後記得重啟 PostgREST 以載入新 schema

> 📖 完整指南請參考 [SELF_HOSTED_SUPABASE.md](./SELF_HOSTED_SUPABASE.md)
