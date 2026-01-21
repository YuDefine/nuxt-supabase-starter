# Server API 設計規範

當建立 `server/api/**/*.ts` 檔案時，自動載入此規範。

---

## 目錄結構

```
server/api/
├── v1/                       # 版本化業務 API
│   └── resources/
│       ├── index.get.ts      # GET /api/v1/resources（列表）
│       ├── index.post.ts     # POST /api/v1/resources（新增）
│       └── [id]/
│           ├── index.get.ts     # GET /api/v1/resources/:id
│           ├── index.patch.ts   # PATCH /api/v1/resources/:id
│           └── index.delete.ts  # DELETE /api/v1/resources/:id
├── auth/                     # 認證 API
└── admin/                    # 管理員 API
```

### 命名規範

- **檔案名稱**：使用 `index.<method>.ts` 格式
- **路徑參數**：使用有意義的名稱（`[resourceId]` 優於 `[id]`）
- **API 版本**：使用 `/api/v1/` 前綴

---

## API 結構模板

```typescript
// server/api/v1/resources/index.get.ts
import { getSupabaseWithContext, requireRole } from '~~/server/utils/supabase'
import { resourceListQuerySchema } from '~~/shared/types/resources'

export default defineEventHandler(async (event) => {
  // 1. 權限檢查（放在最前面）
  await requireRole(event, ['admin', 'manager', 'staff'])

  // 2. 驗證請求資料
  const query = await getValidatedQuery(event, resourceListQuerySchema.parse)

  // 3. 取得 Supabase Client
  const supabase = await getSupabaseWithContext(event)
  const db = supabase.schema('your_schema')

  // 4. 執行查詢
  const { data, count, error } = await db
    .from('resources')
    .select('*', { count: 'exact' })
    .is('deleted_at', null)

  // 5. 錯誤處理
  if (error) {
    throw createError({ statusCode: 500, message: '載入資料失敗' })
  }

  // 6. 回應
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

## 請求驗證

### Zod Schema 定義

在 `shared/types/` 定義可複用的 Schema：

```typescript
// shared/types/resources.ts
import { z } from 'zod'

// 共用分頁查詢 Schema
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

### 在 API 中使用

```typescript
// GET 請求：驗證 Query Parameters
const query = await getValidatedQuery(event, resourceListQuerySchema.parse)

// POST/PATCH 請求：驗證 Request Body
const body = await readValidatedBody(event, createResourceSchema.parse)

// 路徑參數驗證
const params = await getValidatedRouterParams(
  event,
  z.object({ id: z.coerce.number().int().positive() }).parse
)
```

---

## 權限檢查

```typescript
import { requireRole } from '~~/server/utils/supabase'

// 要求特定角色
const user = await requireRole(event, ['admin', 'manager'])

// 角色階層
// admin    → 完整系統管理權限
// manager  → 部門管理、資料 CRUD
// staff    → 基本資料讀取
```

---

## 回應格式

### 列表回應

```typescript
return {
  data: items,
  pagination: {
    page: query.page,
    pageSize: query.pageSize,
    total: count || 0,
    totalPages: Math.ceil((count || 0) / query.pageSize),
  },
}
```

### 新增回應（201）

```typescript
setResponseStatus(event, 201)
return { data: newItem }
```

### 刪除回應

```typescript
return {
  data: {
    id: params.id,
    deleted_at: result.deleted_at,
    hard_deleted: false,
  },
}
```

---

## 錯誤處理

### 錯誤類型

| 狀態碼 | 使用情境                    |
| ------ | --------------------------- |
| 400    | 請求格式錯誤、驗證失敗      |
| 401    | 未認證                      |
| 403    | 無權限                      |
| 404    | 資源不存在                  |
| 409    | 資源衝突（unique key 違反） |
| 500    | 伺服器內部錯誤              |

### 錯誤處理範例

```typescript
// 處理唯一約束違反
if (error?.code === '23505') {
  throw createError({
    statusCode: 409,
    message: '此代碼已被使用',
  })
}

// 資源不存在
if (!data) {
  throw createError({
    statusCode: 404,
    message: '找不到指定的資源',
  })
}
```

---

## 操作日誌

異動操作應記錄日誌：

```typescript
await db.from('operation_logs').insert({
  user_id: user.id,
  action: 'create', // create | update | delete
  target_type: 'resource',
  target_id: newItem.id.toString(),
  details: body,
})
```

---

## 分頁與搜尋

```typescript
// 計算 range
const from = (query.page - 1) * query.pageSize
const to = from + query.pageSize - 1

// 建立查詢
let dbQuery = db.from('resources').select('*', { count: 'exact' }).is('deleted_at', null)

// 搜尋
if (query.search) {
  const searchStr = `%${query.search}%`
  dbQuery = dbQuery.or(`name.ilike.${searchStr},code.ilike.${searchStr}`)
}

// 排序
dbQuery = dbQuery.order(query.sortBy || 'id', { ascending: query.sortDir === 'asc' })

// 分頁
const { data, count, error } = await dbQuery.range(from, to)
```

---

## 檢查清單

建立新 API 時確認：

- [ ] 使用正確的檔案命名（`index.get.ts`、`index.post.ts`）
- [ ] 在 `shared/types/` 定義 Zod Schema
- [ ] 在最開頭進行權限檢查（`requireRole`）
- [ ] 使用 `getValidatedQuery` 或 `readValidatedBody` 驗證輸入
- [ ] 使用 `getSupabaseWithContext` 取得資料庫連線
- [ ] 正確處理資料庫錯誤
- [ ] 回傳統一格式（`{ data, pagination? }`）
- [ ] 異動操作記錄操作日誌
- [ ] 新增操作設定 201 狀態碼
