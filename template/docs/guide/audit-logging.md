---
audience: both
applies-to: post-scaffold
---

# Audit Logging

This project provides an audit logging foundation as a template — not auto-applied, so you add it when your project needs it.

## Setup

### 1. Create the migration

```bash
supabase migration new audit_logs
```

### 2. Copy the template

Copy the content from `scripts/templates/migrations/audit_logs.sql` into the generated migration file.

### 3. Apply

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
import { createAuditLog } from '~/server/utils/audit'

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
| `id`          | uuid        | Primary key                                            |
| `user_id`     | uuid        | Who performed the action (nullable for system actions) |
| `action`      | text        | What happened (create, update, delete, etc.)           |
| `entity_type` | text        | What type of entity was affected                       |
| `entity_id`   | text        | Which entity was affected                              |
| `changes`     | jsonb       | What changed (optional)                                |
| `metadata`    | jsonb       | Additional context (optional)                          |
| `created_at`  | timestamptz | When it happened                                       |

## RLS Policies

- **INSERT**: `service_role` only (server writes)
- **SELECT**: `service_role` or own logs (`user_id = auth.uid()`)

## Template Location

`scripts/templates/migrations/audit_logs.sql`
