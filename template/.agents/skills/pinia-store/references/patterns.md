# 進階模式

## Plugin 自動初始化

使用 Plugin 處理全域初始化邏輯：

```typescript
// app/plugins/my-store-init.client.ts
export default defineNuxtPlugin(() => {
  const { user, loggedIn } = useUserSession()
  const myStore = useMyStore()

  watch(
    loggedIn,
    (isLoggedIn) => {
      if (isLoggedIn && user.value?.id) {
        myStore.loadData()
      } else {
        myStore.clearData()
      }
    },
    { immediate: true }
  )
})
```

優點：全域只執行一次、自動響應狀態變化、不需在組件中手動呼叫。

## Composable 包裝

若需保持向後相容，可用 composable 包裝 store：

```typescript
// app/composables/useMyFeature.ts
export function useMyFeature(config: MyConfig) {
  const store = useMyStore()

  if (!store.isInitialized) {
    store.initialize(config)
  }

  return {
    data: store.data,
    isLoading: store.isLoading,
    refresh: store.refresh,
  }
}
```
