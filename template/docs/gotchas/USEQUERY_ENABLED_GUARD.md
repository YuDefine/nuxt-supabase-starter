# Pinia Colada useQuery 缺少 enabled 守衛

## Problem

頁面載入時 console 出現 500 Internal Server Error。Modal/Slideover 尚未開啟就發送請求，server-side schema `.refine()` 驗證失敗。

## Root Cause

`useQuery` 在元件的 `<script setup>` 階段立即執行。Modal/Slideover/Dialog 的 setup 在父元件渲染時就跑，即使 UI 尚未開啟。當 query 依賴的 prop 為 null 時，server-side schema `.refine()` 驗證「至少需要一個參數」就會失敗。

## What Didn't Work

- 以為 Slideover 未開啟就不會執行 setup — 錯，`<script setup>` 在 mount 時就跑
- 開發環境未觸發 — 因為測試資料已存在

## Solution

所有依賴 optional props 或條件狀態的 query 加上 `enabled` 守衛：

```typescript
const { data } = useQuery({
  key: () => ['resource-detail', props.resourceId],
  query: () => $fetch(`/api/v1/resources/${props.resourceId}`),
  enabled: () => !!props.resourceId, // 守衛
})
```

## Prevention

- Server-side schema 使用 `.refine()` 時，client query **必須**有對應的 `enabled` 檢查
- Review 時特別注意 Modal/Slideover/Dialog 內的 query
- Query composable 有 optional 參數就要有 `enabled` 守衛
