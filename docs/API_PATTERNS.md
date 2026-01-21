# Server API 設計模式

> 在 Nuxt 中建立安全、可維護的 Server API

## 概覽

本範本採用「Client 讀、Server 寫」的架構：

- **讀取操作**：Client 端直接查詢 Supabase（RLS 保護）
- **寫入操作**：透過 Server API（集中管理邏輯）

這章說明如何設計 Server API。

---

## 目錄結構

```
server/
├── api/
│   ├── v1/                      # 版本化業務 API
│   │   └── [resource]/
│   │       ├── index.get.ts     # GET    /api/v1/[resource]
│   │       ├── index.post.ts    # POST   /api/v1/[resource]
│   │       └── [id]/
│   │           ├── index.get.ts    # GET    /api/v1/[resource]/:id
│   │           ├── index.patch.ts  # PATCH  /api/v1/[resource]/:id
│   │           └── index.delete.ts # DELETE /api/v1/[resource]/:id
│   ├── auth/                    # 認證 API
│   └── admin/                   # 管理員 API
├── middleware/                  # Server Middleware
├── routes/auth/                 # OAuth Routes
├── types/                       # Server Types
└── utils/                       # 工具函式
    └── supabase.ts             # Supabase 相關
```

---

## 基本模式

### GET - 列表查詢

```typescript
// server/api/v1/todos/index.get.ts
import { getSupabaseWithContext, requireAuth } from "~~/server/utils/supabase";

export default defineEventHandler(async (event) => {
  // 確認使用者已登入
  await requireAuth(event);

  // 取得查詢參數
  const query = getQuery(event);
  const page = Number(query.page) || 1;
  const pageSize = Number(query.pageSize) || 20;
  const sortBy = (query.sortBy as string) || "created_at";
  const sortOrder = query.sortOrder === "asc" ? true : false;

  // 取得 Supabase client
  const supabase = await getSupabaseWithContext(event);

  // 計算 offset
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  // 查詢
  const { data, error, count } = await supabase
    .schema("app")
    .from("todos")
    .select("*", { count: "exact" })
    .order(sortBy, { ascending: sortOrder })
    .range(from, to);

  if (error) {
    throw createError({
      statusCode: 500,
      message: "查詢失敗",
    });
  }

  return {
    data,
    pagination: {
      page,
      pageSize,
      total: count || 0,
      totalPages: Math.ceil((count || 0) / pageSize),
    },
  };
});
```

### GET - 單筆查詢

```typescript
// server/api/v1/todos/[id]/index.get.ts
import { getSupabaseWithContext, requireAuth } from "~~/server/utils/supabase";

export default defineEventHandler(async (event) => {
  await requireAuth(event);

  const id = getRouterParam(event, "id");
  if (!id) {
    throw createError({
      statusCode: 400,
      message: "缺少 ID",
    });
  }

  const supabase = await getSupabaseWithContext(event);

  const { data, error } = await supabase
    .schema("app")
    .from("todos")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    throw createError({
      statusCode: 404,
      message: "找不到資料",
    });
  }

  return { data };
});
```

### POST - 新增

```typescript
// server/api/v1/todos/index.post.ts
import { z } from "zod";
import { getSupabaseWithContext, requireAuth } from "~~/server/utils/supabase";

// 定義驗證 schema
const createTodoSchema = z.object({
  title: z.string().min(1, "標題不能為空").max(200, "標題不能超過 200 字"),
  description: z.string().max(2000, "描述不能超過 2000 字").optional(),
  due_date: z.string().datetime().optional(),
  priority: z.enum(["high", "medium", "low"]).default("medium"),
});

export default defineEventHandler(async (event) => {
  // 1. 驗證使用者
  const user = await requireAuth(event);

  // 2. 驗證請求資料
  const body = await readValidatedBody(event, createTodoSchema.parse);

  // 3. 取得 Supabase client
  const supabase = await getSupabaseWithContext(event);

  // 4. 新增資料
  const { data, error } = await supabase
    .schema("app")
    .from("todos")
    .insert({
      ...body,
      user_id: user.id,
    })
    .select()
    .single();

  if (error) {
    console.error("Create todo error:", error);
    throw createError({
      statusCode: 500,
      message: "新增失敗",
    });
  }

  // 5. 回應 201 Created
  setResponseStatus(event, 201);
  return { data };
});
```

### PATCH - 更新

```typescript
// server/api/v1/todos/[id]/index.patch.ts
import { z } from "zod";
import { getSupabaseWithContext, requireAuth } from "~~/server/utils/supabase";

const updateTodoSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  due_date: z.string().datetime().nullable().optional(),
  priority: z.enum(["high", "medium", "low"]).optional(),
  completed: z.boolean().optional(),
});

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event);

  const id = getRouterParam(event, "id");
  if (!id) {
    throw createError({
      statusCode: 400,
      message: "缺少 ID",
    });
  }

  const body = await readValidatedBody(event, updateTodoSchema.parse);

  // 至少要有一個欄位要更新
  if (Object.keys(body).length === 0) {
    throw createError({
      statusCode: 400,
      message: "沒有要更新的欄位",
    });
  }

  const supabase = await getSupabaseWithContext(event);

  // 如果是標記完成，順便記錄完成時間
  const updateData = {
    ...body,
    ...(body.completed === true && { completed_at: new Date().toISOString() }),
    ...(body.completed === false && { completed_at: null }),
  };

  const { data, error } = await supabase
    .schema("app")
    .from("todos")
    .update(updateData)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw createError({
      statusCode: 500,
      message: "更新失敗",
    });
  }

  return { data };
});
```

### DELETE - 刪除

```typescript
// server/api/v1/todos/[id]/index.delete.ts
import { getSupabaseWithContext, requireAuth } from "~~/server/utils/supabase";

export default defineEventHandler(async (event) => {
  await requireAuth(event);

  const id = getRouterParam(event, "id");
  if (!id) {
    throw createError({
      statusCode: 400,
      message: "缺少 ID",
    });
  }

  const supabase = await getSupabaseWithContext(event);

  const { error } = await supabase.schema("app").from("todos").delete().eq("id", id);

  if (error) {
    throw createError({
      statusCode: 500,
      message: "刪除失敗",
    });
  }

  // 回應 204 No Content
  setResponseStatus(event, 204);
  return null;
});
```

---

## 工具函式

### server/utils/supabase.ts

```typescript
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "~~/app/types/database.types";

// 取得 Service Role Client（可繞過 RLS）
export function getServerSupabaseClient(): SupabaseClient<Database> {
  const config = useRuntimeConfig();

  return createClient<Database>(config.public.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

// 取得帶有使用者上下文的 Client
export async function getSupabaseWithContext(event: H3Event): Promise<SupabaseClient<Database>> {
  // 在 Server 端我們使用 service_role，因為 RLS 已經有 service_role 繞過政策
  return getServerSupabaseClient();
}

// 要求使用者已登入
export async function requireAuth(event: H3Event) {
  const session = await getUserSession(event);

  if (!session?.user) {
    throw createError({
      statusCode: 401,
      message: "請先登入",
    });
  }

  return session.user;
}

// 要求使用者有特定角色
export async function requireRole(event: H3Event, allowedRoles: string[]) {
  const user = await requireAuth(event);

  if (!allowedRoles.includes(user.role)) {
    throw createError({
      statusCode: 403,
      message: "權限不足",
    });
  }

  return user;
}
```

---

## 進階模式

### 批次操作

```typescript
// server/api/v1/todos/batch.post.ts
import { z } from "zod";
import { getSupabaseWithContext, requireAuth } from "~~/server/utils/supabase";

const batchCreateSchema = z.object({
  items: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        priority: z.enum(["high", "medium", "low"]).default("medium"),
      }),
    )
    .min(1)
    .max(100),
});

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event);
  const body = await readValidatedBody(event, batchCreateSchema.parse);

  const supabase = await getSupabaseWithContext(event);

  const itemsWithUserId = body.items.map((item) => ({
    ...item,
    user_id: user.id,
  }));

  const { data, error } = await supabase
    .schema("app")
    .from("todos")
    .insert(itemsWithUserId)
    .select();

  if (error) {
    throw createError({
      statusCode: 500,
      message: "批次新增失敗",
    });
  }

  setResponseStatus(event, 201);
  return { data, count: data.length };
});
```

### 搜尋

```typescript
// server/api/v1/todos/search.get.ts
export default defineEventHandler(async (event) => {
  await requireAuth(event);

  const query = getQuery(event);
  const keyword = query.q as string;

  if (!keyword || keyword.length < 2) {
    throw createError({
      statusCode: 400,
      message: "搜尋關鍵字至少 2 個字",
    });
  }

  const supabase = await getSupabaseWithContext(event);

  const { data, error } = await supabase
    .schema("app")
    .from("todos")
    .select("*")
    .or(`title.ilike.%${keyword}%,description.ilike.%${keyword}%`)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    throw createError({
      statusCode: 500,
      message: "搜尋失敗",
    });
  }

  return { data };
});
```

### 操作日誌

```typescript
// server/api/v1/todos/index.post.ts（加入日誌記錄）
export default defineEventHandler(async (event) => {
  const user = await requireAuth(event);
  const body = await readValidatedBody(event, createTodoSchema.parse);

  const supabase = await getSupabaseWithContext(event);

  // 新增資料
  const { data, error } = await supabase
    .schema("app")
    .from("todos")
    .insert({ ...body, user_id: user.id })
    .select()
    .single();

  if (error) {
    throw createError({ statusCode: 500, message: "新增失敗" });
  }

  // 記錄操作日誌
  await supabase
    .schema("core")
    .from("operation_logs")
    .insert({
      user_id: user.id,
      action: "create",
      target_type: "todo",
      target_id: data.id,
      details: { title: body.title },
      ip_address: getRequestIP(event),
    });

  setResponseStatus(event, 201);
  return { data };
});
```

### 資源關聯

```typescript
// server/api/v1/todos/[id]/comments/index.get.ts
export default defineEventHandler(async (event) => {
  await requireAuth(event);

  const todoId = getRouterParam(event, "id");
  if (!todoId) {
    throw createError({ statusCode: 400, message: "缺少 Todo ID" });
  }

  const supabase = await getSupabaseWithContext(event);

  // 先確認 todo 存在
  const { data: todo, error: todoError } = await supabase
    .schema("app")
    .from("todos")
    .select("id")
    .eq("id", todoId)
    .single();

  if (todoError || !todo) {
    throw createError({ statusCode: 404, message: "找不到 Todo" });
  }

  // 取得留言
  const { data, error } = await supabase
    .schema("app")
    .from("todo_comments")
    .select(
      `
      *,
      user:core.user_roles(name, avatar_url)
    `,
    )
    .eq("todo_id", todoId)
    .order("created_at", { ascending: true });

  if (error) {
    throw createError({ statusCode: 500, message: "查詢失敗" });
  }

  return { data };
});
```

---

## 錯誤處理

### 標準錯誤格式

```typescript
throw createError({
  statusCode: 400, // HTTP 狀態碼
  statusMessage: "Bad Request", // HTTP 狀態訊息（可選）
  message: "具體錯誤訊息", // 給開發者/使用者看的訊息
});
```

### 常用狀態碼

| 狀態碼 | 說明                  | 使用場景               |
| ------ | --------------------- | ---------------------- |
| 200    | OK                    | 成功的 GET/PATCH       |
| 201    | Created               | 成功的 POST            |
| 204    | No Content            | 成功的 DELETE          |
| 400    | Bad Request           | 請求格式錯誤、驗證失敗 |
| 401    | Unauthorized          | 未登入                 |
| 403    | Forbidden             | 權限不足               |
| 404    | Not Found             | 資源不存在             |
| 409    | Conflict              | 資源衝突（如重複建立） |
| 500    | Internal Server Error | 伺服器錯誤             |

### 驗證錯誤處理

```typescript
import { z } from "zod";

export default defineEventHandler(async (event) => {
  try {
    const body = await readValidatedBody(event, schema.parse);
    // ...
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw createError({
        statusCode: 400,
        message: error.errors.map((e) => e.message).join(", "),
      });
    }
    throw error;
  }
});
```

---

## Client 端呼叫

### 基本用法

```typescript
// 新增
const { data } = await $fetch("/api/v1/todos", {
  method: "POST",
  body: { title: "買牛奶" },
});

// 更新
await $fetch(`/api/v1/todos/${id}`, {
  method: "PATCH",
  body: { completed: true },
});

// 刪除
await $fetch(`/api/v1/todos/${id}`, {
  method: "DELETE",
});
```

### 錯誤處理

```typescript
try {
  await $fetch("/api/v1/todos", {
    method: "POST",
    body: { title: "" }, // 會觸發驗證錯誤
  });
} catch (error) {
  if (error.statusCode === 400) {
    toast.add({
      title: "驗證失敗",
      description: error.data?.message || "請檢查輸入",
      color: "red",
    });
  } else if (error.statusCode === 401) {
    navigateTo("/login");
  } else {
    toast.add({
      title: "操作失敗",
      description: "請稍後再試",
      color: "red",
    });
  }
}
```

### 搭配 Pinia Colada

```typescript
// app/queries/todos.ts
import { useMutation, useQueryCache } from "@pinia/colada";

export function useCreateTodo() {
  const queryCache = useQueryCache();

  return useMutation({
    mutation: (data: { title: string }) =>
      $fetch("/api/v1/todos", {
        method: "POST",
        body: data,
      }),
    onSuccess: () => {
      // 重新載入列表
      queryCache.invalidateQueries({ key: ["todos"] });
    },
  });
}
```

---

## 安全注意事項

### 1. 永遠驗證輸入

```typescript
// ❌ 危險：直接使用使用者輸入
const body = await readBody(event);
await supabase.from("todos").insert(body);

// ✅ 安全：使用 Zod 驗證
const body = await readValidatedBody(event, schema.parse);
```

### 2. 永遠檢查權限

```typescript
// ❌ 危險：沒有檢查使用者
export default defineEventHandler(async (event) => {
  const supabase = getServerSupabaseClient();
  // ...
});

// ✅ 安全：確認使用者已登入
export default defineEventHandler(async (event) => {
  await requireAuth(event);
  // ...
});
```

### 3. 不要暴露敏感資訊

```typescript
// ❌ 危險：回傳原始錯誤
if (error) {
  throw createError({
    statusCode: 500,
    message: error.message, // 可能包含 SQL 細節
  });
}

// ✅ 安全：回傳通用訊息，詳細錯誤記錄到日誌
if (error) {
  console.error("Database error:", error);
  throw createError({
    statusCode: 500,
    message: "操作失敗",
  });
}
```

### 4. 使用參數化查詢

Supabase SDK 已經處理了 SQL injection，但如果你需要使用 raw SQL：

```typescript
// ❌ 危險：字串拼接
await supabase.rpc("my_function", {
  query: `SELECT * FROM todos WHERE title = '${userInput}'`,
});

// ✅ 安全：使用參數
await supabase.rpc("my_function", {
  title: userInput,
});
```

---

## Cloudflare Workers 注意事項

如果你部署到 Cloudflare Workers，有幾個限制需要注意：

### 1. Request Body 只能讀取一次

```typescript
// ❌ 這會失敗
const body1 = await readBody(event);
const body2 = await readBody(event); // 第二次讀取會失敗

// ✅ 讀取一次，重複使用
const body = await readBody(event);
// 之後都用這個 body
```

### 2. 執行時間限制

- 免費方案：10ms CPU time
- 付費方案：30s

複雜操作考慮使用 Supabase Edge Functions 或拆分成多個請求。

### 3. DELETE 請求避免使用 Body

某些環境的 DELETE 請求不支援 body，優先使用 Query Parameter：

```typescript
// ✅ 推薦
DELETE /api/v1/todos/123

// 或者用 query parameter
DELETE /api/v1/todos?ids=123,456
```
