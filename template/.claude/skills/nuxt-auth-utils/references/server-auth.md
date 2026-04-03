---
description: Server-side auth with nuxt-auth-utils — requireUserSession, setUserSession, OAuth handlers
---

# Server-Side Auth

## requireUserSession

取得並驗證 session。未認證時 throws 401。

```ts
export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  // user 保證存在
  return { message: `Hello, ${user.name}` }
})
```

**角色檢查（手動）：**

nuxt-auth-utils 沒有內建角色檢查，需手動實作：

```ts
export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  if (user.role !== 'admin') {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }
  // admin only
})
```

## getUserSession

取得 session，未認證時回傳 `null`（不 throw）。

```ts
const session = await getUserSession(event)
if (session?.user) {
  // 已認證
}
```

## setUserSession

OAuth 成功後設定 session。

```ts
await setUserSession(event, {
  user: {
    id: googleUser.sub,
    email: googleUser.email,
    name: googleUser.name,
    picture: googleUser.picture,
    provider: 'google',
  },
  loggedInAt: Date.now(),
})
```

## clearUserSession

清除 session（server 端登出）。

```ts
await clearUserSession(event)
```

## OAuth Handler

nuxt-auth-utils 提供內建 OAuth handler。放在 `server/routes/auth/` 下：

**Google OAuth：**

```ts
// server/routes/auth/google.get.ts
export default defineOAuthGoogleEventHandler({
  async onSuccess(event, { user: googleUser }) {
    await setUserSession(event, {
      user: {
        id: googleUser.sub as string,
        email: googleUser.email as string,
        name: googleUser.name as string,
        picture: googleUser.picture as string | undefined,
        provider: 'google',
      },
      loggedInAt: Date.now(),
    })

    // 從 cookie 讀取 redirect 目標（client 端登入前設定）
    const rawRedirect = getCookie(event, 'auth-redirect') || '/'
    deleteCookie(event, 'auth-redirect')
    const redirectPath =
      rawRedirect.startsWith('/') && !rawRedirect.startsWith('//') ? rawRedirect : '/'
    return sendRedirect(event, redirectPath)
  },

  onError(event, error) {
    console.error('Google OAuth error:', error)
    return sendRedirect(event, '/auth/login?error=google_auth_failed')
  },
})
```

**GitHub OAuth：**

```ts
// server/routes/auth/github.get.ts
export default defineOAuthGitHubEventHandler({
  async onSuccess(event, { user: githubUser }) {
    await setUserSession(event, {
      user: {
        id: String(githubUser.id),
        email: githubUser.email as string,
        name: githubUser.name as string,
        picture: githubUser.avatar_url as string,
        provider: 'github',
      },
      loggedInAt: Date.now(),
    })
    return sendRedirect(event, '/')
  },
})
```

## nuxt.config.ts

```ts
export default defineNuxtConfig({
  runtimeConfig: {
    oauth: {
      google: {
        clientId: process.env.NUXT_OAUTH_GOOGLE_CLIENT_ID,
        clientSecret: process.env.NUXT_OAUTH_GOOGLE_CLIENT_SECRET,
      },
    },
    session: {
      maxAge: 60 * 60 * 24 * 7, // 7 days
      password: process.env.NUXT_SESSION_PASSWORD || '',
    },
  },
})
```

## 環境變數

```bash
NUXT_SESSION_PASSWORD=   # 至少 32 字元（openssl rand -base64 32）
NUXT_OAUTH_GOOGLE_CLIENT_ID=
NUXT_OAUTH_GOOGLE_CLIENT_SECRET=
```
