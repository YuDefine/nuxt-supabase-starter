---
name: pinia-store
description: >-
  Pinia store 架構規範。觸發：app/stores/**/*.ts、defineStore、全域狀態管理。NOT for server 端
  狀態或 API route 設計（走 server-api），NOT for 單一元件內的區域狀態（直接用 ref/reactive）。
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
    items,
    isLoading,
    error,
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

- Setup store 回傳所有 state refs，讓 Pinia 接管 SSR hydration、devtools 與 plugins；業務更新集中在 actions。參見 [Pinia Setup Stores](https://pinia.vuejs.org/core-concepts/#setup-stores)。
- 避免在 Store 中使用 `useState`，使用 `ref` 替代
- 錯誤處理：try/catch + error state + finally 重設 loading
- **Pinia Colada loading 欄位**：`useMutation()` 的 `status` 是 data-state（尚無結果時為 `'pending'`），**NEVER** 拿來當 loading；mutation loading 用 `isLoading` / `asyncStatus === 'loading'`，`status` 留給 success/error 判斷。query 的 `status === 'pending'`（首載無資料）則是對的。完整 canonical pattern 見 golden path `page-loading-golden-path` Tier 2.5

## 參考資料

| 檔案                                             | 內容                                   |
| ------------------------------------------------ | -------------------------------------- |
| [references/patterns.md](references/patterns.md) | Plugin 自動初始化、Composable 包裝模式 |

## 檢查清單

- [ ] Composition API 語法（`defineStore('id', () => {...})`）
- [ ] 命名遵循 `use<Name>Store`
- [ ] 回傳所有 state refs，業務更新集中在 actions
- [ ] 完整錯誤處理（try/catch + error state）
- [ ] 需要全域初始化則建立對應 Plugin
- [ ] 不使用 `useState`
