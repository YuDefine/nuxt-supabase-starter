---
description: RLS Policy 撰寫規範
globs: ['supabase/migrations/**/*.sql']
---

# RLS Policy

- Write policies **MUST** include `(SELECT auth.role()) = 'service_role'` bypass
- SELECT: `TO public` for client reads, `TO authenticated` for server-only
- See `supabase-rls` skill for policy templates and `TO public` 陷阱
