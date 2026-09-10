# API 結構模板

> **兩件事在抄這些模板之前要先確定：**
>
> 1. **Helper 名依 `modules.auth`**：本檔用 `getSupabaseWithContext(event)`。`better-auth` /
>    `nuxt-auth-utils` 的 consumer 等價名是 `getAuthedSupabase(event)`，回傳形狀相同。
> 2. **這些 helper 回的是 service-role client，不做任何授權。** 下面的模板用
>    `requireRole()` 把整支 endpoint 限定給特定角色——那是「誰能呼叫」。若 endpoint 會回傳
>    **屬於個別使用者**的資料，還需要「能看誰的」那一層：ownership 比對，或以 `user.id`
>    夾住查詢條件。**NEVER 假設 RLS 會替你過濾**（`auth.uid()` 在非 Supabase Auth 的
>    consumer 恆為 null；service-role 連線則整個 bypass RLS）。見
>    [[auth-data-path-consistency]] § Server 側：RLS policy 的前提條件。

## GET 列表 API

```typescript
// server/api/v1/resources/index.get.ts
import { getSupabaseWithContext, requireRole } from "~~/server/utils/supabase";
import { resourceListQuerySchema, resourceListResponseSchema } from "~~/shared/schemas/resources";

export default defineEventHandler(async (event) => {
  await requireRole(event, ["admin", "manager", "staff"]);
  const query = await getValidatedQuery(event, resourceListQuerySchema.parse);
  const { client } = await getSupabaseWithContext(event);
  const db = client.schema("your_schema");

  const from = (query.page - 1) * query.pageSize;
  const to = from + query.pageSize - 1;
  let dbQuery = db
    .from("resources")
    .select("*", { count: "exact" })
    .is("deleted_at", null);

  if (query.search) dbQuery = dbQuery.ilike("name", `%${query.search}%`);
  const sortBy = query.sortBy ?? "id";
  dbQuery = dbQuery.order(sortBy, { ascending: query.sortDir === "asc" });
  if (sortBy !== "id") dbQuery = dbQuery.order("id", { ascending: true });
  const { data, count, error } = await dbQuery.range(from, to);

  if (error) {
    throw createError({ statusCode: 500, message: "載入資料失敗" });
  }

  return resourceListResponseSchema.parse({
    data: data || [],
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total: count || 0,
      totalPages: Math.ceil((count || 0) / query.pageSize),
    },
  });
});
```

## Zod Schema 定義

在 `shared/schemas/` 定義可複用的 Schema 與 response contract：

```typescript
// shared/schemas/resources.ts
import { z } from "zod";

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(1000).default(10),
  search: z.string().nullish(),
  sortBy: z.enum(["id", "name"]).nullish(),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});

export const resourceListQuerySchema = paginationQuerySchema;

export const createResourceSchema = z.object({
  name: z.string().min(1, "名稱必填").max(200),
  description: z.string().max(500).nullish(),
});

export const updateResourceSchema = createResourceSchema.partial();

export const resourceListResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      description: z.string().nullable(),
    }),
  ),
  pagination: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }),
});
```

## 驗證用法

```typescript
// GET：驗證 Query Parameters
const query = await getValidatedQuery(event, resourceListQuerySchema.parse);

// POST/PATCH：驗證 Request Body
const body = await readValidatedBody(event, createResourceSchema.parse);

// 路徑參數
const params = await getValidatedRouterParams(
  event,
  z.object({ id: z.string().uuid() }).parse,
);
```

## 錯誤處理範例

```typescript
// 唯一約束違反
if (error?.code === "23505") {
  throw createError({ statusCode: 409, message: "此代碼已被使用" });
}

// 資源不存在
if (!data) {
  throw createError({ statusCode: 404, message: "找不到指定的資源" });
}
```
