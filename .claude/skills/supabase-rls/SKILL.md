# Supabase RLS 政策規範

當建立或修改 RLS Policy（`CREATE POLICY`、`ALTER POLICY`）時，自動載入此規範。

---

## 核心原則

### 1. Service Role 繞過（CRITICAL）

**API 寫入操作的 RLS policy 必須包含 `service_role` 繞過！**

```sql
-- ✅ 正確：包含 service_role 繞過
CREATE POLICY "Allow manager update" ON your_schema.your_table FOR UPDATE
USING (
  (SELECT auth.role()) = 'service_role'  -- ⚠️ 必須加這行！
  OR your_schema.current_user_role() IN ('admin', 'manager')
);

-- ❌ 錯誤：缺少 service_role 繞過
CREATE POLICY "Allow manager update" ON your_schema.your_table FOR UPDATE
USING (
  your_schema.current_user_role() IN ('admin', 'manager')
);
```

**為什麼需要？**

- Server API 使用 `service_role` key 執行操作
- 缺少此繞過會導致「Toast 成功但資料沒變」的詭異問題

---

### 2. 使用 Helper 函式

建議建立 helper 函式，而非直接查表：

```sql
-- ✅ 正確：使用 helper 函式
your_schema.current_user_role()           -- 取得當前使用者角色
your_schema.current_user_id()             -- 取得當前使用者 ID

-- ❌ 錯誤：直接查表（效能差、容易出錯）
SELECT role FROM your_schema.user_roles WHERE id = auth.uid()
```

---

### 3. RLS 開啟原則

所有 Table 預設必須開啟 RLS：

```sql
-- 新建表後立即啟用 RLS
ALTER TABLE your_schema.new_table ENABLE ROW LEVEL SECURITY;

-- 強制所有使用者（包括 table owner）都要通過 RLS
ALTER TABLE your_schema.new_table FORCE ROW LEVEL SECURITY;
```

---

## Policy 模板

### 讀取政策（SELECT）

```sql
-- 登入使用者可讀取
CREATE POLICY "Authenticated users can read" ON your_schema.your_table
FOR SELECT USING (
  (SELECT auth.role()) = 'service_role'
  OR (SELECT auth.role()) = 'authenticated'
);

-- 僅特定角色可讀取
CREATE POLICY "Staff can read" ON your_schema.your_table
FOR SELECT USING (
  (SELECT auth.role()) = 'service_role'
  OR your_schema.current_user_role() IN ('admin', 'manager', 'staff')
);
```

### 寫入政策（INSERT/UPDATE/DELETE）

```sql
-- Manager 以上可寫入
CREATE POLICY "Manager can insert" ON your_schema.your_table
FOR INSERT WITH CHECK (
  (SELECT auth.role()) = 'service_role'
  OR your_schema.current_user_role() IN ('admin', 'manager')
);

CREATE POLICY "Manager can update" ON your_schema.your_table
FOR UPDATE USING (
  (SELECT auth.role()) = 'service_role'
  OR your_schema.current_user_role() IN ('admin', 'manager')
);

CREATE POLICY "Manager can delete" ON your_schema.your_table
FOR DELETE USING (
  (SELECT auth.role()) = 'service_role'
  OR your_schema.current_user_role() IN ('admin', 'manager')
);
```

### 僅限 Admin

```sql
CREATE POLICY "Admin only" ON your_schema.sensitive_table
FOR ALL USING (
  (SELECT auth.role()) = 'service_role'
  OR your_schema.current_user_role() = 'admin'
);
```

---

## 角色階層範例

```
admin        → 可以管理所有人、存取所有資料
manager      → 可以管理 staff / unauthorized、存取部門資料
staff        → 僅能管理自己、存取基本資料
unauthorized → 登入但未授權、無存取權限
```

---

## 常見問題

| 症狀                 | 原因                     | 解法                                          |
| -------------------- | ------------------------ | --------------------------------------------- |
| Toast 成功但資料沒變 | 缺少 `service_role` 繞過 | 加上 `(SELECT auth.role()) = 'service_role'`  |
| API 回傳 HTML        | 路由衝突                 | 避免同目錄下同時用 `[id].ts` 和 `[id]/xxx.ts` |
| 查詢回傳空陣列       | RLS 未開放讀取           | 檢查 SELECT policy                            |

---

## 檢查清單

建立 RLS Policy 前確認：

- [ ] 包含 `(SELECT auth.role()) = 'service_role'` 繞過
- [ ] 使用 helper 函式而非直接查表
- [ ] 寫入操作（INSERT/UPDATE/DELETE）都有對應 policy
- [ ] `supabase db lint --level warning` 無警告
