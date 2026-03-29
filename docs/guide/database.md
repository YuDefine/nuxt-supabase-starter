# Database

## Access Patterns

| Context | Read                                     | Write                 |
| ------- | ---------------------------------------- | --------------------- |
| Client  | `useSupabaseClient<Database>().select()` | Never                 |
| Server  | Service role client                      | `/api/v1/*` endpoints |

**Client-side reads only.** All writes go through server API endpoints using the service role client.

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
