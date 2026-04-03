# Error Handling 指南

> Server-side 驗證與 Client-side 錯誤顯示的完整規範。

---

## 總覽

| 層級            | 工具                               | 位置                         |
| --------------- | ---------------------------------- | ---------------------------- |
| Server 驗證     | `validateOrThrow(schema, data)`    | `server/utils/validation.ts` |
| Server DB 錯誤  | `handleDbError(error)`             | `server/utils/db-errors.ts`  |
| Client 錯誤通知 | `toastError(title, error)`         | `app/utils/error.ts`         |
| Client 訊息提取 | `getErrorMessage(error, fallback)` | `app/utils/error.ts`         |

---

## Server-side 驗證：validateOrThrow

封裝 Zod `safeParse` + `createError`，從源頭杜絕 `data` 洩漏。

```typescript
import { z } from 'zod'

const updateSchema = z.object({
  id: z.number(),
  name: z.string().min(1),
})

export default defineEventHandler(async (event) => {
  const log = useLogger(event)

  // ✅ 正確 — 驗證失敗自動拋出 400 + 安全訊息
  const body = validateOrThrow(updateSchema, await readBody(event))

  // body 已是型別安全的 { id: number, name: string }
})
```

**行為**：驗證失敗時，函式自動：

1. 記錄 `warn` 日誌（含 Zod issues 細節）
2. 提取第一個欄位路徑和訊息（如 `資料格式錯誤：name Expected string`）
3. 拋出 `createError({ statusCode: 400, statusMessage: hint })`

---

## 禁止：createError 的 data 屬性

```typescript
// ❌ 禁止 — data 可能洩漏內部細節到 client
throw createError({
  statusCode: 400,
  statusMessage: '驗證失敗',
  data: { issues: result.error.issues }, // 暴露 Zod 錯誤結構
})

// ✅ 正確 — 只傳 statusCode + statusMessage
throw createError({
  statusCode: 400,
  statusMessage: '資料格式錯誤：name 為必填',
})
```

原因：`data` 屬性會完整回傳到 client 端，可能包含內部欄位名稱、資料庫結構等敏感資訊。`validateOrThrow` 已從源頭處理此問題。

---

## Server-side DB 錯誤：handleDbError

將 PostgreSQL 錯誤碼轉換為使用者友善的結構化錯誤（含 `why`/`fix` 欄位）。

```typescript
const { data, error } = await supabase
  .from('your_table')
  .update(body)
  .eq('id', id)
  .select()
  .single()

if (error) {
  // ✅ log.error 在 handleDbError 之前（handleDbError 會 throw）
  log.error(error as Error, { step: 'db-update' })
  if (isPostgrestError(error)) handleDbError(error)
  throw createError({ status: 500, message: '操作失敗' })
}
```

**已處理的 PostgreSQL 錯誤碼**：

| 錯誤碼  | 類型           | 回傳 HTTP 狀態碼 |
| ------- | -------------- | ---------------- |
| `23505` | 唯一約束違反   | 409              |
| `23503` | 外鍵約束違反   | 400              |
| `23502` | 非空約束違反   | 400              |
| `23514` | 檢查約束違反   | 400              |
| `22003` | 數值超出範圍   | 400              |
| `22P02` | 文字格式錯誤   | 400              |
| 其他    | 未知資料庫錯誤 | 500              |

---

## Client-side 錯誤顯示

### toastError — 彈出錯誤通知

用於需要立即顯示錯誤 toast 的場景。

```typescript
// ✅ 正確 — 安全提取訊息並顯示 toast
try {
  await $fetch('/api/v1/items', { method: 'POST', body })
} catch (error) {
  toastError('建立失敗', error)
}
```

**行為**：

1. 使用 `parseError`（evlog）提取結構化 `fix` 或 `message` 欄位
2. 過濾 Zod 原始錯誤（如 `Expected string, received undefined`）
3. 顯示 Nuxt UI toast（`color: 'error'`）

### getErrorMessage — 提取安全訊息

用於需要錯誤文字但不一定要 toast 的場景（如行內顯示、自訂 UI）。

```typescript
// ✅ 正確
const message = getErrorMessage(error, '操作失敗')
// message 保證是使用者友善的字串，不會暴露內部細節

// ❌ 禁止 — 直接讀取 error.message
const message = error.message // 可能是 "relation \"app.your_table\" does not exist"
```

### 何時用哪個

| 場景                          | 使用                               |
| ----------------------------- | ---------------------------------- |
| API 呼叫失敗，需要 toast 通知 | `toastError(title, error)`         |
| 表單驗證錯誤，行內顯示        | `getErrorMessage(error, fallback)` |
| 自訂 error UI（非 toast）     | `getErrorMessage(error, fallback)` |

---

## 禁止：直接讀取 error.message

```typescript
// ❌ 禁止
toast.add({ title: error.message, color: 'error' })
// error.message 可能包含：
// - Zod 原始錯誤：「Expected string, received undefined」
// - PostgREST 內部錯誤：「relation "app.xxx" does not exist」
// - 網路錯誤：「fetch failed」

// ✅ 正確
toastError('操作失敗', error)
// 或
const msg = getErrorMessage(error, '操作失敗')
toast.add({ title: msg, color: 'error' })
```

---

## 完整錯誤處理流程

```
Client 呼叫 API
    ↓
Server: validateOrThrow(schema, body)  ← 400 + 安全訊息
    ↓
Server: 業務邏輯 + DB 操作
    ↓ (DB error)
Server: log.error → handleDbError     ← 409/400/500 + why/fix
    ↓
Client: catch error
    ↓
Client: toastError('操作失敗', error)  ← 安全顯示
```
