
# Rule 1 - Schema 落點依用途分層，helper schema 不暴露給 PostgREST

- Level: `MUST`
- 落點：

| schema | 放什麼 | PostgREST 暴露 |
| --- | --- | --- |
| `core`（或 `auth` 類 helper schema） | 授權相關（`user_roles`、`allowed_emails`、`user_preferences`、enum、`SECURITY DEFINER` 函式） | **NEVER** 暴露（不列入 exposed schemas）；只在 RLS／function／trigger 內呼叫，呼叫者 role 仍需 `USAGE` 與函式 `EXECUTE` |
| `app`／專案業務 schema | 業務資料表、給 client 呼叫的業務 RPC | 依 db-runtime 規約暴露 |
| `public` | 不存放業務資料；需要經 Data API 呼叫 private 實作時放 `SECURITY INVOKER` thin wrapper | 預設暴露 |

- 暴露與 GRANT 的完整做法以 db-runtime 規約（self-hosted 見 `rules/modules/db-runtime/supabase-self-hosted/database.md` § Custom Schema 暴露策略）與 `migration.md` § Schema 暴露策略為準，本 rule 不重寫。
- **NEVER** 設計成 client 以 `client.schema('core')` 查詢；`core` 不暴露，client 只會拿到錯誤。

## Good Example

- 這個例子是好的，因為授權 helper 留在不暴露的 `core`，client 只碰業務 schema。

```text
core.current_user_role()       ← RLS policy 內呼叫
app.orders                     ← client／Server API 查詢
public.get_order_summary()     ← SECURITY INVOKER wrapper，呼叫 core 的實作
```

## Bad Example

- 這個例子是壞的，因為它要求 client 直接查不暴露的 `core`。

```ts
const { data } = await client.schema('core').from('user_roles').select('*')
```

# Rule 2 - 架構建議 MUST 通過三項安全檢查

- Level: `MUST`
- RLS First：每一張新表都預設開啟 RLS（policy 內容交 `supabase-rls`）。
- Never Trust Client：前端送來的資料一律在 DB（constraint、RPC）或 Edge／Server 層驗證。
- Service Role 只在 Edge Function、Server API 或 RPC 內部使用；**NEVER** 把它帶到 client。
- 任一項不符，建議內要寫成待修設計點；**NEVER** 以「之後再補」帶過。

## Good Example

- 這個例子是好的，因為每項檢查都有結論，不符的項目寫成設計點。

```text
RLS First：orders、order_items 新表 ENABLE RLS → 符合
Never Trust Client：金額由 RPC 依 price 表重算，不採用 client 傳入值 → 符合
Service Role：Edge Function 內以 service client 呼叫 RPC → 符合
```

## Bad Example

- 這個例子是壞的，因為它跳過檢查，並讓 client 帶 service role。

```text
RLS 之後補；前端直接用 service role key 寫入 orders 比較快
```
