
# Rule 1 - 角色判斷一律經 helper 函式

- Level: `SHOULD`
- policy 內需要目前使用者角色或 ID 時，呼叫 helper（例如 `your_schema.current_user_role()`、`your_schema.current_user_id()`），**NEVER** 在每條 policy 內直接查角色表：直接查表在 per-row 評估時效能差，且角色邏輯散在多處。
- helper 放在不暴露的 schema，`SECURITY DEFINER` 與 `search_path` 依 `migration.md`。
- 角色階層（自家預設）：`admin`（管理所有人、存取所有資料）→ `manager`（管理 staff／unauthorized、存取部門資料）→ `staff`（只管理自己、存取基本資料）→ `unauthorized`（已登入但未授權，無存取權）。

## Good Example

- 這個例子是好的，因為角色判斷集中在 helper。

```sql
CREATE POLICY "Staff can read" ON your_schema.your_table
FOR SELECT TO authenticated USING (
  your_schema.current_user_role() IN ('admin', 'manager', 'staff')
);
```

## Bad Example

- 這個例子是壞的，因為它在 policy 內直接查角色表。

```sql
CREATE POLICY "Staff can read" ON your_schema.your_table
FOR SELECT TO authenticated USING (
  (SELECT role FROM your_schema.user_roles WHERE id = auth.uid()) IN ('admin', 'manager', 'staff')
);
```

# Rule 2 - 新表 ENABLE RLS，GRANT 與 policy 同支 migration

- Level: `MUST`
- 每一張新表都 `ENABLE ROW LEVEL SECURITY`；`FORCE ROW LEVEL SECURITY` 依 `rls-policy.md` § RLS Hardening 的條件判斷（table owner 是可能執行業務查詢的 application role 時加）。
- 同一支 migration 內寫對應的 `GRANT`：RLS 在 table privilege 之後才評估，缺 GRANT 時 policy 完全不被評估（細節見 `rls-policy.md` § GRANT 先於 RLS）。
- INSERT、UPDATE、DELETE 每個要開放的 operation 都要有自己的 policy；沒有 policy 的 operation 等於拒絕。

## Good Example

- 這個例子是好的，因為 ENABLE、GRANT 與 policy 在同一支 migration。

```sql
ALTER TABLE your_schema.departments ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON your_schema.departments TO authenticated;
CREATE POLICY "Staff can read" ON your_schema.departments
FOR SELECT TO authenticated USING (your_schema.current_user_role() IN ('admin', 'manager', 'staff'));
```

## Bad Example

- 這個例子是壞的，因為它只寫 policy、沒有 GRANT，authenticated 會得到 `42501`。

```sql
ALTER TABLE your_schema.departments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can read" ON your_schema.departments
FOR SELECT TO authenticated USING (true);
```

# Rule 3 - `TO public` 陷阱：client 直讀的表與 server-only 的表分開判斷

- Level: `MUST`
- 省略 `TO` 時 policy 預設套用 `PUBLIC`（含 `anon`）；這不是自家預設，要明寫 `TO`。
- client 直讀（`useSupabaseClient()`）的表，SELECT policy 用 `TO public`；`public` 含未登入的 `anon`，所以 `USING` **MUST** 自帶可見範圍條件，**NEVER** 寫 `TO public USING (true)` 給非公開資料。
- 只由 server 讀的表用 `TO authenticated`。client 以 `anon` 讀 `TO authenticated` 的表會**靜默回傳 0 筆**、不報錯（`modules.auth` 為 `better-auth`／`nuxt-auth-utils` 時 client 恆為 `anon`，見 db-runtime 規約 § 存取模式）。
- 查詢回傳空陣列時，先查 SELECT policy 的 `TO` 對象與對應 `GRANT`，再查資料本身。

## Good Example

- 這個例子是好的，因為公開讀取的表明寫 `TO public` 並限縮到已發佈的列。

```sql
CREATE POLICY "Anyone can read published posts" ON your_schema.posts
FOR SELECT TO public USING (published_at IS NOT NULL);
```

## Bad Example

- 這個例子是壞的，因為 client 直讀的表只開 `TO authenticated`，未登入或 `anon` 的 client 會靜默拿到 0 筆。

```sql
CREATE POLICY "Read posts" ON your_schema.posts
FOR SELECT TO authenticated USING (published_at IS NOT NULL);
```

# Rule 4 - service_role NEVER 寫進 policy

- Level: `MUST`
- **NEVER** 在 policy 內加 `(SELECT auth.role()) = 'service_role'` 當 bypass 條件：`service_role` 具備 `BYPASSRLS`，這個條件沒有保護作用，只會讓人誤以為 privileged write path 由 policy 控制（`auth.role()` 也已 deprecated，目標 role 用 `TO` 子句）。
- privileged 寫入被 RLS 擋時，原因多半是誤用 request-scoped user client；用專屬 factory 建 service_role client。privileged 寫入的邊界靠 server-side isolation，見 `rls-policy.md` § service_role 與 privileged client isolation。

## Good Example

- 這個例子是好的，因為目標 role 由 `TO` 指定，條件只表達業務授權。

```sql
CREATE POLICY "Manager can update" ON your_schema.your_table
FOR UPDATE TO authenticated USING (your_schema.current_user_role() IN ('admin', 'manager'));
```

## Bad Example

- 這個例子是壞的，因為 service_role 條件沒有作用，還誤導後續維護者。

```sql
CREATE POLICY "Manager or service can update" ON your_schema.your_table
FOR UPDATE USING (
  (SELECT auth.role()) = 'service_role'
  OR your_schema.current_user_role() IN ('admin', 'manager')
);
```
