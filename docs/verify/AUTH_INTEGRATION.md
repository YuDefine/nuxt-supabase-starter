# 認證系統整合指引（@onmax/nuxt-better-auth）

此文件說明認證架構：Session 管理、OAuth 流程、權限檢查與錯誤處理。

---

## 1. 認證架構概覽

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client (Browser)                          │
├─────────────────────────────────────────────────────────────────┤
│  const { user, loggedIn, signIn, signOut } = useUserSession()    │
│  await signIn.social({ provider: 'google' })                     │
│  await signIn.email({ email, password })                         │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                         Server (Nitro)                           │
├─────────────────────────────────────────────────────────────────┤
│  const { user } = await requireUserSession(event)                │
│  const { user } = await requireUserSession(event, {              │
│    user: { role: 'admin' }                                       │
│  })                                                              │
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

| 位置                            | 功能                 |
| ------------------------------- | -------------------- |
| `server/routes/auth/[...]`      | OAuth 處理           |
| `server/utils/supabase.ts`      | Supabase 工具函式    |
| `app/middleware/auth.global.ts` | Client 端路由守衛    |

---

## 2. Client 端認證

### 2.1. 使用 useUserSession

```vue
<script setup lang="ts">
  const { user, loggedIn, signIn, signOut } = useUserSession()

  // 檢查登入狀態
  if (loggedIn.value) {
    console.log('使用者已登入:', user.value)
  }

  // OAuth 登入
  async function loginWithGoogle() {
    await signIn.social({ provider: 'google' })
  }

  // Email 登入
  async function loginWithEmail() {
    await signIn.email(
      { email: 'user@example.com', password: 'password' },
      { onSuccess: () => navigateTo('/') }
    )
  }

  // 登出
  async function logout() {
    await signOut()
    navigateTo('/login')
  }
</script>
```

### 2.2. 登入按鈕

```vue
<template>
  <UButton @click="loginWithGoogle"> 使用 Google 登入 </UButton>
</template>

<script setup lang="ts">
  const { signIn } = useUserSession()

  async function loginWithGoogle() {
    await signIn.social({ provider: 'google' })
  }
</script>
```

---

## 3. Server 端認證

### 3.1. 要求登入

```typescript
export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  // user 保證存在
  return { message: `Hello, ${user.name}` }
})
```

### 3.2. 要求特定角色

```typescript
export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event, {
    user: { role: ['admin', 'manager'] },
  })
  // 只有 admin 或 manager 可存取
})
```

### 3.3. 結合 Supabase

```typescript
import { getSupabaseWithContext } from '~~/server/utils/supabase'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)

  // 取得 Supabase Client
  const supabase = await getSupabaseWithContext(event)

  const { data } = await supabase.from('resources').select('*')

  return { data }
})
```

---

## 4. 路由保護

### 4.1. nuxt.config.ts 設定

```typescript
export default defineNuxtConfig({
  routeRules: {
    '/admin/**': { auth: { user: { role: 'admin' } } },
    '/login': { auth: 'guest' },
    '/dashboard/**': { auth: 'user' },
  },
})
```

### 4.2. Middleware 守衛

```typescript
// app/middleware/auth.global.ts
export default defineNuxtRouteMiddleware(async (to) => {
  const { loggedIn, user } = useUserSession()

  // 公開頁面不需驗證
  const publicPages = ['/login', '/forbidden']
  if (publicPages.includes(to.path)) return

  // 未登入導向登入頁
  if (!loggedIn.value) {
    return navigateTo('/login')
  }

  // 未授權角色導向 forbidden
  if (user.value?.role === 'unauthorized') {
    return navigateTo('/forbidden')
  }
})
```

---

## 5. Session 型別定義

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

| 情境             | 錯誤碼 | 建議處理                                 |
| ---------------- | ------ | ---------------------------------------- |
| 未登入           | 401    | 導向 `/login`                            |
| 無權限           | 403    | 顯示錯誤訊息或導向 `/forbidden`          |
| OAuth 取消       | -      | 提示「登入取消」，留在登入頁             |
| Session 過期     | 401    | 重新導向登入                             |

---

## 7. 常用 API

### Client 端

```typescript
const {
  user, // Ref<User | null>
  loggedIn, // ComputedRef<boolean>
  signIn, // { social, email, ... }
  signOut, // () => Promise<void>
  fetch, // () => Promise<void> - 重新取得 session
} = useUserSession()
```

### Server 端

```typescript
// 要求登入
const { user } = await requireUserSession(event)

// 要求特定角色
const { user } = await requireUserSession(event, {
  user: { role: 'admin' },
})

// 取得 session（可能為 null）
const session = await getUserSession(event)
```

---

## 8. 測試建議

- **單元測試**：模擬不同角色，確認 middleware 和 API 行為
- **整合測試**：覆蓋 OAuth → Session → API 存取流程
- **E2E**：覆蓋完整登入 → 首頁 → 登出流程

當登入/授權流程有任何變更，務必同步更新此文件。
