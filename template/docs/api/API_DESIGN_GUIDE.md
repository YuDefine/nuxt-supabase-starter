---
audience: both
applies-to: post-scaffold
---

# API 設計指南

本文檔說明本專案的 API 設計模式與最佳實踐，適用於 Nuxt 4 + Nitro 後端。

---

## 1. 目錄結構

```
server/
├── api/
│   ├── v1/                    # 版本化業務 API
│   │   ├── items/
│   │   │   ├── index.get.ts   # GET /api/v1/items（列表）
│   │   │   ├── index.post.ts  # POST /api/v1/items（新增）
│   │   │   └── [id]/
│   │   │       ├── index.get.ts    # GET /api/v1/items/:id
│   │   │       ├── index.patch.ts  # PATCH /api/v1/items/:id
│   │   │       └── index.delete.ts # DELETE /api/v1/items/:id
│   ├── auth/                  # 認證 API
│   └── admin/                 # 管理員 API
├── middleware/                # Server middleware
├── routes/auth/               # OAuth routes
└── utils/                     # 共用工具函式
```

### 命名規範

- **檔案名稱**：使用 `index.<method>.ts` 格式（如 `index.get.ts`、`index.post.ts`）
- **路徑參數**：使用 `[id]` 目錄格式，命名要有意義（如 `[itemId]`）
- **API 版本**：使用 `/api/v1/` 前綴，便於未來升級

---

## 2. 請求驗證

### 使用 Zod Schema

所有 API 必須使用 Zod 進行 request/response 契約定義，Schema 放在 `shared/schemas/`，並由同一個模組導出衍生型別：

```typescript
// shared/schemas/items.ts
import { z } from 'zod'

// 共用分頁查詢 Schema（可複用）
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(1000).default(10),
  search: z.string().optional(),
  sortBy: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
})

// 特定資源的查詢 Schema（擴展共用 Schema）
export const itemListQuerySchema = paginationQuerySchema.extend({
  sortBy: z.enum(['id', 'name', 'code', 'created_at']).optional(),
})

// 新增資源 Schema
export const createItemSchema = z.object({
  name: z.string().min(1, '名稱必填').max(200),
  code: z.string().max(50).nullable().optional(),
  // ... 其他欄位
})

// 更新資源 Schema（所有欄位變成可選）
export const updateItemSchema = createItemSchema.partial()

// 回應 Schema
export const itemResponseSchema = z.object({
  data: z.object({
    id: z.string().uuid(),
    name: z.string(),
    code: z.string().nullable(),
  }),
})
```

`shared/types/` 若存在，僅作為相容轉發或 UI/view-model 型別，不再作為新的 request/response 真相來源。

### 在 API 中使用驗證

```typescript
// GET 請求：驗證 Query Parameters
const query = await getValidatedQuery(event, itemListQuerySchema.parse)

// POST/PATCH 請求：驗證 Request Body
const body = await readValidatedBody(event, createItemSchema.parse)

// 路徑參數驗證
const params = await getValidatedRouterParams(
  event,
  z.object({
    id: z.coerce.number().int().positive(),
  }).parse
)
```

### 回應出口驗證

handler 回傳前，必須用 response schema `parse()`，讓欄位遺漏或 shape drift 在 server 端當場失敗，而不是把 `undefined` 靜默送到前端：

```typescript
const payload = {
  data: item,
}

return itemResponseSchema.parse(payload)
```

---

## 3. 權限檢查

### 使用 requireRole

所有需要認證的 API 必須在最開頭進行權限檢查：

```typescript
import { requireRole } from '~~/server/utils/supabase'

export default defineEventHandler(async (event) => {
  // 1. 權限檢查放在最前面
  const user = await requireRole(event, ['admin', 'editor', 'viewer'])

  // 2. 驗證請求資料
  // 3. 執行業務邏輯
  // ...
})
```

### 角色階層

| 角色      | 權限範圍           |
| --------- | ------------------ |
| `admin`   | 完整系統管理權限   |
| `editor`  | 資料 CRUD          |
| `viewer`  | 基本資料讀取       |
| `pending` | 無權限（等待授權） |

### 權限檢查最佳實踐

```typescript
// ✅ 正確：明確列出允許的角色
await requireRole(event, ['admin', 'editor'])

// ❌ 錯誤：不要使用 exclude 模式
await requireRole(event, { exclude: ['pending'] })
```

---

## 4. 資料庫存取

### 取得 Supabase Client

```typescript
import { getSupabaseWithContext } from '~~/server/utils/supabase'

export default defineEventHandler(async (event) => {
  // 取得帶有 RLS Context 的 Client
  const { client } = await getSupabaseWithContext(event)

  // 使用特定 schema
  const app = client.schema('app')

  // 執行查詢
  const { data, error } = await app.from('items').select('*').is('deleted_at', null)
})
```

### 查詢模式

```typescript
// 列表查詢（含分頁）
const { data, count, error } = await app
  .from('items')
  .select('*', { count: 'exact' }) // count: 'exact' 取得總筆數
  .is('deleted_at', null) // 軟刪除過濾
  .order('id', { ascending: false })
  .range(from, to) // 分頁

// 單筆查詢
const { data, error } = await app.from('items').select('*').eq('id', params.id).single() // 預期只有一筆

// 單筆查詢（可能不存在）
const { data, error } = await app.from('items').select('*').eq('id', params.id).maybeSingle() // 可能 0 或 1 筆
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
  data: items,
  pagination: {
    page: query.page,
    pageSize: query.pageSize,
    total: count || 0,
    totalPages: Math.ceil((count || 0) / query.pageSize),
  },
}

// 新增 API 回應（設定 201 狀態碼）
setResponseStatus(event, 201)
return {
  data: {
    id: newItem.id,
    name: newItem.name,
  },
}
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
  const detail = error.details || error.message || ''
  if (detail.includes('code')) {
    throw createError({
      statusCode: 409,
      message: '此代碼已被使用',
    })
  }
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
  log.error(error as Error, { step: 'db-query' })
  throw createError({
    statusCode: 500,
    message: '操作失敗，請稍後再試',
  })
}
```

---

## 7. 稽核日誌（選用）

### 記錄 CRUD 操作

所有資料異動操作應記錄稽核日誌：

```typescript
// 記錄稽核日誌
await app.from('audit_logs').insert({
  user_id: user.id,
  action: 'create', // create | update | delete
  target_type: 'item', // 資源類型
  target_id: newItem.id.toString(),
  details: {
    // 變更內容
    name: body.name,
    code: body.code,
  },
})
```

### 日誌結構

| 欄位          | 說明                             |
| ------------- | -------------------------------- |
| `user_id`     | 操作者 ID                        |
| `action`      | 操作類型（create/update/delete） |
| `target_type` | 資源類型                         |
| `target_id`   | 資源 ID                          |
| `details`     | 變更詳情（JSON）                 |

---

## 8. 搜尋與排序

### 搜尋實作

```typescript
// 多欄位搜尋（使用 OR 條件）
if (query.search) {
  const searchStr = `%${query.search}%`
  itemsQuery = itemsQuery.or(`name.ilike.${searchStr},code.ilike.${searchStr}`)
}
```

### 排序實作

```typescript
// 動態排序
const sortDirAsc = query.sortDir === 'asc'

if (query.sortBy === 'name') {
  itemsQuery = itemsQuery.order('name', { ascending: sortDirAsc })
} else if (query.sortBy === 'code') {
  itemsQuery = itemsQuery.order('code', { ascending: sortDirAsc })
} else {
  // 預設排序
  itemsQuery = itemsQuery.order('id', { ascending: false })
}
```

### 分頁實作

```typescript
// 計算 range
const from = (query.page - 1) * query.pageSize
const to = from + query.pageSize - 1

// 執行分頁查詢
const { data, count, error } = await itemsQuery.range(from, to)
```

---

## 9. 完整 API 範例

### GET 列表 API

```typescript
// server/api/v1/items/index.get.ts
import { getSupabaseWithContext, requireRole } from '~~/server/utils/supabase'
import { itemListQuerySchema, type ItemListResponse } from '~~/shared/schemas/items'

export default defineEventHandler(async (event): Promise<ItemListResponse> => {
  // 1. 權限檢查
  await requireRole(event, ['admin', 'editor', 'viewer'])

  // 2. 驗證查詢參數
  const query = await getValidatedQuery(event, itemListQuerySchema.parse)

  // 3. 取得 Supabase Client
  const { client } = await getSupabaseWithContext(event)
  const app = client.schema('app')

  // 4. 建立查詢
  let itemsQuery = app.from('items').select('*', { count: 'exact' }).is('deleted_at', null)

  // 5. 搜尋條件
  if (query.search) {
    const searchStr = `%${query.search}%`
    itemsQuery = itemsQuery.or(`name.ilike.${searchStr},code.ilike.${searchStr}`)
  }

  // 6. 排序
  const sortDirAsc = query.sortDir === 'asc'
  itemsQuery = itemsQuery.order(query.sortBy || 'id', { ascending: sortDirAsc })

  // 7. 分頁
  const from = (query.page - 1) * query.pageSize
  const to = from + query.pageSize - 1
  const { data, count, error } = await itemsQuery.range(from, to)

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

### POST 新增 API

```typescript
// server/api/v1/items/index.post.ts
import { getSupabaseWithContext, requireRole } from '~~/server/utils/supabase'
import { createItemSchema, type CreateItemResponse } from '~~/shared/schemas/items'

export default defineEventHandler(async (event): Promise<CreateItemResponse> => {
  // 1. 權限檢查（editor 以上）
  const user = await requireRole(event, ['admin', 'editor'])

  // 2. 驗證請求資料
  const body = await readValidatedBody(event, createItemSchema.parse)

  // 3. 取得 Supabase Client
  const { client } = await getSupabaseWithContext(event)
  const app = client.schema('app')

  // 4. 新增資料
  const { data, error } = await app
    .from('items')
    .insert({ ...body })
    .select('id, name, code')
    .single()

  if (error) {
    // 處理唯一約束違反
    if (error.code === '23505') {
      throw createError({ statusCode: 409, message: '資料重複' })
    }
    throw createError({ statusCode: 500, message: '新增失敗' })
  }

  // 5. 記錄稽核日誌（選用）
  await app.from('audit_logs').insert({
    user_id: user.id,
    action: 'create',
    target_type: 'item',
    target_id: data.id.toString(),
    details: body,
  })

  // 6. 回應
  setResponseStatus(event, 201)
  return { data }
})
```

---

## 10. 進階 API 模式

### 10.1 批次匯入（Excel Import + Dry-run）

```
POST /api/v1/items/import
```

支援兩階段匯入模式：

1. **Dry-run 驗證**：`{ dry_run: true }` — 解析 Excel 回傳預覽資料，不寫入 DB
2. **正式匯入**：`{ dry_run: false }` — 解析後直接寫入

```typescript
// shared/schemas/items.ts
export const importItemsSchema = z.object({
  category_id: z.number().int().positive(),
  dry_run: z.boolean().default(true),
})
```

回應包含解析結果（成功/失敗筆數、驗證錯誤明細），讓 UI 在確認前預覽。

### 10.2 完成動作 + 副作用回報

```
POST /api/v1/items/:id/complete
```

完成動作時觸發副作用計算，並在回應中附加警告資訊：

```typescript
interface CompleteItemResponse {
  data: {
    // ... 資料
    warnings: Warning[] // 副作用產生的警告
  }
}
```

副作用計算失敗不阻擋主流程（try/catch），確保主要操作的可靠性。

---

## 11. 快速檢查清單

建立新 API 時，確認以下項目：

- [ ] 使用正確的檔案命名（`index.get.ts`、`index.post.ts`）
- [ ] 在 `shared/schemas/` 定義 request/response schema 與衍生型別
- [ ] 在最開頭進行權限檢查（`requireRole`）
- [ ] 使用 `getValidatedQuery` 或 `readValidatedBody` 驗證輸入
- [ ] 使用 `getSupabaseWithContext` 取得資料庫連線
- [ ] 正確處理資料庫錯誤（唯一約束、資源不存在等）
- [ ] 回傳統一格式（`{ data, pagination? }`）
- [ ] 異動操作記錄稽核日誌（選用）
- [ ] 新增操作設定 201 狀態碼
