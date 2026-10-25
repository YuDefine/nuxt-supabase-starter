# Rule 1 - client 端寫入預設走 Server API，例外要五條件全中

- Level: `MUST`
- `app/` 內的新增、修改、刪除一律呼叫 `/api/v1/*`；client 直讀是否合法依 `modules.auth`，判準在 [[auth-data-path-consistency]]。
- client 端 `.insert()`／`.update()`／`.delete()`／`.upsert()` 是架構例外，只在 proposal／ADR 明確記錄，且下列五條件同時成立時才可用：
  1. RLS policy 能完整表達 tenant／user scope 與所有授權規則
  2. GRANT 只開必要的 schema／table／operation
  3. 不需要 `service_role`、server-only secret、跨表 transaction、workflow transition、audit-chain、storage upload 或外部 API
  4. 不涉及角色／權限、薪資、簽核、出勤、稽核、批次修復等敏感流程
  5. 有 focused tests 驗證 allow path、deny path、tenant isolation 與 RLS 失敗時的 UI／錯誤處理
- 這五條件在 cf-workers 與 supabase-self-hosted 的 db-runtime 規約也有；supabase-cloud、supabase-local 的沒有，所以本 skill 刻意保留一份。

## Good Example

- 這個例子是好的，因為寫入經過 server 端的授權與驗證。

```ts
await $fetch('/api/v1/posts', { method: 'POST', body: { title: 'Hello' } })
```

## Bad Example

- 這個例子是壞的，因為沒有 ADR 也沒驗證五條件，就從瀏覽器直接寫表。

```ts
await useSupabaseClient<Database>().from('posts').insert({ title: 'Hello' })
```

# Rule 2 - 契約只在 shared/schemas

- Level: `MUST`
- request／response 的 Zod schema 定義在 `shared/schemas/*.ts`，型別從同一個模組以 `z.infer` 導出。
- `shared/types/*.ts` 只放相容轉發或 UI／view-model 型別，**NEVER** 當新的 request／response 真相來源。
- handler 讀輸入一律用 `getValidatedQuery`／`readValidatedBody`／`getValidatedRouterParams` 帶 request schema；回傳前以 response schema `parse()`，讓 DB 回傳與契約漂移時在 server 端就失敗。不論 runtime 都要做——並非每個 runtime 的 `api-patterns` 都寫了這條。

## Good Example

- 這個例子是好的，因為 schema 與型別同源，handler 進出都經過同一份 schema。

```ts
// shared/schemas/post.ts
export const createPostBodySchema = z.object({ title: z.string().min(1) })
export type CreatePostBody = z.infer<typeof createPostBodySchema>
export const postSchema = z.object({ id: z.string().uuid(), title: z.string() })

// server/api/v1/posts/index.post.ts
const body = await readValidatedBody(event, createPostBodySchema.parse)
const { data } = await supabase.from('posts').insert(body).select('id, title').single()
return postSchema.parse(data)
```

## Bad Example

- 這個例子是壞的，因為手寫一份與 schema 平行的介面，handler 也直接收未驗證的 body、原樣回傳 DB 列，兩邊會漂移。

```ts
// shared/types/post.ts
export interface CreatePostBody { title: string }

// server/api/v1/posts/index.post.ts
const body = await readBody<CreatePostBody>(event)
const { data } = await supabase.from('posts').insert(body).select().single()
return data
```

# Rule 3 - 選填的 user input 用 .nullish()

- Level: `MUST`
- 依欄位來源選修飾：

| 欄位來源 | 慣例 |
| --- | --- |
| 選填的 user input（form／textarea／select） | `.nullish()` |
| server 內部 default 帶入（不從 client 收） | `.optional()` |
| 必填欄位 | 不加修飾 |
| discriminated union 內部欄位 | 看 union shape |

- `.optional()` 不接受 `null`，而 form binding 常送 `value.trim() || null`，DB nullable 欄位的真實值也是 null。
- 新增接 user input 的 schema 後 **MUST** 寫 boundary test 涵蓋 `null`／`undefined`／`''`／字串值，並 trace 真實 client code 確認送什麼。範例見 `testing-anti-patterns` Anti-Pattern 6。

## Good Example

- 這個例子是好的，因為 client 送 `null` 也能通過。

```ts
const schema = z.object({ return_notes: z.string().trim().max(500).nullish() })
```

## Bad Example

- 這個例子是壞的，因為 client 送 `{ return_notes: null }` 會得到 400 ZodError。

```ts
const schema = z.object({ return_notes: z.string().trim().max(500).optional() })
```

# Rule 4 - 路徑用 /api/v1/ 前綴與具名參數

- Level: `MUST`
- 業務 API 放 `server/api/v1/`，檔名 `index.<method>.ts`；路徑參數用具名的 `[resourceId]`，不用 `[id]`。

## Good Example

- 這個例子是好的，因為版本前綴與參數名一眼看得出資源。

```text
server/api/v1/orders/[orderId]/index.patch.ts
```

## Bad Example

- 這個例子是壞的，因為沒有版本前綴，巢狀時 `[id]` 也分不清是哪個資源。

```text
server/api/orders/[id].patch.ts
```

# Rule 5 - 授權寫在 handler，排序非 id 時補 id tie-breaker

- Level: `MUST`
- `getSupabaseWithContext`／`getAuthedSupabase` 回的是 service-role client，RLS 不會替你過濾：先驗角色／操作權限，資料屬於個別使用者或 tenant 時再以 ownership 或查詢條件限縮。判準見 [[auth-data-path-consistency]] § Server 側：RLS policy 的前提條件。
- 列表排序欄位不是 `id` 時，再補一個 `id` 升冪排序，分頁才穩定。
- client 傳來的排序欄位 **MUST** 在 query schema 以 `z.enum` 限定 allowlist，**NEVER** 把任意字串直接交給 `.order()`。

## Good Example

- 這個例子是好的，因為排序欄位先經 allowlist，同值的列在翻頁時順序也固定。

```ts
// shared/schemas/post.ts
export const listPostsQuerySchema = z.object({
  sortBy: z.enum(['id', 'created_at', 'title']).default('id'),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
})

// server/api/v1/posts/index.get.ts
const query = await getValidatedQuery(event, listPostsQuerySchema.parse)
const sortBy = query.sortBy
dbQuery = dbQuery.order(sortBy, { ascending: query.sortDir === 'asc' })
if (sortBy !== 'id') dbQuery = dbQuery.order('id', { ascending: true })
```

## Bad Example

- 這個例子是壞的，因為 `created_at` 相同的列在不同頁之間會重複或漏掉。

```ts
dbQuery = dbQuery.order('created_at', { ascending: false })
```
