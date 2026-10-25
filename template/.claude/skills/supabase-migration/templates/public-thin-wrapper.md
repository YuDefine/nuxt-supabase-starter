
# public thin wrapper（樣板）

輸出到同一支 migration 檔，接在 private 實作之後；只複製 code block 內容。wrapper 是 `SECURITY INVOKER`，RLS 在 caller 身分下執行；繞過 RLS 的邏輯只在 private schema 的 DEFINER 函式內。wrapper 以 caller 身分呼叫 private 實作，`{{GRANTEE_ROLE}}` 需要 private schema 的 `USAGE` 與 private 函式的 `EXECUTE`（照 `security-definer-function.md` 授權；USAGE 不會把 schema 加進 Data API）。`public` 的新函式由 Supabase default privileges 自動給 `anon`／`authenticated` EXECUTE，所以先 `REVOKE` 再 `GRANT`。

```sql
CREATE OR REPLACE FUNCTION public.{{FUNCTION_NAME}}(
{{PARAMETERS}}
)
RETURNS {{RETURN_TYPE}}
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT * FROM {{PRIVATE_SCHEMA}}.{{FUNCTION_NAME}}({{ARGUMENTS}});
$$;

REVOKE EXECUTE ON FUNCTION public.{{FUNCTION_NAME}} FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.{{FUNCTION_NAME}} TO {{GRANTEE_ROLE}};
```
