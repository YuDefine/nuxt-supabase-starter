# RLS 政策最佳實踐

本文檔說明 Row Level Security (RLS) 的設計原則與常見模式。

---

## 1. 核心原則

### 1.1 Service Role 繞過（CRITICAL）

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

### 1.2 RLS 開啟原則

所有 Table 預設必須開啟 RLS：

```sql
-- 新建表後立即啟用 RLS
ALTER TABLE your_schema.new_table ENABLE ROW LEVEL SECURITY;

-- 強制所有使用者（包括 table owner）都要通過 RLS
ALTER TABLE your_schema.new_table FORCE ROW LEVEL SECURITY;
```

---

### 1.3 使用 Helper 函式

建議建立 helper 函式，而非直接查表：

```sql
-- ✅ 正確：使用 helper 函式
your_schema.current_user_role()
your_schema.current_user_id()

-- ❌ 錯誤：直接查表（效能差、容易出錯）
SELECT role FROM your_schema.user_roles WHERE id = auth.uid()
```

---

## 2. Policy 模板

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

## 3. 效能優化

### 3.1 使用子查詢快取

```sql
-- ✅ 效能好：使用 (SELECT ...) 包裝，讓 Postgres 快取結果
USING ((SELECT auth.role()) = 'service_role')

-- ❌ 效能差：每行都會重新計算
USING (auth.role() = 'service_role')
```

### 3.2 避免在 Policy 中做複雜查詢

```sql
-- ❌ 避免：複雜的子查詢會影響效能
USING (
  EXISTS (
    SELECT 1 FROM your_schema.permissions
    WHERE user_id = auth.uid()
    AND resource_id = your_table.id
    AND permission = 'read'
  )
)

-- ✅ 改用 helper 函式封裝邏輯
USING (your_schema.can_read_resource(your_table.id))
```

### 3.3 為 RLS 欄位建立索引

```sql
-- 如果 policy 經常用到某欄位，確保有索引
CREATE INDEX idx_resources_owner ON your_schema.resources(owner_id);
CREATE INDEX idx_resources_department ON your_schema.resources(department_id);
```

---

## 4. 常見問題

| 症狀                 | 原因                     | 解法                                          |
| -------------------- | ------------------------ | --------------------------------------------- |
| Toast 成功但資料沒變 | 缺少 `service_role` 繞過 | 加上 `(SELECT auth.role()) = 'service_role'`  |
| API 回傳 HTML        | 路由衝突                 | 避免同目錄下同時用 `[id].ts` 和 `[id]/xxx.ts` |
| 查詢回傳空陣列       | RLS 未開放讀取           | 檢查 SELECT policy                            |
| 查詢很慢             | Policy 中有複雜子查詢    | 改用 helper 函式或加索引                      |

---

## 5. 除錯技巧

### 5.1 檢查 Policy 是否生效

```sql
-- 以特定使用者身份測試
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub": "user-uuid-here"}';

SELECT * FROM your_schema.your_table;
```

### 5.2 查看現有 Policy

```sql
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'your_schema';
```

### 5.3 使用 EXPLAIN ANALYZE

```sql
EXPLAIN ANALYZE SELECT * FROM your_schema.your_table;
```

---

## 6. 檢查清單

建立 RLS Policy 前確認：

- [ ] 包含 `(SELECT auth.role()) = 'service_role'` 繞過
- [ ] 使用 `(SELECT ...)` 包裝 auth 函式
- [ ] 使用 helper 函式而非直接查表
- [ ] 寫入操作（INSERT/UPDATE/DELETE）都有對應 policy
- [ ] 相關欄位已建立索引
- [ ] `supabase db lint --level warning` 無警告
