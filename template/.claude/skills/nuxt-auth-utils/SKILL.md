---
name: nuxt-auth-utils
description: Use when implementing auth in Nuxt apps with nuxt-auth-utils - provides useUserSession composable, OAuth handlers, cookie-based sessions, and route protection. Works on all deployment targets without DB dependency.
---

# Nuxt Auth Utils

Cookie-based authentication module for Nuxt. No database required for session storage — sessions are encrypted and stored in cookies.

## When to Use

- Installing/configuring `nuxt-auth-utils`
- Implementing OAuth login flows (Google, GitHub, etc.)
- Protecting routes (client and server)
- Accessing user session in API routes
- Setting up session types

**For Nuxt patterns:** use `nuxt` skill
**For better-auth (DB-based auth):** use `nuxt-better-auth` skill

## Available Guidance

| File                                                       | Topics                                                             |
| ---------------------------------------------------------- | ------------------------------------------------------------------ |
| **[references/client-auth.md](references/client-auth.md)** | useUserSession, OAuth login, logout, session state                 |
| **[references/server-auth.md](references/server-auth.md)** | requireUserSession, getUserSession, setUserSession, OAuth handlers |

## Loading Files

- [ ] [references/client-auth.md](references/client-auth.md) - if building login/logout flows
- [ ] [references/server-auth.md](references/server-auth.md) - if protecting API routes or setting up OAuth handlers

**DO NOT load all files at once.** Load only what's relevant to your current task.

## Key Concepts

| Concept                    | Description                                               |
| -------------------------- | --------------------------------------------------------- |
| `useUserSession()`         | Client composable — user, loggedIn, session, fetch, clear |
| `requireUserSession()`     | Server helper — throws 401 if not authenticated           |
| `setUserSession()`         | Server helper — set session after OAuth success           |
| `clearUserSession()`       | Server helper — clear session (logout)                    |
| `defineOAuth*EventHandler` | Server OAuth callback handlers                            |
| `auth.d.ts`                | Type augmentation via `declare module '#auth-utils'`      |

## Quick Reference

```ts
// Client: useUserSession()
const { user, loggedIn, clear } = useUserSession()
```

```ts
// Server: OAuth handler
export default defineOAuthGoogleEventHandler({
  async onSuccess(event, { user: googleUser }) {
    await setUserSession(event, {
      user: { id: googleUser.sub, email: googleUser.email, name: googleUser.name },
    })
    return sendRedirect(event, '/')
  },
})
```

```ts
// Server: protect API route
const { user } = await requireUserSession(event)
```

## vs better-auth

|              | nuxt-auth-utils | better-auth                                     |
| ------------ | --------------- | ----------------------------------------------- |
| Session 儲存 | Cookie（無 DB） | Database                                        |
| 登入方式     | OAuth only      | Email/Password + OAuth                          |
| 登出         | `clear()`       | `signOut()`                                     |
| 角色檢查     | 手動            | `requireUserSession(event, { user: { role } })` |
| 部署         | 所有環境        | Workers 需 Hyperdrive                           |

## Resources

- [nuxt-auth-utils Docs](https://github.com/atinux/nuxt-auth-utils)

---

_Token efficiency: Main skill ~300 tokens, each sub-file ~600-800 tokens_
