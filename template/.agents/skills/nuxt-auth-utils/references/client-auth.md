---
description: Client-side auth with nuxt-auth-utils — useUserSession, OAuth login, logout
---

# Client-Side Auth

## useUserSession

```ts
const {
  user, // Ref<User | null>
  loggedIn, // ComputedRef<boolean>
  session, // Ref<UserSession>
  fetch, // () => Promise<void> — refetch session
  clear, // () => Promise<void> — clear session (logout)
} = useUserSession()
```

## OAuth Login

nuxt-auth-utils 透過 server route handler 處理 OAuth。Client 端直接導向 OAuth route：

```ts
function handleGoogleSignIn() {
  // 保存 redirect 目標到 cookie（OAuth 回來後用）
  const cookie = useCookie('auth-redirect', { path: '/', maxAge: 300 })
  cookie.value = redirectTo.value
  navigateTo('/auth/google', { external: true })
}
```

**重點：** 用 `external: true` 是因為 OAuth route 是 server route，不是 Nuxt page。

## Logout

```ts
const { clear } = useUserSession()

async function logout() {
  await clear()
  navigateTo('/auth/login')
}
```

## Middleware

```ts
// app/middleware/auth.global.ts
export default defineNuxtRouteMiddleware((to) => {
  const { loggedIn } = useUserSession()

  // auth: false 標記的頁面是公開的
  if (to.meta.auth === false) return

  if (!loggedIn.value) {
    return navigateTo({
      path: '/auth/login',
      query: { redirect: to.fullPath },
    })
  }
})
```

## Type Augmentation

```ts
// auth.d.ts（專案根目錄）
declare module '#auth-utils' {
  interface User {
    id: string
    email: string
    name: string
    picture?: string
    provider: string
  }

  interface UserSession {
    loggedInAt: number
  }
}

export {}
```
