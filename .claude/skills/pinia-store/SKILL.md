# Pinia Store 架構規範

當建立 `app/stores/**/*.ts` 檔案或處理全域狀態時，自動載入此規範。

---

## 目錄結構

```
app/stores/
├── userPreferences.ts   # 使用者偏好設定（主題、顏色等）
├── auth.ts              # 認證狀態
└── ui.ts                # UI 全域狀態（Sidebar 等）
```

---

## Store 模板

使用 **Composition API 語法** 定義 Store：

```typescript
// app/stores/myStore.ts
import { defineStore } from 'pinia'

export const useMyStore = defineStore('my-store', () => {
  // 狀態 (ref)
  const items = ref<Item[]>([])
  const isLoading = ref(false)
  const error = ref<Error | null>(null)

  // Getters (computed)
  const itemCount = computed(() => items.value.length)
  const hasItems = computed(() => items.value.length > 0)

  // Actions (function)
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

  function clearItems() {
    items.value = []
  }

  // 使用 readonly 保護狀態
  return {
    items: readonly(items),
    isLoading: readonly(isLoading),
    error: readonly(error),
    itemCount,
    hasItems,
    loadItems,
    clearItems,
  }
})
```

---

## 命名規範

```typescript
// ✅ 正確
export const useUserPreferencesStore = defineStore('user-preferences', ...)
export const useAuthStore = defineStore('auth', ...)

// ❌ 錯誤
export const userPreferencesStore = defineStore('preferences', ...)
export const Auth = defineStore('auth', ...)
```

- Store 函式名稱：`use<Name>Store`
- Store ID：`kebab-case`

---

## 使用方式

```vue
<script setup lang="ts">
  const preferencesStore = useUserPreferencesStore()

  // 讀取狀態
  console.log(preferencesStore.preferences)
  console.log(preferencesStore.isLoading)

  // 呼叫 Action
  await preferencesStore.updatePrimaryColor('blue')

  // 解構使用（保持響應性）
  const { preferences, isLoading } = storeToRefs(preferencesStore)
  const { updatePrimaryColor } = preferencesStore
</script>
```

---

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
        // 使用者登入 → 載入資料
        myStore.loadData()
      } else {
        // 使用者登出 → 清空資料
        myStore.clearData()
      }
    },
    { immediate: true }
  )
})
```

**優點**：

- 全域只執行一次
- 自動響應使用者狀態變化
- 不需要在組件中手動呼叫

---

## Composable 包裝

若需保持向後相容，可用 composable 包裝 store：

```typescript
// app/composables/useMyFeature.ts
export function useMyFeature(config: MyConfig) {
  const store = useMyStore()

  // 初始化（如果尚未初始化）
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

---

## 最佳實踐

### 1. 使用 `readonly` 保護狀態

```typescript
return {
  preferences: readonly(preferences), // ✅ 防止外部直接修改
  updatePreferences, // 通過 action 修改
}
```

### 2. 避免在 Store 中使用 `useState`

```typescript
// ❌ 不要這樣
export const useMyStore = defineStore('my-store', () => {
  const data = useState('my-data', () => null) // 錯誤！
  return { data }
})

// ✅ 使用 ref
export const useMyStore = defineStore('my-store', () => {
  const data = ref(null) // 正確
  return { data }
})
```

### 3. 錯誤處理

```typescript
async function loadData() {
  isLoading.value = true
  error.value = null
  try {
    const result = await $fetch('/api/data')
    data.value = result
  } catch (e) {
    error.value = e as Error
    console.error('Failed to load data:', e)
  } finally {
    isLoading.value = false
  }
}
```

---

## 除錯技巧

### Vue DevTools

1. 安裝 Vue DevTools 瀏覽器擴充功能
2. 開啟開發者工具 → Vue tab → Pinia
3. 即時查看所有 store 狀態、mutations、actions

### Console 檢查

```typescript
// 在瀏覽器 console 中
const { $pinia } = useNuxtApp()
console.log($pinia.state.value) // 查看所有 store 狀態
```

---

## 檢查清單

建立新 Store 時確認：

- [ ] 使用 Composition API 語法（`defineStore('id', () => {...})`）
- [ ] 命名遵循 `use<Name>Store` 規範
- [ ] 使用 `readonly()` 保護需要保護的狀態
- [ ] 錯誤處理完整（try/catch + error state）
- [ ] 需要全域初始化則建立對應 Plugin
- [ ] 避免使用 `useState`
