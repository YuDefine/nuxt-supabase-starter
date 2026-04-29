---
audience: both
applies-to: post-scaffold
---

# Cursor Pagination Guide

本專案支援兩種分頁模式：**offset**（傳統頁碼）與 **cursor**（游標），由同一組 API endpoint 同時提供，透過 query 參數自動偵測切換。

## 核心檔案

| 檔案                                | 用途                                     |
| ----------------------------------- | ---------------------------------------- |
| `shared/schemas/pagination.ts`      | 分頁 schema 定義、常數、回應型別         |
| `server/utils/cursor.ts`            | cursor 編碼 / 解碼（Base64url）          |
| `server/utils/cursor-pagination.ts` | 偵測模式、套用 cursor filter、格式化回應 |

## Offset vs Cursor 比較

| 面向            | Offset                                  | Cursor                       |
| --------------- | --------------------------------------- | ---------------------------- |
| 適用場景        | 需要跳頁、顯示總數的表格                | 無限捲動、即時串流日誌       |
| Query 參數      | `page` + `pageSize`                     | `cursor` + `limit`           |
| 需要 COUNT 查詢 | 是                                      | 否                           |
| 大資料集效能    | page 越大越慢（`OFFSET N` 需掃描 N 筆） | 恆定效能（WHERE 條件走索引） |
| 資料一致性      | 中間插入新資料會導致重複/遺漏           | 不受新增資料影響             |

## 偵測邏輯

`detectPaginationMode()` 根據 query 參數決定模式：

```typescript
// server/utils/cursor-pagination.ts
function detectPaginationMode(query: Record<string, unknown>): PaginationMode {
  if ('cursor' in query) {
    // cursor 參數存在（含空值）→ cursor 模式
    const parsed = cursorPaginationSchema.parse(query)
    return { mode: 'cursor', cursor: parsed.cursor, limit: parsed.limit }
  }
  // 否則 → offset 模式
  const parsed = paginationSchema.parse(query)
  return { mode: 'offset', page: parsed.page, pageSize: parsed.pageSize }
}
```

判斷依據是 `'cursor' in query`，不是用 `limit` 判斷，因為多個 endpoint 的 offset schema 也使用 `limit` 作為參數名。

### 前端呼叫範例

```
# Offset 模式（預設）
GET /api/v1/items?page=2&pageSize=50

# Cursor 模式 — 第一頁
GET /api/v1/items?cursor=&limit=20

# Cursor 模式 — 下一頁（帶 cursor）
GET /api/v1/items?cursor=eyJjIjoiMjAyNi...&limit=20
```

## Cursor 編碼格式

Cursor 是一個 Base64url 編碼的 JSON 字串，包含兩個定位欄位：

```typescript
// server/utils/cursor.ts
interface CursorPayload {
  createdAt: string // ISO 8601 datetime
  id: number | string // 整數 ID 或 UUID
}
```

編碼後的 JSON 格式為 `{ c: "2026-04-01T10:00:00Z", i: 42 }`（壓縮 key 名稱），再經過 `Buffer.from(...).toString('base64url')` 編碼。

解碼時使用 Zod schema 驗證格式，不合法的 cursor 拋出 400 錯誤。

## Supabase Query Builder 套用

`applyCursorFilter()` 將 cursor 條件套用到 Supabase query builder：

```typescript
function applyCursorFilter<T>(
  queryBuilder: T,
  pagination: { mode: 'cursor'; cursor: string | undefined; limit: number },
  options?: {
    createdAtColumn?: string // 預設 'created_at'
    ascending?: boolean // 預設 false（降序）
    idColumn?: string // 預設 'id'
  }
): T
```

此函式完成三件事：

1. **WHERE 條件**（若有 cursor）— 透過 PostgREST `.or()` 語法
2. **ORDER BY** — 主排序欄位 + id 次排序
3. **LIMIT** — `limit + 1`（多取一筆偵測是否有下一頁）

### PostgREST `.or()` 語法

Cursor 分頁的 WHERE 條件使用複合比較，確保排序的穩定性（即使多筆資料有相同 `created_at`，仍能透過 `id` 區分先後）：

**降序（預設）**：取「比 cursor 更舊」的資料

```
.or('created_at.lt.{cursor_time},and(created_at.eq.{cursor_time},id.lt.{cursor_id})')
```

等同 SQL：

```sql
WHERE created_at < :cursor_time
   OR (created_at = :cursor_time AND id < :cursor_id)
ORDER BY created_at DESC, id DESC
```

**升序**：取「比 cursor 更新」的資料

```
.or('created_at.gt.{cursor_time},and(created_at.eq.{cursor_time},id.gt.{cursor_id})')
```

### 自訂排序欄位

部分 endpoint 的時間欄位不是 `created_at`（例如使用 `update_date`），透過 `createdAtColumn` 選項指定：

```typescript
const cursorOpts = { createdAtColumn: 'update_date' }
dataQuery = applyCursorFilter(dataQuery, pagination, cursorOpts)
// ...
const result = formatCursorResponse(rows, pagination.limit, cursorOpts)
```

## 回應格式

### Offset 模式

```typescript
interface PaginatedResponse<T> {
  data: T[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}
```

### Cursor 模式

```typescript
interface CursorPaginatedResponse<T> {
  data: T[]
  nextCursor: string | null // null 表示沒有下一頁
  hasMore: boolean
}
```

`formatCursorResponse()` 從查詢結果（多取的 `limit + 1` 筆）中判斷 `hasMore`，並從最後一筆資料產生 `nextCursor`：

```typescript
function formatCursorResponse<T>(rows: T[], limit: number, options?): CursorPaginatedResponse<T> {
  const hasMore = rows.length > limit
  const data = hasMore ? rows.slice(0, limit) : rows

  let nextCursor: string | null = null
  if (hasMore && data.length > 0) {
    const lastRow = data[data.length - 1]
    nextCursor = encodeCursor({
      createdAt: String(lastRow[createdAtColumn]),
      id: lastRow[idColumn],
    })
  }

  return { data, nextCursor, hasMore }
}
```

## PAGE_SIZE_MAX 常數

`PAGE_SIZE_MAX`（值為 1000）定義在 `shared/schemas/pagination.ts`，同時作為 offset 的 `pageSize` 和 cursor 的 `limit` 上限：

```typescript
export const PAGE_SIZE_MAX = 1000
export const PAGE_SIZE_DEFAULT = 1000 // offset 預設
export const CURSOR_LIMIT_DEFAULT = 20 // cursor 預設
```

所有 endpoint 的 `pageSize` / `limit` 驗證 **必須** 使用 `PAGE_SIZE_MAX`，禁止硬編碼數值。

## API 整合模式

### 標準實作步驟

1. **偵測分頁模式**

```typescript
const pagination = await getValidatedPagination(event)
```

2. **依模式分支**

```typescript
if (pagination.mode === 'cursor') {
  // cursor 路徑：不需 countQuery
  dataQuery = applyCursorFilter(dataQuery, pagination)
  const { data, error } = await dataQuery
  // ... 資料轉換 ...
  return formatCursorResponse(transformedData, pagination.limit)
}

// offset 路徑：需要 countQuery
const { page, pageSize } = pagination
const offset = calculateOffset(page, pageSize)
// ... 使用 .range(offset, offset + pageSize - 1) ...
```

3. **效能注意**：cursor 模式跳過 `{ count: 'exact', head: true }` 查詢，減少一次 COUNT 掃描

### 複合回應（含摘要資料）

部分 endpoint 的回應結構不是單純的 `{ data, nextCursor, hasMore }`，而是包含額外摘要。此時將 `formatCursorResponse` 的結果拆解後組裝：

```typescript
const cursorResult = formatCursorResponse(records, pagination.limit, cursorOpts)

return {
  data: {
    summary: { total, by_level, by_type },
    items: cursorResult.data,
  },
  nextCursor: cursorResult.nextCursor,
  hasMore: cursorResult.hasMore,
}
```

## 效能考量

### 索引需求

Cursor 分頁的效能依賴 `(created_at, id)` 複合索引。確保排序欄位有適當的 B-tree 索引：

```sql
CREATE INDEX idx_table_created_at_id ON app.your_table (created_at DESC, id DESC);
```

### 為何不用 OFFSET

PostgreSQL 的 `OFFSET N` 需要先掃描並跳過 N 筆資料，第 1000 頁仍需掃描前 999 頁的資料。Cursor 透過 WHERE 條件直接定位，效能不隨頁數增加而衰退。

### Cursor 模式的代價

- 無法跳頁（只能「下一頁」）
- 無法顯示總數（除非額外執行 COUNT 查詢）
- Cursor 編碼增加微量 CPU 開銷（可忽略）
