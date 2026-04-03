# Authentication

This project supports two auth providers. You choose one during `pnpm setup`.

## Better Auth

Email/password authentication with optional OAuth providers.

**Key files:**

- `server/auth.config.ts` — Server configuration
- `app/auth.config.ts` — Client configuration
- `app/middleware/auth.global.ts` — Route protection

**Client usage:**

```vue
<script setup>
  const { signIn, signUp, loggedIn, user } = useUserSession()
</script>
```

**Server usage:**

```typescript
// server/api/v1/example.get.ts
export default defineEventHandler((event) => {
  const user = requireAuth(event)
  // user.id, user.email, user.role
})
```

## nuxt-auth-utils

OAuth-first authentication with cookie-based sessions.

**Key files:**

- `app/middleware/auth.global.ts` — Route protection
- `server/utils/api-response.ts` — `requireAuth()` helper

**Client usage:**

```vue
<script setup>
  const { loggedIn, user } = useUserSession()
</script>
```

**Server usage:**

```typescript
// server/api/v1/example.get.ts
export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  // user.id, user.email, user.role
})
```

Note: `requireAuth()` is **async** with nuxt-auth-utils (uses `getUserSession()`).

## Public Pages

Mark pages as public with `definePageMeta`:

```vue
<script setup>
  definePageMeta({ auth: false })
</script>
```

## Role-based Access

```typescript
// Server-side
requireRole(event, ['admin'])

// Client-side (composable)
const { isAdmin, hasRole } = useUserRole()
```

## OAuth Providers

Configure OAuth in `.env`:

```env
NUXT_OAUTH_GOOGLE_CLIENT_ID=...
NUXT_OAUTH_GOOGLE_CLIENT_SECRET=...
```

Available providers: Google, GitHub, LINE.
