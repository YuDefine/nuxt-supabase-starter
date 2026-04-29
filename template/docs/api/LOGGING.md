---
audience: both
applies-to: post-scaffold
---

# Logging 指南

> Server API 結構化日誌（evlog）的完整使用規範。

---

## Logger 選擇

| 場景                                | Logger                           | 來源      |
| ----------------------------------- | -------------------------------- | --------- |
| API handler（`server/api/**/*.ts`） | `const log = useLogger(event)`   | `evlog`   |
| Server utils（無 `event`）          | `consola.withTag('module-name')` | `consola` |

**規則**：`server/api/` 中禁止使用 `consola`，一律使用 `useLogger(event)`。

```typescript
// ✅ API handler — 第一行就初始化
export default defineEventHandler(async (event) => {
  const log = useLogger(event)
  // ...
})

// ✅ Utils — 無 event 時用 consola
import { consola } from 'consola'
const logger = consola.withTag('my-module')
```

---

## log.error 使用時機

**只記錄非預期錯誤**，不記錄正常業務分支。

判斷標準：如果錯誤代表 caller 的問題（404、422）或已知業務狀態，不記錄。只記錄系統異常（5xx、非預期 DB error）。

```typescript
// ✅ 非預期錯誤 — 要 log.error
if (error) {
  log.error(error as Error, { step: 'db-insert' })
  handleDbError(error)
}

// ❌ 預期錯誤 — 不要 log.error
if (error?.code === 'PGRST116') {
  // 404 是正常情況，直接 throw
  throw createError({ status: 404, message: '找不到資料' })
}
```

---

## log.error 只呼叫一次

每個錯誤路徑只能有 **一個** `log.error` 呼叫。重複記錄 = 重複告警 = 告警疲勞。

```typescript
// ✅ 正確 — 一次
if (error) {
  log.error(error as Error, { step: 'db-upsert' })
  if (isPostgrestError(error)) handleDbError(error)
  throw createError({ status: 500, message: '操作失敗' })
}

// ❌ 錯誤 — 三次
if (error) {
  log.error(error as Error)                    // 第 1 次
  if (isPostgrestError(error)) {
    log.error(error as Error, { step: 'pg' })  // 第 2 次
    handleDbError(error)
  }
  log.error(error as Error)                    // 第 3 次
  throw createError(...)
}
```

---

## log.error 必須在 handleDbError 之前

`handleDbError` 會 throw，之後的程式碼永遠不會執行：

```typescript
// ✅ log 先、handle 後
log.error(error as Error, { step: 'db-insert' })
if (isPostgrestError(error)) handleDbError(error)

// ❌ handle 先 — log 永遠不會到達
if (isPostgrestError(error)) handleDbError(error) // throws here
log.error(error as Error) // unreachable
```

---

## log.error 參數必須非 null

```typescript
// ✅ 安全 — 確認非 null 後才記錄
if (fetchError.value) {
  log.error(fetchError.value as Error)
}

// ❌ 可能是 null — runtime error 或 no-op
log.error(fetchError.value as Error)
```

---

## log.set 時機

| 時機                 | 設定內容                             |
| -------------------- | ------------------------------------ |
| `requireRole()` 之後 | `{ user: { id }, operation, table }` |
| 成功回傳前           | `{ result: { id, ...key fields } }`  |

GET endpoint 可省略 `log.set`，只需初始化 `useLogger(event)` + 錯誤時 `log.error`。

```typescript
export default defineEventHandler(async (event) => {
  const log = useLogger(event)
  const { user } = await requireRole(event, ['admin', 'editor'])

  log.set({ user: { id: user.id }, operation: 'create', table: 'items' })

  // ... 業務邏輯 ...

  log.set({ result: { id: record.id, name: record.name } })
  return { data: record }
})
```

---

## 搜尋字串消毒

所有 `.or()` / `.ilike` 搜尋 **必須** 使用 `sanitizePostgrestSearch()`：

```typescript
// ✅ 消毒後插值
const s = sanitizePostgrestSearch(search.trim())
query.or(`name.ilike.%${s}%,code.ilike.%${s}%`)

// ❌ 直接插值 — filter injection + ILIKE 萬用字元注入
query.or(`name.ilike.%${search}%`)
```

`sanitizePostgrestSearch` 處理的 6 種特殊字元：

| 字元 | PostgREST 語法中的用途     |
| ---- | -------------------------- |
| `,`  | 條件分隔符                 |
| `.`  | 欄位/運算子/值分隔符       |
| `(`  | 群組語法開始               |
| `)`  | 群組語法結束               |
| `%`  | ILIKE 萬用字元（任意字串） |
| `_`  | ILIKE 萬用字元（單一字元） |

函式位置：`server/utils/postgrest.ts`

---

## 完整 API Handler 範例

```typescript
export default defineEventHandler(async (event) => {
  const log = useLogger(event)
  const { user } = await requireRole(event, ['admin', 'editor'])

  log.set({ user: { id: user.id }, operation: 'update', table: 'items' })

  const body = await readValidatedBody(event, updateItemSchema.parse)
  const supabase = getSupabaseWithContext(event)

  const { data, error } = await supabase
    .schema('app')
    .from('items')
    .update(body)
    .eq('id', body.id)
    .select()
    .single()

  if (error) {
    log.error(error as Error, { step: 'db-update' })
    if (isPostgrestError(error)) handleDbError(error)
    throw createError({ status: 500, message: '更新失敗' })
  }

  log.set({ result: { id: data.id } })
  return { data }
})
```
