# 快取策略

## 雙層快取架構

### Client 層：Pinia Colada

```typescript
// app/queries/useXxxQuery.ts
export function useXxxQuery() {
  return useQuery({
    key: ['xxx'],
    query: () => $fetch('/api/v1/xxx'),
    staleTime: 30_000, // 30 秒內視為新鮮
    gcTime: 5 * 60_000, // 5 分鐘後回收
  })
}
```

| 參數        | 預設值 | 說明                       |
| ----------- | ------ | -------------------------- |
| `staleTime` | 30s    | 資料新鮮期，期間不重新查詢 |
| `gcTime`    | 5min   | 未使用快取保留時間         |

全域設定在 `colada.options.ts`。

### Server 層：Nitro cachedEventHandler

```typescript
// server/api/v1/xxx.get.ts
export default cachedEventHandler(
  async (event) => {
    // 讀取資料庫
  },
  {
    maxAge: 60, // 60 秒快取
    swr: true, // Stale-While-Revalidate
  }
)
```

## SWR（Stale-While-Revalidate）

1. 快取過期後，先回傳舊資料
2. 背景重新查詢
3. 下次請求回傳新資料

## 快取失效

Mutation 後手動失效：

```typescript
const queryCache = useQueryCache()
queryCache.invalidateQueries({ key: ['xxx'] })
```
