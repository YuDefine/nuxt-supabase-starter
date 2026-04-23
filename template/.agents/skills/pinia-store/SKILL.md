---
name: pinia-store
description: >-
  Pinia Store 架構規範。Use when creating app/stores/**/*.ts files,
  working with defineStore, managing global state, or building
  Pinia stores. Always use this skill for store design patterns,
  naming conventions, and state management architecture.
---

# Pinia Store 架構規範

## 目錄結構

```
app/stores/
├── userPreferences.ts   # 使用者偏好設定
├── auth.ts              # 認證狀態
└── ui.ts                # UI 全域狀態
```

## Store 模板

使用 Composition API 語法：

```typescript
import { defineStore } from 'pinia'

export const useMyStore = defineStore('my-store', () => {
  const items = ref<Item[]>([])
  const isLoading = ref(false)
  const error = ref<Error | null>(null)

  const itemCount = computed(() => items.value.length)

  async function loadItems() {
    isLoading.value = true
    error.value = null
    try {
      const data = await $fetch('/api/v1/items')
      items.value = data
    } catch (e) {
      error.value = e as Error
    } finally {
      isLoading.value = false
    }
  }

  return {
    items: readonly(items),
    isLoading: readonly(isLoading),
    error: readonly(error),
    itemCount,
    loadItems,
  }
})
```

## 命名規範

- Store 函式：`use<Name>Store`
- Store ID：`kebab-case`

```typescript
// ✅
export const useUserPreferencesStore = defineStore('user-preferences', ...)
// ❌
export const userPreferencesStore = defineStore('preferences', ...)
```

## 使用方式

```vue
<script setup lang="ts">
  const store = useMyStore()

  // 解構保持響應性
  const { items, isLoading } = storeToRefs(store)
  const { loadItems } = store
</script>
```

## 重要原則

- 使用 `readonly()` 保護回傳的狀態，通過 action 修改
- 避免在 Store 中使用 `useState`，使用 `ref` 替代
- 錯誤處理：try/catch + error state + finally 重設 loading

## 參考資料

| 檔案                                             | 內容                                   |
| ------------------------------------------------ | -------------------------------------- |
| [references/patterns.md](references/patterns.md) | Plugin 自動初始化、Composable 包裝模式 |

## 檢查清單

- [ ] Composition API 語法（`defineStore('id', () => {...})`）
- [ ] 命名遵循 `use<Name>Store`
- [ ] 使用 `readonly()` 保護狀態
- [ ] 完整錯誤處理（try/catch + error state）
- [ ] 需要全域初始化則建立對應 Plugin
- [ ] 不使用 `useState`
