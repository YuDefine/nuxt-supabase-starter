
# SECURITY DEFINER 函式（樣板）

輸出到目標 migration 檔（`supabase/migrations/<timestamp>_<topic>.sql`）；只複製 code block 內容。**必須放在 private schema（非 `public`）**，透過 GRANT 開放：函式 EXECUTE 預設給 `PUBLIC`，先 `REVOKE` 再 `GRANT`；`{{GRANTEE_ROLE}}` 另需 private schema 的 `USAGE`（不把 schema 加進 exposed schemas，Data API 仍看不到）。

```sql
CREATE OR REPLACE FUNCTION {{PRIVATE_SCHEMA}}.{{FUNCTION_NAME}}(
{{PARAMETERS}}
)
RETURNS {{RETURN_TYPE}}
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF {{PERMISSION_CHECK}} THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

{{BODY}}
END;
$$;

GRANT USAGE ON SCHEMA {{PRIVATE_SCHEMA}} TO {{GRANTEE_ROLE}};
REVOKE EXECUTE ON FUNCTION {{PRIVATE_SCHEMA}}.{{FUNCTION_NAME}} FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION {{PRIVATE_SCHEMA}}.{{FUNCTION_NAME}} TO {{GRANTEE_ROLE}};
```
