# 中間件開發指南

本文檔說明 Nuxt 4 / Nitro 的中間件開發模式，包含 Server Middleware 和 Client Middleware。

---

## 1. 中間件類型

### Server Middleware（Nitro）

位於 `server/middleware/`，在每個 API 請求前執行：

```
server/middleware/
├── rate-limiter.ts      # 速率限制
└── user-validation.ts   # 使用者驗證
```

### Client Middleware（Nuxt）

位於 `app/middleware/`，在路由導航時執行：

```
app/middleware/
└── auth.global.ts       # 認證檢查（全域）
```

---

## 2. Server Middleware 基礎

### 基本結構

```typescript
// server/middleware/example.ts
import { defineEventHandler } from 'h3'

export default defineEventHandler(async (event) => {
  // 檢查是否需要處理
  if (!shouldHandle(event)) {
    return // 不返回值，繼續執行後續中間件/handler
  }

  // 執行中間件邏輯
  // ...

  // 如果需要終止請求，拋出錯誤
  throw createError({
    statusCode: 403,
    message: '拒絕存取',
  })
})
```

### 執行順序

Nitro 按**檔案名稱字母順序**執行中間件：

```
server/middleware/
├── 01.rate-limiter.ts   # 第一個執行
├── 02.user-validation.ts # 第二個執行
└── 03.logging.ts        # 第三個執行
```

建議使用數字前綴控制順序。

---

## 3. 速率限制中間件

### 完整實作

```typescript
// server/middleware/rate-limiter.ts
import { defineEventHandler, getRequestIP, createError } from 'h3'

// 使用 unstorage（Nitro 內建儲存層）
const storage = useStorage('rate-limit')

// 組態設定
const config = {
  targetPath: '/api/auth/log', // 目標路徑
  windowMs: 60 * 1000, // 時間視窗（1 分鐘）
  maxRequests: 20, // 最大請求次數
  message: '請求過於頻繁，請稍後再試。',
}

export default defineEventHandler(async (event) => {
  // 只對目標路徑生效
  if (event.path !== config.targetPath) {
    return
  }

  // 取得請求 IP
  const ip = getRequestIP(event, { xForwardedFor: true })
  if (!ip) {
    return // 無法取得 IP 時放行
  }

  const storageKey = `ip:${ip}`
  const record = await storage.getItem<{ count: number; startTime: number }>(storageKey)

  const now = Date.now()
  const windowStart = now - config.windowMs

  // 沒有記錄或記錄已過期
  if (!record || record.startTime < windowStart) {
    await storage.setItem(storageKey, { count: 1, startTime: now })
    return
  }

  // 檢查請求次數
  if (record.count >= config.maxRequests) {
    throw createError({
      statusCode: 429,
      statusMessage: 'Too Many Requests',
      message: config.message,
    })
  }

  // 請求次數 +1
  await storage.setItem(storageKey, { ...record, count: record.count + 1 })
})
```

### IP 取得注意事項

```typescript
// 考慮反向代理
const ip = getRequestIP(event, { xForwardedFor: true })

// Cloudflare 環境
const cfIp = getHeader(event, 'cf-connecting-ip')
const ip = cfIp || getRequestIP(event, { xForwardedFor: true })
```

---

## 4. 使用者驗證中間件

### 處理 Session 與資料庫不一致

```typescript
// server/middleware/user-validation.ts
import { getServerSupabaseClient } from '~~/server/utils/supabase'

// 需要驗證用戶存在性的 API 路徑前綴
const PROTECTED_API_PATHS = ['/api/user/', '/api/admin/']

export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname

  // 只檢查需要保護的 API 路徑
  const isProtectedPath = PROTECTED_API_PATHS.some((prefix) => path.startsWith(prefix))
  if (!isProtectedPath) {
    return
  }

  // 取得 Session
  const session = await getUserSession(event)

  if (!session.user) {
    // 沒有 Session，讓後續的 requireAuth 處理
    return
  }

  const userId = (session.user as { id: string }).id
  const userEmail = (session.user as { email: string }).email

  // 檢查用戶是否存在於 user_roles 表中
  const supabase = getServerSupabaseClient()

  const { data: userRecord, error } = await supabase
    .from('user_roles')
    .select('id')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    // 資料庫錯誤，讓請求繼續，由後續邏輯處理
    return
  }

  if (!userRecord) {
    // 用戶在 Session 中存在但不在資料庫中
    // 這通常是 supabase db reset 後發生的情況

    // 清除 Session
    await clearUserSession(event)

    throw createError({
      statusCode: 401,
      statusMessage: 'Session expired',
      message: '登入狀態已失效，請重新登入',
    })
  }
})
```

---

## 5. Client Middleware（路由中間件）

### 全域認證中間件

```typescript
// app/middleware/auth.global.ts
export default defineNuxtRouteMiddleware(async (to) => {
  // 公開頁面
  const publicPages = ['/login', '/auth/callback']
  if (publicPages.includes(to.path)) {
    return
  }

  // 檢查 Session
  const { user, loggedIn } = useUserSession()

  if (!loggedIn.value) {
    return navigateTo('/login')
  }

  // 檢查權限
  if (to.meta.requireAdmin && user.value?.role !== 'admin') {
    return navigateTo('/')
  }
})
```

### 頁面專屬中間件

```typescript
// app/middleware/admin.ts
export default defineNuxtRouteMiddleware(async (to) => {
  const { user } = useUserSession()

  if (user.value?.role !== 'admin') {
    return navigateTo('/')
  }
})
```

在頁面中使用：

```vue
<script setup lang="ts">
  definePageMeta({
    middleware: ['admin'],
  })
</script>
```

---

## 6. 中間件設計模式

### 路徑匹配模式

```typescript
// 精確匹配
if (event.path === '/api/specific') { ... }

// 前綴匹配
if (event.path.startsWith('/api/admin/')) { ... }

// 多路徑匹配
const targetPaths = ['/api/user/', '/api/admin/']
const matches = targetPaths.some((prefix) => event.path.startsWith(prefix))

// 正則匹配
if (/^\/api\/v\d+\//.test(event.path)) { ... }
```

### 條件跳過模式

```typescript
export default defineEventHandler(async (event) => {
  // 排除特定路徑
  const excludePaths = ['/api/health', '/api/public']
  if (excludePaths.some((path) => event.path.startsWith(path))) {
    return // 跳過此中間件
  }

  // 執行中間件邏輯
  // ...
})
```

### 附加資料模式

```typescript
// 在中間件中附加資料
export default defineEventHandler(async (event) => {
  const user = await validateUser(event)
  event.context.user = user // 附加到 context
})

// 在 handler 中取得
export default defineEventHandler(async (event) => {
  const user = event.context.user // 從 context 取得
  // ...
})
```

---

## 7. 錯誤處理

### 標準錯誤格式

```typescript
throw createError({
  statusCode: 401, // HTTP 狀態碼
  statusMessage: 'Unauthorized', // 狀態訊息
  message: '請先登入', // 使用者訊息
})
```

### 常用錯誤狀態碼

| 狀態碼 | 使用情境                   |
| ------ | -------------------------- |
| 400    | 請求格式錯誤               |
| 401    | 未認證（需要登入）         |
| 403    | 無權限（已登入但權限不足） |
| 404    | 資源不存在                 |
| 429    | 請求過於頻繁               |
| 500    | 伺服器錯誤                 |

---

## 8. 日誌記錄

### 使用結構化 Logger

所有 server 端日誌建議使用 request-scoped 結構化 logging。

#### API Route 標準用法

API route handler 在第一行初始化 logger，並在認證後設定上下文：

```typescript
export default defineEventHandler(async (event) => {
  const log = useLogger(event)

  // 認證之後設定上下文
  const user = await requireRole(event, ['admin', 'editor'])
  log.set({ user: { id: user.id }, operation: 'create', table: 'items' })

  // 錯誤記錄（只記錄非預期錯誤，404/422 等預期錯誤不需記錄）
  log.error(error as Error, { step: 'db-query' })

  // 成功時記錄結果
  log.set({ result: { id: newRecord.id } })
})
```

#### Middleware 中的用法

Middleware 不需要在第一行初始化 logger。只在需要記錄時才建立，避免對不匹配路徑的請求產生不必要的開銷：

```typescript
export default defineEventHandler(async (event) => {
  // 路徑不匹配時直接 return，不需 logger
  if (!shouldHandle(event)) return

  // 只在需要記錄時才建立
  if (error) {
    const log = useLogger(event)
    log.error(error as Error, { step: 'validate-user' })
  }
})
```

### 敏感資訊保護

使用明確的欄位選擇，避免記錄完整請求體：

```typescript
// ✅ 明確選擇欄位
log.set({ user: { id: body.id, email: body.email } })

// ❌ 禁止記錄完整物件
// log.set({ user: body })
```

---

## 9. 使用 Storage

### unstorage 基礎

```typescript
// 取得 storage 實例
const storage = useStorage('my-namespace')

// 設定值
await storage.setItem('key', { data: 'value' })

// 取得值
const value = await storage.getItem<MyType>('key')

// 刪除值
await storage.removeItem('key')

// 檢查是否存在
const exists = await storage.hasItem('key')
```

### 快取 TTL 模擬

```typescript
interface CacheItem<T> {
  data: T
  expiresAt: number
}

async function getWithExpiry<T>(key: string): Promise<T | null> {
  const item = await storage.getItem<CacheItem<T>>(key)
  if (!item) return null
  if (Date.now() > item.expiresAt) {
    await storage.removeItem(key)
    return null
  }
  return item.data
}

async function setWithExpiry<T>(key: string, data: T, ttlMs: number): Promise<void> {
  await storage.setItem(key, {
    data,
    expiresAt: Date.now() + ttlMs,
  })
}
```

---

## 10. 完整範例：請求日誌中間件

```typescript
// server/middleware/01.request-logger.ts
import { defineEventHandler, getRequestIP, getHeaders } from 'h3'

export default defineEventHandler(async (event) => {
  // 只記錄 API 請求
  if (!event.path.startsWith('/api/')) {
    return
  }

  const log = useLogger(event)

  // 累積請求資訊到 wide event
  log.set({
    request: {
      method: event.method,
      path: event.path,
      ip: getRequestIP(event, { xForwardedFor: true }),
      userAgent: getHeaders(event)['user-agent'],
    },
  })

  // logger 會自動在 response 結束時 emit wide event（含 duration）
})
```

---

## 11. 測試中間件

### 單元測試

```typescript
// test/unit/middleware/rate-limiter.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('rate-limiter middleware', () => {
  beforeEach(() => {
    // 重置 storage mock
    vi.clearAllMocks()
  })

  it('should allow request under limit', async () => {
    // 模擬 event
    const event = {
      path: '/api/auth/log',
      // ...
    }

    // 執行中間件
    await rateLimiter(event)

    // 驗證沒有拋出錯誤
    expect(true).toBe(true)
  })

  it('should block request over limit', async () => {
    // 設定超過限制的記錄
    // ...

    await expect(rateLimiter(event)).rejects.toThrow()
  })
})
```

---

## 12. 快速檢查清單

建立新中間件時，確認以下項目：

### Server Middleware

- [ ] 使用數字前綴控制執行順序（如 `01.`、`02.`）
- [ ] 明確定義適用的路徑範圍
- [ ] 不需要處理時 `return`（不返回值）
- [ ] 需要阻止請求時使用 `createError`
- [ ] 使用結構化 logger 記錄日誌
- [ ] 考慮 Cloudflare 環境的 IP 取得方式

### Client Middleware

- [ ] 全域中間件使用 `.global.ts` 後綴
- [ ] 使用 `navigateTo()` 進行重定向
- [ ] 使用 `definePageMeta` 指定頁面專屬中間件
- [ ] 避免在中間件中進行重型計算
