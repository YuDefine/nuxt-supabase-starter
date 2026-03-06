# Policy 模板

## 讀取政策（SELECT）

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

## 寫入政策（INSERT/UPDATE/DELETE）

```sql
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

## 僅限 Admin

```sql
CREATE POLICY "Admin only" ON your_schema.sensitive_table
FOR ALL USING (
  (SELECT auth.role()) = 'service_role'
  OR your_schema.current_user_role() = 'admin'
);
```

## 角色階層

```
admin        → 可以管理所有人、存取所有資料
manager      → 可以管理 staff / unauthorized、存取部門資料
staff        → 僅能管理自己、存取基本資料
unauthorized → 登入但未授權、無存取權限
```
