---
description: 建立 Supabase migration，確保符合安全規範
---

## User Input

```text
$ARGUMENTS
```

## Outline

建立新的 Supabase migration，確保符合 CLAUDE.md 中的所有規範。

### Step 1: 確認需求

詢問使用者要建立什麼樣的 migration：

- 新增表格？
- 修改欄位？
- 建立函式？
- 新增 RLS 政策？

### Step 2: 建立 Migration 檔案

使用 Supabase CLI 建立 migration（**禁止手動建立 .sql 檔案**）：

```bash
supabase migration new <description_in_snake_case>
```

### Step 3: 撰寫 Migration 內容

根據需求撰寫 SQL，**必須遵守以下規範**：

#### 函式規範（CRITICAL）

```sql
-- ✅ 正確：search_path 必須是空字串
CREATE OR REPLACE FUNCTION schema_name.function_name()
RETURNS return_type
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''  -- 必須是空字串！
AS $$
BEGIN
  -- 使用完整路徑：schema_name.table_name
  SELECT * FROM core.users WHERE id = auth.uid();
END;
$$;
```

```sql
-- ❌ 禁止：任何其他 search_path 值
SET search_path = public, pg_temp  -- 絕對禁止！
SET search_path = public           -- 禁止！
```

#### Schema 規範

- 使用正確的 schema：`core.`, `tdms.`, `public.`
- 所有表格/函式引用使用完整路徑

### Step 4: 本地測試與類型產生（自動）

依序執行以下步驟，任何步驟失敗則停止並顯示錯誤：

```bash
# 1. 重置資料庫並套用 migration
supabase db reset

# 2. 執行安全檢查（必須零警告）
supabase db lint --level warning

# 3. 自動產生 TypeScript 類型
supabase gen types typescript --local | tee app/types/database.types.ts > /dev/null

# 4. 類型檢查
pnpm typecheck
```

**自動產生類型**：Step 3 會自動更新 `app/types/database.types.ts`，確保型別定義與資料庫 schema 同步。

**錯誤處理**：

- `db reset` 失敗 → 檢查 SQL 語法
- `db lint` 有警告 → 檢查 search_path 和 RLS
- `typecheck` 失敗 → 更新使用到舊型別的程式碼

### Step 5: 驗證結果

1. 確認 `supabase db lint` 沒有警告
2. 確認 `pnpm typecheck` 通過
3. 顯示 migration 檔案內容供使用者確認

### Step 6: 完成報告

```text
✅ Migration 建立完成！

檔案: supabase/migrations/YYYYMMDDHHMMSS_description.sql
狀態:
- db reset: ✓
- db lint: ✓
- typecheck: ✓

下一步：
- 測試功能是否正常
- 準備好後執行 `supabase db push` 推送到遠端
```

## 安全檢查清單

- [ ] 所有 `CREATE FUNCTION` 都有 `SET search_path = ''`
- [ ] 沒有使用 `SET search_path = public` 或 `pg_temp`
- [ ] 所有表格/函式引用使用 schema 前綴
- [ ] `supabase db lint` 零警告
- [ ] RLS 政策已設定（如適用）
