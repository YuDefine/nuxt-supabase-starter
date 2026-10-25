
# Rule 1 - 命名 snake_case，物件引用帶 schema 前綴

- Level: `MUST`
- 命名一律 snake_case：表名複數（`tool_inserts`）、欄位（`created_at`）、函式（`get_user_role`）、enum（`user_role`）。
- 表格與函式引用都寫 schema 前綴（`your_schema.table_name`）；`SET search_path = ''` 的函式內沒有前綴就找不到物件。
- schema 落點（授權 helper、業務表、`public`）依 `supabase-arch` skill 的 Schema 邊界判準。

## Good Example

- 這個例子是好的，因為名稱是 snake_case 複數表名，並帶 schema 前綴。

```sql
CREATE TABLE app.tool_inserts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

## Bad Example

- 這個例子是壞的，因為名稱是 camelCase 單數，且沒有 schema 前綴。

```sql
CREATE TABLE toolInsert (id bigserial PRIMARY KEY, createdAt timestamptz);
```

# Rule 2 - SECURITY DEFINER 只放 private schema，Data API 經 SECURITY INVOKER thin wrapper

- Level: `MUST`
- `SECURITY DEFINER` 函式放 private schema，`SET search_path = ''`；函式 EXECUTE 預設給 `PUBLIC`，**MUST** 先 `REVOKE EXECUTE ... FROM PUBLIC, anon` 再對目標 role `GRANT EXECUTE`，只寫 GRANT 不會縮小可呼叫範圍；**NEVER** 直接放進 `public`。
- 需要從 client SDK 經 PostgREST 呼叫時，在 `public` 建 `SECURITY INVOKER` thin wrapper（同樣 `SET search_path = ''`）呼叫 private 實作；RLS 在 caller 身分下執行，繞過 RLS 的邏輯只在 private 的 DEFINER 函式內，且該函式內部自行做權限檢查。wrapper 以 caller 身分呼叫 private 實作，目標 role 需要 private schema 的 `USAGE` 與 private 函式的 `EXECUTE`（USAGE 不會把 schema 加進 exposed schemas）；`public` 的 wrapper 同樣先 `REVOKE ... FROM PUBLIC, anon`（Supabase default privileges 會自動給 `anon`）。
- 實作形態照 `templates/security-definer-function.md` 與 `templates/public-thin-wrapper.md`。

## Good Example

- 這個例子是好的，因為 DEFINER 實作在 private schema，`public` 只有 INVOKER wrapper，兩者都先收回預設 EXECUTE 再只開給 `authenticated`，`authenticated` 也有 `core` 的 USAGE。

```sql
CREATE FUNCTION core.safe_func() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$ BEGIN END; $$;
CREATE FUNCTION public.safe_func() RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$ SELECT core.safe_func(); $$;
GRANT USAGE ON SCHEMA core TO authenticated;
REVOKE EXECUTE ON FUNCTION core.safe_func, public.safe_func FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION core.safe_func, public.safe_func TO authenticated;
```

## Bad Example

- 這個例子是壞的，因為 DEFINER 函式直接放進會被暴露的 `public`。

```sql
CREATE FUNCTION public.safe_func() RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN END; $$;
```

# Rule 3 - 直接指定 ID 匯入資料後同步 sequence

- Level: `MUST`
- 以 `INSERT` 直接指定 ID 匯入資料時 sequence 不會自動前進，同一支 migration 內 `setval` 到 `max(id) + 1`；漏掉時之後的新增會撞 `duplicate key violates unique constraint`。

## Good Example

- 這個例子是好的，因為匯入後立刻把 sequence 推到現有最大 ID 之後。

```sql
SELECT setval(
  'your_schema.table_name_id_seq',
  (SELECT COALESCE(MAX(id), 0) + 1 FROM your_schema.table_name),
  false
);
```

## Bad Example

- 這個例子是壞的，因為匯入指定 ID 後沒有同步 sequence。

```sql
INSERT INTO your_schema.table_name (id, name) VALUES (1, 'a'), (2, 'b');
```
