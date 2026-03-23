# 認證系統整合指引

此專案支援兩種認證方案，建立專案時二擇一。兩者皆透過 `useUserSession()` 提供統一的 client 端體驗。

---

## 方案比較

|                       | nuxt-auth-utils                 | @onmax/nuxt-better-auth                         |
| --------------------- | ------------------------------- | ----------------------------------------------- |
| **Session 儲存**      | Cookie（無 DB）                 | Database                                        |
| **登入方式**          | OAuth only                      | Email/Password + OAuth                          |
| **部署相容性**        | 所有環境（Workers/Vercel/Node） | Workers + 自架 DB 需 Hyperdrive                 |
| **額外頁面**          | login                           | login, register, forgot-password, callback      |
| **Type 擴充**         | `declare module '#auth-utils'`  | `declare module '@onmax/nuxt-better-auth'`      |
| **Server 端 session** | `requireUserSession(event)`     | `requireUserSession(event, { user: { role } })` |
| **角色檢查**          | 手動實作                        | 內建 `requireUserSession` 支援                  |

---

## 1. 認證架構概覽

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client (Browser)                          │
├─────────────────────────────────────────────────────────────────┤
│  const { user, loggedIn } = useUserSession()                     │
│  // 兩種方案皆使用 useUserSession()                               │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                         Server (Nitro)                           │
├─────────────────────────────────────────────────────────────────┤
│  const { user } = await requireUserSession(event)                │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                      Supabase (Database)                         │
├─────────────────────────────────────────────────────────────────┤
│  使用 Service Role Client 執行資料庫操作                          │
│  RLS 保護讀取操作                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 主要檔案

| 位置                            | 功能              |
| ------------------------------- | ----------------- |
| `app/middleware/auth.global.ts` | Client 端路由守衛 |
| `server/utils/supabase.ts`      | Supabase 工具函式 |

**nuxt-auth-utils 額外檔案：**

| 位置                               | 功能                   |
| ---------------------------------- | ---------------------- |
| `server/routes/auth/google.get.ts` | Google OAuth handler   |
| `auth.d.ts`                        | `#auth-utils` 型別擴充 |

**better-auth 額外檔案：**

| 位置                             | 功能                                   |
| -------------------------------- | -------------------------------------- |
| `app/auth.config.ts`             | Client auth 設定                       |
| `server/auth.config.ts`          | Server auth 設定（providers、session） |
| `app/composables/useUserRole.ts` | 角色檢查 composable                    |

---

## 2. Client 端認證

### 2.1. useUserSession（共用）

兩種方案都使用 `useUserSession()`，但回傳的方法不同：

```vue
<script setup lang="ts">
  const { user, loggedIn } = useUserSession()

  if (loggedIn.value) {
    console.log('使用者已登入:', user.value)
  }
</script>
```

### 2.2. 登入流程

**nuxt-auth-utils — OAuth 導向：**

```vue
<script setup lang="ts">
  function handleGoogleSignIn() {
    const cookie = useCookie('auth-redirect', { path: '/', maxAge: 300 })
    cookie.value = '/'
    navigateTo('/auth/google', { external: true })
  }
</script>
```

**better-auth — Email/Password + OAuth：**

```vue
<script setup lang="ts">
  const { signIn } = useUserSession()

  // Email 登入
  async function loginWithEmail() {
    await signIn.email(
      { email: 'user@example.com', password: 'password' },
      { onSuccess: () => navigateTo('/') }
    )
  }

  // OAuth 登入
  async function loginWithGoogle() {
    await signIn.social({ provider: 'google' })
  }
</script>
```

### 2.3. 登出

**nuxt-auth-utils：**

```ts
const { clear } = useUserSession()
await clear()
navigateTo('/auth/login')
```

**better-auth：**

```ts
const { signOut } = useUserSession()
await signOut()
navigateTo('/auth/login')
```

---

## 3. Server 端認證

### 3.1. 要求登入（共用）

```typescript
export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  return { message: `Hello, ${user.name}` }
})
```

### 3.2. 角色檢查

**nuxt-auth-utils — 手動檢查：**

```typescript
export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  if (user.role !== 'admin') {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }
})
```

**better-auth — 內建支援：**

```typescript
export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event, {
    user: { role: ['admin', 'manager'] },
  })
  // 只有 admin 或 manager 可存取
})
```

### 3.3. 結合 Supabase（共用）

```typescript
import { getSupabaseWithContext } from '~~/server/utils/supabase'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const supabase = await getSupabaseWithContext(event)
  const { data } = await supabase.from('resources').select('*')
  return { data }
})
```

---

## 4. 路由保護

### 4.1. Middleware（共用）

```typescript
// app/middleware/auth.global.ts
export default defineNuxtRouteMiddleware((to) => {
  const { loggedIn } = useUserSession()
  if (to.meta.auth === false) return
  if (!loggedIn.value) {
    return navigateTo('/auth/login')
  }
})
```

### 4.2. nuxt.config.ts（better-auth only）

```typescript
export default defineNuxtConfig({
  routeRules: {
    '/admin/**': { auth: { user: { role: 'admin' } } },
    '/login': { auth: 'guest' },
    '/dashboard/**': { auth: 'user' },
  },
})
```

---

## 5. Session 型別定義

**nuxt-auth-utils：**

```typescript
// auth.d.ts
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

**better-auth：**

```typescript
// server/types/auth.d.ts
declare module '@onmax/nuxt-better-auth' {
  interface User {
    id: string
    email: string
    name?: string
    picture?: string
    role: 'admin' | 'manager' | 'staff' | 'unauthorized'
  }
}
```

---

## 6. 錯誤處理

| 情境         | 錯誤碼 | 建議處理                        |
| ------------ | ------ | ------------------------------- |
| 未登入       | 401    | 導向 `/auth/login`              |
| 無權限       | 403    | 顯示錯誤訊息或導向 `/forbidden` |
| OAuth 取消   | -      | 提示「登入取消」，留在登入頁    |
| Session 過期 | 401    | 重新導向登入                    |

---

## 7. 常用 API

### Client 端

**nuxt-auth-utils：**

```typescript
const {
  user, // Ref<User | null>
  loggedIn, // ComputedRef<boolean>
  session, // Ref<UserSession>
  fetch, // () => Promise<void> - 重新取得 session
  clear, // () => Promise<void> - 清除 session（登出）
} = useUserSession()
```

**better-auth：**

```typescript
const {
  user, // Ref<User | null>
  loggedIn, // ComputedRef<boolean>
  signIn, // { social, email, ... }
  signOut, // () => Promise<void>
  fetch, // () => Promise<void> - 重新取得 session
} = useUserSession()
```

### Server 端（共用）

```typescript
// 要求登入
const { user } = await requireUserSession(event)

// 取得 session（可能為 null）
const session = await getUserSession(event)
```

---

## 8. 測試建議

- **單元測試**：模擬不同角色，確認 middleware 和 API 行為
- **整合測試**：覆蓋 OAuth → Session → API 存取流程
- **E2E**：覆蓋完整登入 → 首頁 → 登出流程

當登入/授權流程有任何變更，務必同步更新此文件。
