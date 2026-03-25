---
description: 認證相關程式碼（login, session, user, auth）
globs: ['app/**/*.{vue,ts}', 'server/**/*.ts']
---

# Auth

**USE** `useUserSession()` — **NEVER** use `useSupabaseUser()` or any Supabase Auth API.

See `nuxt-auth-utils` or `nuxt-better-auth` skill for OAuth flow and session types.
