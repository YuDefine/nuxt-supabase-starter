# 快取策略指南

本文檔說明專案的快取策略，包含 Server-side 快取（cachedEventHandler）與 Client-side 快取（Pinia Colada）。

---

## 1. 快取架構概覽

本專案採用雙層快取策略：

```
┌─────────────────────────────────────────────────────────┐
│                    Client (Browser)                     │
├─────────────────────────────────────────────────────────┤
│  Pinia Colada Query Cache                               │
│  - staleTime: 30 秒                                     │
│  - 自動 refetch、mutation 後自動失效                    │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                    Server (Nitro)                       │
├─────────────────────────────────────────────────────────┤
│  cachedEventHandler                                     │
│  - maxAge: 30 分鐘                                      │
│  - staleMaxAge: 1 小時                                  │
│  - SWR (Stale-While-Revalidate)                         │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                    Database (Supabase)                  │
└─────────────────────────────────────────────────────────┘
```

---

## 2. Server-Side 快取：cachedEventHandler

### 基本配置

```typescript
// server/api/v1/items/index.get.ts
export default cachedEventHandler(
  async (event): Promise<ItemListResponse> => {
    // API 邏輯...
  },
  {
    maxAge: 1800, // 30 分鐘：快取有效期
    staleMaxAge: 3600, // 1 小時：過期容忍期
    swr: true, // 啟用 Stale-While-Revalidate
    name: 'items-list', // 快取名稱（用於除錯）
    getKey: (event) => {
      // 快取 key 計算
      const query = getQuery(event)
      return `items:${JSON.stringify(query)}`
    },
  }
)
```

### 快取參數說明

| 參數          | 說明             | 建議值                            |
| ------------- | ---------------- | --------------------------------- |
| `maxAge`      | 快取有效期（秒） | 列表：1800、詳情：3600            |
| `staleMaxAge` | 過期容忍期（秒） | maxAge 的 2 倍                    |
| `swr`         | 背景重新驗證     | 通常為 `true`                     |
| `name`        | 快取名稱         | 資源類型-操作（如 `items-list`）  |
| `getKey`      | 快取 key 函式    | 包含所有查詢參數                  |

### SWR 行為

當 `swr: true` 時：

1. **0 ~ maxAge**：直接返回快取（新鮮）
2. **maxAge ~ staleMaxAge**：立即返回快取 + 背景更新（過期但可用）
3. **> staleMaxAge**：等待新資料（完全過期）

```
時間軸 →
|------- maxAge -------|------- staleMaxAge -------|
|      新鮮快取        |   過期但立即返回 + 更新    |    完全過期
```

### 權限驗證與快取

快取 API 仍需驗證權限，使用 `shouldBypassCache`：

```typescript
export default cachedEventHandler(
  async (event) => {
    // 這裡的權限檢查只在快取 miss 時執行
    await requireRole(event, ['admin', 'editor', 'viewer'])
    // ...
  },
  {
    // 每次請求都驗證權限
    shouldBypassCache: async (event) => {
      try {
        await requireRole(event, ['admin', 'editor', 'viewer'])
        return false // 有權限，使用快取
      } catch {
        return true // 無權限，不使用快取（會觸發 401）
      }
    },
  }
)
```

### 快取 Key 設計

```typescript
// ✅ 正確：包含所有影響結果的參數
getKey: (event) => {
  const query = getQuery(event)
  return `items:${JSON.stringify(query)}`
}
// 產生：items:{"page":1,"pageSize":20,"search":"abc"}

// ✅ 正確：更精確的 key（排序後的查詢參數）
getKey: (event) => {
  const query = getQuery(event)
  const sortedQuery = Object.keys(query)
    .sort()
    .reduce((acc, key) => ({ ...acc, [key]: query[key] }), {})
  return `items:${JSON.stringify(sortedQuery)}`
}

// ❌ 錯誤：忽略查詢參數
getKey: () => 'items' // 所有查詢都共用同一份快取
```

---

## 3. Client-Side 快取：Pinia Colada

### Query Keys 結構

```typescript
// app/queries/items.ts
export const itemKeys = {
  all: ['items'] as const,
  list: (filters?: Record<string, unknown>) =>
    [...itemKeys.all, 'list', filters ?? {}] as const,
  detail: (id: number) => [...itemKeys.all, 'detail', id] as const,
}
```

### Key 層級設計

```
itemKeys.all                    → ['items']
itemKeys.list({})               → ['items', 'list', {}]
itemKeys.list({ page: 2 })     → ['items', 'list', { page: 2 }]
itemKeys.detail(123)            → ['items', 'detail', 123]
```

這種層級設計允許精確的快取失效：

```typescript
// 使所有 item 相關快取失效
queryCache.invalidateQueries({ key: itemKeys.all })

// 只使列表快取失效
queryCache.invalidateQueries({ key: ['items', 'list'] })

// 只使特定詳情快取失效
queryCache.invalidateQueries({ key: itemKeys.detail(123) })
```

### Query 配置

```typescript
export function useItemListQuery(
  filters?: MaybeRefOrGetter<{
    page?: number
    pageSize?: number
    search?: string
  }>
) {
  return useQuery({
    // 動態 key：filters 變更時自動 refetch
    key: () => {
      const f = filters ? toValue(filters) : {}
      return itemKeys.list(f)
    },
    // 查詢函式
    query: async () => {
      const f = filters ? toValue(filters) : {}
      const response = await $fetch<ItemListResponse>('/api/v1/items', {
        query: f,
      })
      return response
    },
    // 資料新鮮度（30 秒內不重新查詢）
    staleTime: 30_000,
  })
}
```

### Mutation 與快取失效

```typescript
export function useCreateItemMutation() {
  const queryCache = useQueryCache()
  const toast = useToast()

  return useMutation({
    mutation: async (data: CreateItemRequest) => {
      const response = await $fetch<CreateItemResponse>('/api/v1/items', {
        method: 'POST',
        body: data,
      })
      return response.data
    },
    onSuccess() {
      // 使相關快取失效
      queryCache.invalidateQueries({ key: itemKeys.all })
      toast.add({ title: '項目已建立', color: 'success' })
    },
    onError(error) {
      const message = error instanceof Error ? error.message : '建立失敗'
      toast.add({ title: message, color: 'error' })
    },
  })
}
```

---

## 4. 快取策略決策樹

### 選擇快取層

```
需要快取嗎？
├── 是：資料變更不頻繁
│   ├── 跨用戶共享？
│   │   ├── 是 → Server-side (cachedEventHandler)
│   │   └── 否 → Client-side (Pinia Colada)
│   └── 兩者都需要 → 雙層快取
└── 否：即時資料
    └── 不使用快取
```

### Server-side 快取時機

| 場景           | 是否使用 | 原因                         |
| -------------- | -------- | ---------------------------- |
| 分類列表       | ✅       | 資料變更不頻繁，可跨用戶共享 |
| 即時監控數據   | ❌       | 需要即時更新                 |
| 使用者個人設定 | ❌       | 用戶專屬，不能共享           |
| 系統參數       | ✅       | 幾乎不變，高度可快取         |

### Client-side 快取時機

| 場景     | staleTime 建議 |
| -------- | -------------- |
| 列表資料 | 30 秒          |
| 詳情資料 | 60 秒          |
| 靜態配置 | 5 分鐘         |
| 即時資料 | 0（不快取）    |

---

## 5. 快取失效策略

### 主動失效

Mutation 後主動使相關快取失效：

```typescript
onSuccess(_data, { id }) {
  // 使列表和詳情快取都失效
  queryCache.invalidateQueries({ key: itemKeys.all })
  queryCache.invalidateQueries({ key: itemKeys.detail(id) })
}
```

### 被動失效

依賴 staleTime 和 maxAge 自動失效：

```typescript
// Client-side
staleTime: 30_000 // 30 秒後視為過期

// Server-side
maxAge: 1800 // 30 分鐘後過期
```

### 精確失效

只失效特定範圍的快取：

```typescript
// 只失效列表，保留詳情
queryCache.invalidateQueries({
  key: itemKeys.list(),
  exact: false, // 匹配所有以此開頭的 key
})

// 精確匹配特定查詢
queryCache.invalidateQueries({
  key: itemKeys.list({ page: 1, pageSize: 20 }),
  exact: true,
})
```

---

## 6. 實際範例

### 完整的查詢模組

```typescript
// app/queries/items.ts
import { useMutation, useQuery, useQueryCache } from '@pinia/colada'
import type { MaybeRefOrGetter } from 'vue'
import { toValue } from 'vue'

// Query Keys
export const itemKeys = {
  all: ['items'] as const,
  list: (filters?: Record<string, unknown>) =>
    [...itemKeys.all, 'list', filters ?? {}] as const,
  detail: (id: number) => [...itemKeys.all, 'detail', id] as const,
}

// 列表查詢
export function useItemListQuery(
  filters?: MaybeRefOrGetter<{
    page?: number
    pageSize?: number
    search?: string
    sortBy?: string
    sortDir?: 'asc' | 'desc'
  }>
) {
  return useQuery({
    key: () => itemKeys.list(filters ? toValue(filters) : {}),
    query: async () => {
      const f = filters ? toValue(filters) : {}
      return await $fetch<ItemListResponse>('/api/v1/items', {
        query: f,
      })
    },
    staleTime: 30_000,
  })
}

// 詳情查詢
export function useItemDetailQuery(id: MaybeRefOrGetter<number | null>) {
  return useQuery({
    key: () => {
      const itemId = toValue(id)
      return itemId ? itemKeys.detail(itemId) : ['items', 'detail', 'empty']
    },
    query: async () => {
      const itemId = toValue(id)
      if (!itemId) return null
      return await $fetch<ItemDetailResponse>(`/api/v1/items/${itemId}`)
    },
    staleTime: 60_000,
  })
}

// 新增 Mutation
export function useCreateItemMutation() {
  const queryCache = useQueryCache()
  const toast = useToast()

  return useMutation({
    mutation: async (data: CreateItemRequest) => {
      return await $fetch<CreateItemResponse>('/api/v1/items', {
        method: 'POST',
        body: data,
      })
    },
    onSuccess() {
      queryCache.invalidateQueries({ key: itemKeys.all })
      toast.add({ title: '項目已建立', color: 'success' })
    },
    onError(error) {
      toast.add({
        title: error instanceof Error ? error.message : '建立失敗',
        color: 'error',
      })
    },
  })
}

// 更新 Mutation
export function useUpdateItemMutation() {
  const queryCache = useQueryCache()
  const toast = useToast()

  return useMutation({
    mutation: async ({ id, data }: { id: number; data: UpdateItemRequest }) => {
      return await $fetch<UpdateItemResponse>(`/api/v1/items/${id}`, {
        method: 'PATCH',
        body: data,
      })
    },
    onSuccess(_data, { id }) {
      queryCache.invalidateQueries({ key: itemKeys.all })
      queryCache.invalidateQueries({ key: itemKeys.detail(id) })
      toast.add({ title: '項目已更新', color: 'success' })
    },
    onError(error) {
      toast.add({
        title: error instanceof Error ? error.message : '更新失敗',
        color: 'error',
      })
    },
  })
}

// 刪除 Mutation
export function useDeleteItemMutation() {
  const queryCache = useQueryCache()
  const toast = useToast()

  return useMutation({
    mutation: async (id: number) => {
      return await $fetch<DeleteItemResponse>(`/api/v1/items/${id}`, {
        method: 'DELETE',
      })
    },
    onSuccess() {
      queryCache.invalidateQueries({ key: itemKeys.all })
      toast.add({ title: '項目已刪除', color: 'success' })
    },
    onError(error) {
      toast.add({
        title: error instanceof Error ? error.message : '刪除失敗',
        color: 'error',
      })
    },
  })
}
```

### 在元件中使用

```vue
<script setup lang="ts">
  import { useItemListQuery, useCreateItemMutation } from '~/queries/items'

  // 響應式查詢參數
  const page = ref(1)
  const pageSize = ref(20)
  const search = ref('')

  // 使用查詢
  const { data, status, refresh } = useItemListQuery(
    computed(() => ({
      page: page.value,
      pageSize: pageSize.value,
      search: search.value,
    }))
  )

  // 使用 mutation
  const { mutate: createItem, status: createStatus } = useCreateItemMutation()

  // 新增項目
  async function handleCreate(formData: CreateItemRequest) {
    await createItem(formData)
    // 成功後快取會自動失效並 refetch
  }
</script>
```

---

## 7. 快速檢查清單

實作快取時，確認以下項目：

### Server-side 快取

- [ ] 設定合理的 `maxAge`（列表 30 分鐘、詳情 1 小時）
- [ ] 設定 `staleMaxAge` 為 `maxAge` 的 2 倍
- [ ] 啟用 `swr: true`
- [ ] `getKey` 包含所有影響結果的查詢參數
- [ ] 使用 `shouldBypassCache` 處理權限驗證

### Client-side 快取

- [ ] 設計層級化的 Query Keys
- [ ] 設定合理的 `staleTime`
- [ ] Mutation 後正確失效相關快取
- [ ] 使用 `invalidateQueries` 而非手動清除

### 通用

- [ ] 不要快取即時資料
- [ ] 不要快取用戶專屬資料（除非 key 包含用戶 ID）
- [ ] 考慮快取失效的連鎖反應
