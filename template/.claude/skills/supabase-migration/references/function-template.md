# 函式模板

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
