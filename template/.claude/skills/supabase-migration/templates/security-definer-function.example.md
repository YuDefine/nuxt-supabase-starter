
# SECURITY DEFINER 函式（範例）

輸出到目標 migration 檔（`supabase/migrations/<timestamp>_<topic>.sql`）；只複製 code block 內容。

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
  IF your_schema.current_user_role() NOT IN ('admin', 'manager') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  RETURN QUERY
  SELECT t.id, t.name
  FROM your_schema.some_table t
  WHERE t.param = p_param1;
END;
$$;

-- 函式 EXECUTE 預設給 PUBLIC：先收回，再明確 GRANT；USAGE 讓 caller 能解析 schema，不等於暴露給 Data API
GRANT USAGE ON SCHEMA your_schema TO authenticated;
REVOKE EXECUTE ON FUNCTION your_schema.my_function FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION your_schema.my_function TO authenticated;
```
