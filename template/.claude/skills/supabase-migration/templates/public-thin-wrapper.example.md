
# public thin wrapper（範例）

輸出到同一支 migration 檔，接在 private 實作之後；只複製 code block 內容。

```sql
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

-- public 的新函式預設可被 anon 執行；先收回，再只開給 authenticated
REVOKE EXECUTE ON FUNCTION public.my_function FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_function TO authenticated;
```
