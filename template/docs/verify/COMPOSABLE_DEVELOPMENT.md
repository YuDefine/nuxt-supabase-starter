# Vue Composable 開發指南

## 命名規範

- 檔案：`app/composables/useXxx.ts`
- 函式：`useXxx()`（必須以 `use` 開頭）
- Named export：`export function useXxx()`

## 基本結構

```typescript
export function useXxx(options?: XxxOptions) {
  // 1. Reactive state
  const data = ref<XxxData | null>(null)
  const loading = ref(false)
  const error = ref<Error | null>(null)

  // 2. Computed
  const isEmpty = computed(() => !data.value)

  // 3. Methods
  async function fetch() {
    loading.value = true
    try {
      data.value = await $fetch('/api/v1/xxx')
    } catch (e) {
      error.value = e as Error
    } finally {
      loading.value = false
    }
  }

  // 4. Lifecycle
  onMounted(fetch)

  // 5. Return（明確列出，不用 spread）
  return {
    data: readonly(data),
    loading: readonly(loading),
    error: readonly(error),
    isEmpty,
    fetch,
  }
}
```

## 設計原則

- **Readonly output**：回傳 `readonly()` 包裝的 ref，防止外部直接修改
- **明確 return**：列出所有回傳值，不用 `...toRefs()`
- **單一職責**：一個 composable 做一件事
- **可測試**：不依賴全域狀態，透過參數注入依賴

## 與 Pinia Store 的分界

| 場景         | 用 Composable          | 用 Pinia Store |
| ------------ | ---------------------- | -------------- |
| 元件區域狀態 | ✓                      |                |
| 跨元件共享   |                        | ✓              |
| Server state | ✓（搭配 Pinia Colada） |                |
| 全域 UI 狀態 |                        | ✓              |
