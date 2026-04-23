# Database

## Access Patterns

| Context | Read                                     | Write                 |
| ------- | ---------------------------------------- | --------------------- |
| Client  | `useSupabaseClient<Database>().select()` | Never                 |
| Server  | `getSupabaseWithContext(event)`          | `/api/v1/*` endpoints |
| Service | `server/utils/drizzle.ts`（選用）        | Transactional logic   |

**Client-side reads only.** Request-scoped reads/writes go through server API endpoints. `getServerSupabaseClient()` 與 Drizzle 只留給系統任務或需要 transaction/query builder 的服務層。

## Migrations

Always use the Supabase CLI:

```bash
supabase migration new <name>    # Create migration
supabase db reset                # Apply all migrations
supabase db lint --level warning # Check for issues
pnpm db:types                    # Regenerate TypeScript types
```

**Never** create `.sql` files manually or via the Write tool.

After creating a migration, always run: `db reset` → `db lint` → `db:types` → `typecheck`.

## Optional Drizzle Query Layer

Starter 現在直接安裝 `drizzle-orm`、`postgres`、`drizzle-kit`，但它是**選用 query layer**，不是 migration owner。

- `drizzle.config.ts`：Drizzle CLI 設定
- `server/utils/drizzle.ts`：`createAdminDrizzle()` / `withAdminDrizzle()` helper
- `server/db/schema/`：專案要用 Drizzle schema 時的預留位置

建議使用情境：

- 多表交易
- 複雜 join / CTE
- 需要 row lock 或交易邊界的服務層

不建議用 Drizzle 取代的事情：

- Supabase migrations
- RLS policy
- trigger / SQL function / extension 管理

### 直連環境變數

```bash
# local direct Postgres
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54322/postgres

# optional override for privileged Drizzle queries
ADMIN_DATABASE_URL=postgres://postgres:<password>@db.<project>.supabase.co:6543/postgres
```

### 常用指令

```bash
pnpm db:drizzle:pull
pnpm db:drizzle:studio
```

> `postgres-js` 預設要關閉 prepared statements；helper 已固定 `prepare: false`，避免 Supavisor transaction mode 衝突。

## Database Functions

All database functions must set the search path:

```sql
CREATE OR REPLACE FUNCTION public.my_function()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- function body
END;
$$;
```

## RLS Policies

Write policies must include a service_role bypass:

```sql
CREATE POLICY "example_insert"
  ON public.example
  FOR INSERT
  TO public
  WITH CHECK (
    (SELECT auth.role()) = 'service_role'
    OR auth.uid() = user_id
  );
```

## Type Safety

Generated types are at `app/types/database.types.ts`. Use them:

```typescript
import type { Database } from '~/types/database.types'

const client = useSupabaseClient<Database>()
const { data } = await client.from('profiles').select('*')
```

## Audit Logging

An audit_logs migration template is available at `scripts/templates/migrations/audit_logs.sql`. To use:

1. `supabase migration new audit_logs`
2. Copy the template content into the generated file
3. Run `supabase db reset`

Server utility:

```typescript
import { createAuditLog } from '~/server/utils/audit'

await createAuditLog({
  userId: user.id,
  action: 'create',
  entityType: 'profile',
  entityId: profile.id,
  changes: { name: 'new value' },
})
```
