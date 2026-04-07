---
description: RLS Policy 撰寫規範
globs: ['supabase/migrations/**/*.sql']
---

# RLS Policy

- Write policies **MUST** include `(SELECT auth.role()) = 'service_role'` bypass
- SELECT: `TO public` for client reads, `TO authenticated` for server-only
- **UPDATE policy 需要搭配 SELECT policy** — Postgres RLS 的 UPDATE 必須先 SELECT row，缺少 SELECT policy 會靜默回傳 0 rows（無報錯）
- **Storage upsert 需要 INSERT + SELECT + UPDATE 三個 policy** — 只有 INSERT 時新上傳正常，但覆蓋（upsert）會靜默失敗
- **NEVER** use `user_metadata`（`raw_user_meta_data`）in RLS policies — 使用者可自行修改，改用 `app_metadata`
- See `supabase-rls` skill for policy templates and `TO public` 陷阱
