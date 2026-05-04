---
audience: devops
applies-to: self-host-supabase
---

# Self-Host Supabase Resilience

This project treats PostgREST schema reload, database locks, and app error handling as separate concerns.

## Required Production Shape

- Auth/core checks and business Data API traffic use separate PostgREST surfaces when the deployment exposes multiple schemas.
- Each surface has its own `PGRST_DB_SCHEMAS` and `PGRST_DB_CHANNEL`.
- Each surface has at least two instances for production rolling reload.
- The gateway routes only to instances whose admin `/ready` endpoint returns 200.
- Migration deploys save evidence: migration risk report, `/ready` gate output, smoke summary, and PostgREST logs.

## Migration Risk Classes

| Class                      | Examples                                                                                                     | Action                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| `online_safe`              | Add nullable column, create table, create function v2, create index concurrently, add constraint `NOT VALID` | May run online with ready gate and smoke      |
| `expand_contract_required` | Rename/drop column, change exposed RPC signature, drop function                                              | Split into expand, app rollout, then contract |
| `maintenance_required`     | Unavoidable `ACCESS EXCLUSIVE`, table rewrite, large blocking DML, non-concurrent hot-table index            | Stop and make rollback/maintenance decision   |

Run:

```bash
pnpm postgrest:risk supabase/migrations/<timestamp>_<name>.sql
```

## Ready Gate

Run one gate per surface or pass comma-separated endpoints:

```bash
pnpm postgrest:ready --url=https://core-admin.example.test/ready,https://app-admin.example.test/ready
```

Rolling sequence:

1. Reload app A.
2. Wait for app A `/ready = 200`.
3. Reload app B.
4. Wait for app B `/ready = 200`.
5. Run smoke against core and app Data API endpoints.

Never reload all instances of the same surface at once.

## Smoke

```bash
pnpm postgrest:smoke \
  --endpoint=core=https://example.test/rest/v1/user_roles?select=id \
  --endpoint=app=https://example.test/rest/v1/items?select=id \
  --seconds=60
```

The smoke summary must show 0 unexpected 5xx for online-safe and rolling reload changes. For `maintenance_required` operations, the smoke output is incident evidence, not proof that the operation is safe.

## App Behavior

- REST 503, `PGRST002`, and temporary network errors mean service temporarily unavailable.
- The app must not clear local session or force login because of those transient errors.
- UI copy should explain temporary unavailability in non-technical language and let the user retry.
