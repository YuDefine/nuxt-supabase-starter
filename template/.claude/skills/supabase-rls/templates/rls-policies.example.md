
# RLS policy 組（範例：部門資料表，manager 可寫、staff 可讀）

輸出到目標 migration 檔（`supabase/migrations/<timestamp>_<topic>.sql`）；只複製 code block 內容。

```sql
ALTER TABLE app.departments ENABLE ROW LEVEL SECURITY;
-- table owner 是業務程式也會使用的 app_owner role，依 rls-policy.md 加 FORCE
ALTER TABLE app.departments FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON app.departments TO authenticated;

CREATE POLICY "Staff can read departments" ON app.departments
FOR SELECT TO authenticated USING (
  core.current_user_role() IN ('admin', 'manager', 'staff')
);

CREATE POLICY "Manager can insert departments" ON app.departments
FOR INSERT TO authenticated WITH CHECK (
  core.current_user_role() IN ('admin', 'manager')
);

CREATE POLICY "Manager can update departments" ON app.departments
FOR UPDATE TO authenticated USING (
  core.current_user_role() IN ('admin', 'manager')
);

CREATE POLICY "Manager can delete departments" ON app.departments
FOR DELETE TO authenticated USING (
  core.current_user_role() IN ('admin', 'manager')
);
```
