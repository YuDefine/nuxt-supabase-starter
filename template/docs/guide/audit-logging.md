---
audience: both
applies-to: post-scaffold
---

# Audit Logging

The starter includes the audit log migration and a server-side insert utility. Scaffolded projects should confirm the migration is present before applying it.

## Setup

### 1. Check the migration

Use `supabase/migrations/20260804190000_create_audit_logs.sql`. If your scaffold omitted it, copy the audit migration template into a new migration. Do not add a duplicate table migration.

### 2. Apply to the local development database

```bash
supabase db reset
supabase db lint --level warning
pnpm db:types
pnpm typecheck
```

## Usage

The `createAuditLog()` function in `server/utils/audit.ts` is fire-and-forget — it logs errors but never interrupts the calling handler.

```typescript
// In any server API handler
import { createAuditLog } from '~~/server/utils/audit'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)

  // ... perform the operation ...

  // Fire-and-forget audit log
  await createAuditLog({
    userId: user.id,
    action: 'update',
    entityType: 'profile',
    entityId: profileId,
    changes: { display_name: newName },
    metadata: { ip: getRequestIP(event) },
  })

  return { success: true }
})
```

## Table Structure

| Column        | Type        | Description                                            |
| ------------- | ----------- | ------------------------------------------------------ |
| `id`          | bigserial   | Primary key                                            |
| `user_id`     | text        | Who performed the action (nullable for system actions)  |
| `action`      | text        | What happened (create, update, delete, etc.)             |
| `entity_type` | text        | What type of entity was affected                       |
| `entity_id`   | text        | Which entity was affected                              |
| `changes`     | jsonb       | What changed (optional)                                |
| `metadata`    | jsonb       | Additional context (optional)                          |
| `created_at`  | timestamptz | When it happened                                       |

## RLS Policies

RLS denies all direct client access. The server uses `service_role`; handlers must enforce authentication and authorization before reading or writing audit logs. Better Auth user IDs are text values and are not Supabase Auth identities.

## Template Location

`scripts/templates/migrations/audit_logs.sql`
