# Pinia Colada Mutation Cache Invalidation 時序問題

## Problem

Mutation 成功後重新開啟 modal 看不到最新資料。mutation 和上傳都成功但資料過時，需要手動重新整理才看到更新。

## Root Cause

`handleSubmit()` 先呼叫 `mutation.mutateAsync()`（觸發 cache invalidation），再用 `$fetch` 上傳檔案。但 `onSuccess` 在 mutation 完成時就 invalidate，此時檔案還沒上傳完。上傳完成後沒有再次 invalidate，cache 中仍是舊資料。

## What Didn't Work

- 以為 mutation 的 `onSuccess` 已經處理了 invalidation — 是有，但太早了
- 沒注意到檔案上傳是獨立的 `$fetch`，不走 Pinia Colada mutation

## Solution

在所有異步操作（含額外 `$fetch`）都完成後才 invalidate：

```typescript
async function handleSubmit() {
  await mutation.mutateAsync(data)

  if (imageFile.value) {
    await $fetch(`/api/v1/.../image`, { method: 'PUT', body: formData })
  }

  // 所有操作完成後才 invalidate
  queryClient.invalidateQueries({ key: ['your-query-key'] })
}
```

## Prevention

- Mutation 後若有額外 `$fetch`，**必須**在最後一個 API 呼叫完成後才 invalidate
- 檔案上傳若在 mutation 之後，在 `finally` 區塊中 invalidate
- Review 時注意「mutation → 額外 API → 關閉 modal」流程的時序
