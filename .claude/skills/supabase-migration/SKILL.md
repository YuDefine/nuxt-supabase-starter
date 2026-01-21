# Supabase Migration 規範

當執行 `supabase migration new` 或修改 migration 檔案時，自動載入此規範。

---

## 核心原則

### 1. Local-First（CRITICAL）

**所有 migration 必須先在本地建立、測試通過後，才能 push 到 remote！**

```bash
# ✅ 正確流程
supabase migration new <description>           # 1. 本地建立
# 編輯 migration 檔案
supabase db reset                              # 2. 本地測試
supabase db lint --level warning               # 3. 安全檢查
supabase gen types typescript --local | tee app/types/database.types.ts > /dev/null
supabase db push                               # 4. 最後才 push（或由 CI/CD 處理）

# ❌ 禁止
# - 不要用 mcp__remote-supabase__apply_migration 建立 migration
# - 不要用 Write tool 或 touch 手動建立 .sql 檔案
# - 不要直接在 Supabase Dashboard 修改 schema
```

### 2. 不可變原則

**已套用的 migration 絕對不可修改或刪除！** 需修正請建立新的 migration。

### 3. search_path 為空字串（CRITICAL）

**所有 `SECURITY DEFINER` 函式必須使用 `SET search_path = ''`！**

```sql
-- ✅ 正確
CREATE OR REPLACE FUNCTION your_schema.my_function()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''  -- 必須是空字串！
AS $$ BEGIN
  SELECT * FROM your_schema.users WHERE id = auth.uid();  -- 使用完整 schema 名稱
END; $$;

-- ❌ 禁止
SET search_path = public, pg_temp  -- 絕對禁止！
SET search_path = public           -- 禁止！
```

### 4. View 為 security_invoker

所有 view 需設定 `security_invoker = true`：

```sql
CREATE OR REPLACE VIEW your_schema.my_view
WITH (security_invoker = true)
AS SELECT ...;
```

---

## 開發流程

```bash
# 1. 產生新 migration
supabase migration new add_tool_table

# 2. 編輯 SQL（保持單一主題：新增欄位 / 建表 / 改 policy）

# 3. 套用到本機
supabase db reset             # 或 pnpm db:reset（若要帶 seed）

# 4. 安全檢查
supabase db lint --level warning

# 5. 重新產生 TypeScript types
supabase gen types typescript --local | tee app/types/database.types.ts > /dev/null

# 6. 執行測試 / 手動驗證
pnpm typecheck
```

---

## Schema 規範

### Schema 邊界建議

- **`core` 或 `auth`**: 授權相關（`user_roles`、`allowed_emails`、`user_preferences`）
- **`app` 或專案名稱**: 業務資料表
- **`public`**: 不存放業務資料，僅作 RPC 入口薄 wrapper

### 命名規則

- 表名：snake_case 複數（`tool_inserts`）
- 欄位：snake_case（`created_at`）
- 函式：snake_case（`get_user_role`）
- Enum：snake_case（`user_role`）

---

## 函式模板

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

## Sequence 同步

當使用 `INSERT ... (id, ...)` 直接指定 ID 匯入資料時，sequence 不會自動更新：

```sql
-- 重設 sequence
SELECT setval(
  'your_schema.table_name_id_seq',
  (SELECT COALESCE(MAX(id), 0) + 1 FROM your_schema.table_name),
  false
);
```

---

## 疑難排解

| 問題                                       | 原因                            | 解法                                 |
| ------------------------------------------ | ------------------------------- | ------------------------------------ |
| `duplicate key violates unique constraint` | 資料匯入後 sequence 未同步      | 重設 sequence 為 `max(id) + 1`       |
| `type "xxx" already exists`                | 遠端尚有舊 schema               | 使用 `IF NOT EXISTS` 或 `repair`     |
| `function_search_path_mutable`             | 函式缺少 `SET search_path = ''` | 重寫函式                             |
| `schema_migrations` 不一致                 | 有人手動改遠端                  | `migration list --linked` → `repair` |

---

## 檢查清單

Migration 提交前確認：

- [ ] 使用 `supabase migration new` 建立（非手動建立 .sql）
- [ ] 所有 `CREATE FUNCTION` 都有 `SET search_path = ''`
- [ ] 所有 View 都有 `security_invoker = true`
- [ ] 所有表格/函式引用使用 schema 前綴
- [ ] `supabase db reset` 可正常執行
- [ ] `supabase db lint --level warning` 零警告
- [ ] `pnpm typecheck` 通過
- [ ] RLS 已設定（如適用）
