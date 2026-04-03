# API 結構模板

## GET 列表 API

```typescript
// server/api/v1/resources/index.get.ts
import { getSupabaseWithContext, requireRole } from '~~/server/utils/supabase'
import { resourceListQuerySchema } from '~~/shared/types/resources'

export default defineEventHandler(async (event) => {
  await requireRole(event, ['admin', 'manager', 'staff'])
  const query = await getValidatedQuery(event, resourceListQuerySchema.parse)
  const supabase = await getSupabaseWithContext(event)
  const db = supabase.schema('your_schema')

  const { data, count, error } = await db
    .from('resources')
    .select('*', { count: 'exact' })
    .is('deleted_at', null)

  if (error) {
    throw createError({ statusCode: 500, message: '載入資料失敗' })
  }

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

## Zod Schema 定義

在 shared/types/ 定義可複用的 Schema：

```typescript
// shared/types/resources.ts
import { z } from 'zod'

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(1000).default(10),
  search: z.string().optional(),
  sortBy: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
})

export const createResourceSchema = z.object({
  name: z.string().min(1, '名稱必填').max(200),
  description: z.string().max(500).nullable().optional(),
})

export const updateResourceSchema = createResourceSchema.partial()
```

## 驗證用法

```typescript
// GET：驗證 Query Parameters
const query = await getValidatedQuery(event, resourceListQuerySchema.parse)

// POST/PATCH：驗證 Request Body
const body = await readValidatedBody(event, createResourceSchema.parse)

// 路徑參數
const params = await getValidatedRouterParams(
  event,
  z.object({ id: z.coerce.number().int().positive() }).parse
)
```

## 錯誤處理範例

```typescript
// 唯一約束違反
if (error?.code === '23505') {
  throw createError({ statusCode: 409, message: '此代碼已被使用' })
}

// 資源不存在
if (!data) {
  throw createError({ statusCode: 404, message: '找不到指定的資源' })
}
```
