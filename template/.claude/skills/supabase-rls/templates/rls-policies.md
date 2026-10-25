
# RLS policy 組（樣板）

輸出到目標 migration 檔（`supabase/migrations/<timestamp>_<topic>.sql`）；只複製 code block 內容。不含 `service_role` bypass 條件，目標 role 用 `TO` 子句指定。Storage bucket policy 依官方 `supabase` skill 寫。

```sql
ALTER TABLE {{SCHEMA}}.{{TABLE}} ENABLE ROW LEVEL SECURITY;
{{FORCE_RLS_LINE}}

GRANT {{PRIVILEGES}} ON {{SCHEMA}}.{{TABLE}} TO {{GRANTEE_ROLE}};

CREATE POLICY "{{SELECT_POLICY_NAME}}" ON {{SCHEMA}}.{{TABLE}}
FOR SELECT TO {{SELECT_ROLE}} USING (
  {{SELECT_CONDITION}}
);

CREATE POLICY "{{INSERT_POLICY_NAME}}" ON {{SCHEMA}}.{{TABLE}}
FOR INSERT TO authenticated WITH CHECK (
  {{WRITE_CONDITION}}
);

CREATE POLICY "{{UPDATE_POLICY_NAME}}" ON {{SCHEMA}}.{{TABLE}}
FOR UPDATE TO authenticated USING (
  {{WRITE_CONDITION}}
);

CREATE POLICY "{{DELETE_POLICY_NAME}}" ON {{SCHEMA}}.{{TABLE}}
FOR DELETE TO authenticated USING (
  {{WRITE_CONDITION}}
);
```

- `{{FORCE_RLS_LINE}}`：table owner 是可能執行業務查詢的 application role 時填 `ALTER TABLE {{SCHEMA}}.{{TABLE}} FORCE ROW LEVEL SECURITY;`，否則刪掉這行。
- `{{SELECT_ROLE}}`：client 直讀填 `public`（條件必須限縮可見範圍），只由 server 讀填 `authenticated`。
- 只限 admin 的表可改成單一 `FOR ALL TO authenticated USING (your_schema.current_user_role() = 'admin')`。
