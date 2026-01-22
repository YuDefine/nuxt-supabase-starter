# API 設計指南

本文檔說明專案的 API 設計模式與最佳實踐，適用於 Nuxt 4 + Nitro 後端。

---

## 1. 目錄結構

```
server/
├── api/
│   ├── v1/                    # 版本化業務 API
│   │   ├── resources/
│   │   │   ├── index.get.ts   # GET /api/v1/resources（列表）
│   │   │   ├── index.post.ts  # POST /api/v1/resources（新增）
│   │   │   └── [id]/
│   │   │       ├── index.get.ts    # GET /api/v1/resources/:id
│   │   │       ├── index.patch.ts  # PATCH /api/v1/resources/:id
│   │   │       └── index.delete.ts # DELETE /api/v1/resources/:id
│   ├── auth/                  # 認證 API
│   └── admin/                 # 管理員 API
├── middleware/                # Server middleware
├── routes/auth/               # OAuth routes
└── utils/                     # 共用工具函式
```

### 命名規範

- **檔案名稱**：使用 `index.<method>.ts` 格式（如 `index.get.ts`、`index.post.ts`）
- **路徑參數**：使用 `[id]` 目錄格式，命名要有意義（如 `[resourceId]`）
- **API 版本**：使用 `/api/v1/` 前綴，便於未來升級

---

## 2. 請求驗證

### 使用 Zod Schema

所有 API 必須使用 Zod 進行請求驗證，Schema 定義在 `shared/types/` 目錄：

```typescript
// shared/types/resources.ts
import { z } from 'zod'

// 共用分頁查詢 Schema（可複用）
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(1000).default(10),
  search: z.string().optional(),
  sortBy: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
})

// 新增資源 Schema
export const createResourceSchema = z.object({
  name: z.string().min(1, '名稱必填').max(200),
  description: z.string().max(500).nullable().optional(),
})

// 更新資源 Schema（所有欄位變成可選）
export const updateResourceSchema = createResourceSchema.partial()
```

### 在 API 中使用驗證

```typescript
// GET 請求：驗證 Query Parameters
const query = await getValidatedQuery(event, resourceListQuerySchema.parse)

// POST/PATCH 請求：驗證 Request Body
const body = await readValidatedBody(event, createResourceSchema.parse)

// 路徑參數驗證
const params = await getValidatedRouterParams(
  event,
  z.object({
    id: z.coerce.number().int().positive(),
  }).parse
)
```

---

## 3. 權限檢查

### 使用 requireUserSession

所有需要認證的 API 必須在最開頭進行權限檢查：

```typescript
export default defineEventHandler(async (event) => {
  // 1. 權限檢查放在最前面
  const { user } = await requireUserSession(event, {
    user: { role: ['admin', 'manager', 'staff'] },
  })

  // 2. 驗證請求資料
  // 3. 執行業務邏輯
  // ...
})
```

### 角色階層

| 角色           | 權限範圍            |
| -------------- | ------------------- |
| `admin`        | 完整系統管理權限    |
| `manager`      | 部門管理、資料 CRUD |
| `staff`        | 基本資料讀取        |
| `unauthorized` | 無權限（等待授權）  |

---

## 4. 資料庫存取

### 取得 Supabase Client

```typescript
import { getSupabaseWithContext } from '~~/server/utils/supabase'

export default defineEventHandler(async (event) => {
  // 取得 Supabase Client
  const supabase = await getSupabaseWithContext(event)

  // 使用特定 schema
  const db = supabase.schema('your_schema')

  // 執行查詢
  const { data, error } = await db.from('resources').select('*').is('deleted_at', null)
})
```

### 查詢模式

```typescript
// 列表查詢（含分頁）
const { data, count, error } = await db
  .from('resources')
  .select('*', { count: 'exact' }) // count: 'exact' 取得總筆數
  .is('deleted_at', null) // 軟刪除過濾
  .order('id', { ascending: false })
  .range(from, to) // 分頁

// 單筆查詢
const { data, error } = await db.from('resources').select('*').eq('id', params.id).single()

// 單筆查詢（可能不存在）
const { data, error } = await db.from('resources').select('*').eq('id', params.id).maybeSingle()
```

---

## 5. 回應格式

### 統一回應結構

```typescript
// 列表回應
interface ListResponse<T> {
  data: T[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

// 單筆回應
interface SingleResponse<T> {
  data: T
}

// 刪除回應
interface DeleteResponse {
  data: {
    id: number
    deleted_at: string | null
    hard_deleted: boolean
  }
}
```

### 實作範例

```typescript
// 列表 API 回應
return {
  data: resources,
  pagination: {
    page: query.page,
    pageSize: query.pageSize,
    total: count || 0,
    totalPages: Math.ceil((count || 0) / query.pageSize),
  },
}

// 新增 API 回應（設定 201 狀態碼）
setResponseStatus(event, 201)
return { data: newResource }
```

---

## 6. 錯誤處理

### 錯誤類型與狀態碼

| 狀態碼 | 使用情境                        |
| ------ | ------------------------------- |
| 400    | 請求格式錯誤、驗證失敗          |
| 401    | 未認證                          |
| 403    | 無權限                          |
| 404    | 資源不存在                      |
| 409    | 資源衝突（如重複的 unique key） |
| 429    | 請求過於頻繁                    |
| 500    | 伺服器內部錯誤                  |

### 錯誤處理範例

```typescript
// 處理資料庫唯一約束違反（PostgreSQL error code 23505）
if (error?.code === '23505') {
  throw createError({
    statusCode: 409,
    message: '資料重複，請檢查輸入',
  })
}

// 資源不存在
if (!data) {
  throw createError({
    statusCode: 404,
    message: '找不到指定的資源',
  })
}

// 一般資料庫錯誤
if (error) {
  console.error('Database error:', error)
  throw createError({
    statusCode: 500,
    message: '操作失敗，請稍後再試',
  })
}
```

---

## 7. 操作日誌

### 記錄 CRUD 操作

異動操作應記錄操作日誌：

```typescript
await db.from('operation_logs').insert({
  user_id: user.id,
  action: 'create', // create | update | delete
  target_type: 'resource',
  target_id: newResource.id.toString(),
  details: body,
})
```

---

## 8. 搜尋與排序

### 搜尋實作

```typescript
// 多欄位搜尋（使用 OR 條件）
if (query.search) {
  const searchStr = `%${query.search}%`
  dbQuery = dbQuery.or(`name.ilike.${searchStr},description.ilike.${searchStr}`)
}
```

### 排序實作

```typescript
// 動態排序
const sortDirAsc = query.sortDir === 'asc'
dbQuery = dbQuery.order(query.sortBy || 'id', { ascending: sortDirAsc })
```

### 分頁實作

```typescript
// 計算 range
const from = (query.page - 1) * query.pageSize
const to = from + query.pageSize - 1

// 執行分頁查詢
const { data, count, error } = await dbQuery.range(from, to)
```

---

## 9. 完整 API 範例

### GET 列表 API

```typescript
// server/api/v1/resources/index.get.ts
import { getSupabaseWithContext } from '~~/server/utils/supabase'
import { resourceListQuerySchema } from '~~/shared/types/resources'

export default defineEventHandler(async (event) => {
  // 1. 權限檢查
  await requireUserSession(event)

  // 2. 驗證查詢參數
  const query = await getValidatedQuery(event, resourceListQuerySchema.parse)

  // 3. 取得 Supabase Client
  const supabase = await getSupabaseWithContext(event)
  const db = supabase.schema('your_schema')

  // 4. 建立查詢
  let dbQuery = db.from('resources').select('*', { count: 'exact' }).is('deleted_at', null)

  // 5. 搜尋條件
  if (query.search) {
    const searchStr = `%${query.search}%`
    dbQuery = dbQuery.or(`name.ilike.${searchStr}`)
  }

  // 6. 排序
  dbQuery = dbQuery.order(query.sortBy || 'id', { ascending: query.sortDir === 'asc' })

  // 7. 分頁
  const from = (query.page - 1) * query.pageSize
  const to = from + query.pageSize - 1
  const { data, count, error } = await dbQuery.range(from, to)

  if (error) {
    throw createError({ statusCode: 500, message: '載入資料失敗' })
  }

  // 8. 回應
  return {
    data: data || [],
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total: count || 0,
      totalPages: Math.ceil((count || 0) / query.pageSize),
    },
  }
})
```

---

## 10. 快速檢查清單

建立新 API 時，確認以下項目：

- [ ] 使用正確的檔案命名（`index.get.ts`、`index.post.ts`）
- [ ] 在 `shared/types/` 定義 Zod Schema 和 TypeScript 型別
- [ ] 在最開頭進行權限檢查
- [ ] 使用 `getValidatedQuery` 或 `readValidatedBody` 驗證輸入
- [ ] 使用 `getSupabaseWithContext` 取得資料庫連線
- [ ] 正確處理資料庫錯誤（唯一約束、資源不存在等）
- [ ] 回傳統一格式（`{ data, pagination? }`）
- [ ] 異動操作記錄操作日誌
- [ ] 新增操作設定 201 狀態碼
