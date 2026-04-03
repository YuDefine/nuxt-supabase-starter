# 認證系統整合指引（nuxt-auth-utils）

此文件說明本專案的認證架構：Cookie-based Session、OAuth 流程、權限檢查與錯誤處理。設定 Provider 的步驟請參考 [OAUTH_SETUP](./OAUTH_SETUP.md)。

---

## 1. 認證架構概覽

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client (Browser)                          │
├─────────────────────────────────────────────────────────────────┤
│  login.vue → /auth/google → OAuth Provider                       │
│                                                                  │
│  Cookie Session ← Server 驗證 + 建立 Session ← OAuth Callback   │
│                                                                  │
│  /api/auth/session → 取得使用者資訊                              │
│  /api/auth/logout  → 清除 Session                                │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                         Server (Nitro)                           │
├─────────────────────────────────────────────────────────────────┤
│  getUserSession(event) → 取得 Session                            │
│  setUserSession(event, data) → 設定 Session                      │
│  clearUserSession(event) → 清除 Session                          │
│                                                                  │
│  getSupabaseWithContext(event) → 設定 Application Context        │
│  requireAuth(event) → 驗證登入                                   │
│  requireRole(event, roles) → 驗證角色                            │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                      Supabase (Database)                         │
├─────────────────────────────────────────────────────────────────┤
│  app.user_roles → 使用者資料（非 auth.users）                    │
│  app.allowed_emails → Email 白名單                               │
│  app.set_app_context() → 設定 RLS Context                        │
└─────────────────────────────────────────────────────────────────┘
```

### 主要檔案

| 位置                               | 功能                 |
| ---------------------------------- | -------------------- |
| `server/routes/auth/google.get.ts` | Google OAuth 處理    |
| `server/api/auth/session.get.ts`   | 取得目前 Session     |
| `server/api/auth/logout.post.ts`   | 登出（清除 Session） |
| `server/utils/supabase.ts`         | Supabase 工具函式    |
| `server/types/auth.d.ts`           | Session 型別定義     |
| `app/middleware/auth.global.ts`    | Client 端路由守衛    |

> **擴充其他 OAuth Provider**：可仿照 Google 的模式新增其他 Provider（如 GitHub、LINE 等），使用對應的 `defineOAuth*EventHandler`。

---

## 2. OAuth 登入流程

### 2.1. Google 登入

```ts
// server/routes/auth/google.get.ts
export default defineOAuthGoogleEventHandler({
  async onSuccess(event, { user: googleUser }) {
    // 1. 驗證 Email 白名單
    const allowed = await isEmailAllowed(supabase, googleUser.email)
    if (!allowed) {
      return sendRedirect(event, '/forbidden?reason=not_whitelisted')
    }

    // 2. 確保使用者記錄存在
    const userRecord = await ensureUserRole(supabase, {
      email: googleUser.email,
      name: googleUser.name,
      provider: 'google',
      providerId: googleUser.sub,
    })

    // 3. 建立 Session
    await setUserSession(event, {
      user: {
        id: userRecord.id,
        email: userRecord.email,
        role: userRecord.role,
        // ...
      },
      loggedInAt: Date.now(),
    })

    return sendRedirect(event, '/')
  },
})
```

> **新增其他 Provider**：複製 Google 的模式，替換 `defineOAuth*EventHandler` 和 provider 欄位即可。流程（白名單 → ensureUserRole → setUserSession）保持一致。

---

## 3. Server API 認證

### 3.1. 基本認證檢查

```ts
// 要求使用者必須登入
export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  // user = { id, email, role, ... }
})
```

### 3.2. 角色檢查

```ts
// 要求特定角色
export default defineEventHandler(async (event) => {
  const user = await requireRole(event, ['admin', 'editor'])
  // 只有 admin 或 editor 可存取
})
```

### 3.3. 設定 Application Context

```ts
// 取得設定 RLS Context 的 Supabase Client
export default defineEventHandler(async (event) => {
  const client = await getSupabaseWithContext(event)
  // client 已呼叫 app.set_app_context(user_id, role)

  const { data } = await client.schema('app').from('user_roles').select('*')
  // RLS 會根據 app.user_id 和 app.user_role 過濾
})
```

---

## 4. Client 端整合

### 4.1. 取得 Session

```ts
// 使用 useFetch
const { data: session } = await useFetch('/api/auth/session')
// session = { authenticated: true, user: {...}, loggedInAt: 12345 }
```

### 4.2. 登入按鈕

```vue
<template>
  <UButton @click="loginWithGoogle"> 使用 Google 登入 </UButton>
</template>

<script setup lang="ts">
  function loginWithGoogle() {
    // 重導向至 OAuth 端點
    window.location.href = '/auth/google'
  }
</script>
```

### 4.3. 登出

```ts
async function logout() {
  await $fetch('/api/auth/logout', { method: 'POST' })
  // 重新載入頁面或導向登入頁
  window.location.href = '/login'
}
```

---

## 5. Middleware 與授權

```ts
// app/middleware/auth.global.ts
export default defineNuxtRouteMiddleware(async (to) => {
  // 公開頁面不需驗證
  const publicPages = ['/login', '/forbidden']
  if (publicPages.includes(to.path)) return

  // 檢查 Session
  const { data } = await useFetch('/api/auth/session')

  if (!data.value?.authenticated) {
    return navigateTo('/login')
  }

  if (data.value.user?.role === 'pending') {
    return navigateTo('/forbidden?reason=pending')
  }
})
```

---

## 6. Session 型別定義

```ts
// server/types/auth.d.ts
declare module '#auth-utils' {
  interface User {
    id: string // UUID
    email: string
    name?: string
    picture?: string
    role: 'admin' | 'editor' | 'viewer' | 'pending'
    displayName?: string
    department?: string
    provider: 'google' // 可擴充其他 provider
    providerId: string
  }

  interface UserSession {
    loggedInAt: number
  }
}
```

---

## 7. 錯誤處理

| 情境             | 錯誤碼 | 建議處理                                 |
| ---------------- | ------ | ---------------------------------------- |
| 未登入           | 401    | 導向 `/login`                            |
| 無權限           | 403    | 顯示錯誤訊息或導向 `/forbidden`          |
| OAuth 取消       | -      | 提示「登入取消」，留在登入頁             |
| Email 不在白名單 | -      | 導向 `/forbidden?reason=not_whitelisted` |
| Session 過期     | 401    | 重新導向登入                             |

---

## 8. 測試建議

- **單元測試**：模擬 `/api/auth/session` 回傳不同角色，確認 middleware 行為
- **整合測試**：覆蓋 OAuth → Session → API 存取流程
- **E2E**：覆蓋完整登入 → 首頁 → 登出流程

---

## 9. 與舊架構差異

| 項目                | 舊架構（Supabase Auth）   | 新架構（nuxt-auth-utils）      |
| ------------------- | ------------------------- | ------------------------------ |
| Session 儲存        | JWT Token                 | Cookie Session                 |
| 使用者表            | auth.users                | app.user_roles                 |
| RLS 識別            | auth.uid()                | current_setting('app.user_id') |
| Server 端取得使用者 | serverSupabaseUser(event) | getUserSession(event)          |
| Client 端取得使用者 | useSupabaseUser()         | useFetch('/api/auth/session')  |
| OAuth 處理          | Supabase Auth             | nuxt-auth-utils handlers       |

當登入/授權流程有任何變更，務必同步更新此文件。
