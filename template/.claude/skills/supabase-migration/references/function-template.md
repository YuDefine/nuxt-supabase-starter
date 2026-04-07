# 函式模板

## SECURITY DEFINER（需要繞過 RLS）

**必須放在 private schema（非 `public`）**，透過 GRANT 開放。

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

-- 設定權限（明確 GRANT，不依賴 schema exposure）
GRANT EXECUTE ON FUNCTION your_schema.my_function TO authenticated;
```

## 需透過 PostgREST 呼叫時 — thin wrapper 模式

若需要從 client SDK 呼叫（PostgREST 只 expose `public` schema），在 `public` 建立 SECURITY INVOKER wrapper：

```sql
-- public 的 thin wrapper（SECURITY INVOKER，RLS 生效）
CREATE OR REPLACE FUNCTION public.my_function(
  p_param1 uuid,
  p_param2 text DEFAULT NULL
)
RETURNS TABLE (id uuid, name text)
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT * FROM your_schema.my_function(p_param1, p_param2);
$$;

GRANT EXECUTE ON FUNCTION public.my_function TO authenticated;
```

> **注意：** wrapper 本身是 SECURITY INVOKER — RLS 檢查在 caller 身份下執行。實際繞過 RLS 的邏輯封裝在 private schema 的 DEFINER 函式中。
