---
audience: both
applies-to: post-scaffold
---

# Composable 開發模式

本文檔說明 Vue 3 Composable 的設計模式與最佳實踐，適用於 Nuxt 4 專案。

---

## 1. Composable 是什麼

Composable 是 Vue 3 Composition API 中用於封裝和複用有狀態邏輯的函式。

```
app/composables/
├── usePolling.ts              # 輪詢機制
├── useTablePagination.ts      # 表格分頁邏輯
├── useRefreshController.ts    # 自動重新整理控制
└── useAuthReady.ts            # 認證初始化等待
```

### 命名規範

- 檔案名稱：`use<功能名稱>.ts`（如 `usePolling.ts`）
- 函式名稱：`use<功能名稱>`（如 `usePolling`）
- 使用 camelCase 命名

---

## 2. 基本結構

### 完整的 Composable 模板

```typescript
// app/composables/useMyFeature.ts

/**
 * 功能說明
 *
 * @description 詳細描述這個 composable 的用途
 */

// 1. 定義 Options 介面
interface UseMyFeatureOptions {
  /** 選項說明 */
  option1?: string
  /** 選項說明 */
  option2?: number
}

// 2. 定義 Return 介面
interface UseMyFeatureReturn {
  /** 狀態說明 */
  state: Readonly<Ref<string>>
  /** 計算屬性說明 */
  computed: ComputedRef<number>
  /** 方法說明 */
  action: () => void
}

// 3. 實作 Composable
export function useMyFeature(options: UseMyFeatureOptions = {}): UseMyFeatureReturn {
  // 解構選項，設定預設值
  const { option1 = 'default', option2 = 100 } = options

  // 定義響應式狀態
  const state = ref('initial')

  // 定義計算屬性
  const computed = computed(() => state.value.length)

  // 定義方法
  function action() {
    state.value = 'updated'
  }

  // 回傳（使用 readonly 保護狀態）
  return {
    state: readonly(state),
    computed,
    action,
  }
}
```

---

## 3. 型別定義最佳實踐

### 明確定義 Options 和 Return 型別

```typescript
// ✅ 正確：明確定義介面
interface UsePollingOptions {
  interval?: number
  immediate?: boolean
  pauseOnHidden?: boolean
}

interface UsePollingReturn {
  isPolling: ComputedRef<boolean>
  lastUpdated: Readonly<Ref<Date | null>>
  start: () => void
  stop: () => void
}

export function usePolling(
  callback: () => Promise<void>,
  options: UsePollingOptions = {}
): UsePollingReturn {
  // ...
}

// ❌ 錯誤：直接推斷型別（難以維護）
export function usePolling(callback, options = {}) {
  // ...
}
```

### 使用 Readonly 和 ComputedRef

```typescript
interface UseFeatureReturn {
  // 狀態：使用 Readonly<Ref<T>> 防止外部直接修改
  state: Readonly<Ref<string>>

  // 計算屬性：使用 ComputedRef<T>
  derivedValue: ComputedRef<number>

  // 方法：明確函式簽名
  update: (value: string) => void
  reset: () => void
}
```

---

## 4. 響應式狀態管理

### 使用 ref 和 shallowRef

```typescript
export function useFeature() {
  // 基本類型：使用 ref
  const count = ref(0)
  const isLoading = ref(false)

  // 物件或陣列：考慮使用 shallowRef 提升效能
  const data = shallowRef<DataItem[]>([])

  // 更新 shallowRef 需要整個替換
  function updateData(newData: DataItem[]) {
    data.value = [...newData] // 必須是新的參考
  }

  return {
    count,
    isLoading,
    data: readonly(data),
    updateData,
  }
}
```

### 保護內部狀態

```typescript
export function usePolling() {
  // 內部狀態（加底線前綴）
  const _isPolling = ref(false)

  // 對外暴露為 computed（唯讀）
  const isPolling = computed(() => _isPolling.value)

  // 對外暴露為 readonly
  const lastUpdated = ref<Date | null>(null)

  return {
    isPolling, // ComputedRef（唯讀）
    lastUpdated: readonly(lastUpdated), // Readonly<Ref>（唯讀）
    // ...
  }
}
```

---

## 5. 生命週期管理

### 正確使用 onMounted 和 onUnmounted

```typescript
export function usePolling(callback: () => Promise<void>, options: UsePollingOptions = {}) {
  const { interval = 30000, immediate = true, pauseOnHidden = true } = options

  let timer: ReturnType<typeof setInterval> | null = null

  function start() {
    if (timer) return
    timer = setInterval(execute, interval)
  }

  function stop() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  // 頁面可見性變化處理
  function handleVisibilityChange() {
    if (document.hidden) {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    } else {
      // 頁面可見時恢復
      if (_isPolling.value && !timer) {
        timer = setInterval(execute, interval)
      }
    }
  }

  // 組件掛載時
  onMounted(() => {
    if (immediate) {
      start()
    }

    if (pauseOnHidden) {
      document.addEventListener('visibilitychange', handleVisibilityChange)
    }
  })

  // 組件卸載時（清理資源！）
  onUnmounted(() => {
    stop()

    if (pauseOnHidden) {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  })

  // ...
}
```

### 清理檢查清單

- [ ] `setInterval` 必須在 `onUnmounted` 中 `clearInterval`
- [ ] `addEventListener` 必須在 `onUnmounted` 中 `removeEventListener`
- [ ] `watch` 和 `watchEffect` 會自動清理（不需手動處理）
- [ ] WebSocket 連線必須在 `onUnmounted` 中關閉

---

## 6. 錯誤處理

### 靜默追蹤模式

```typescript
export function usePolling(callback: () => Promise<void>) {
  async function execute() {
    try {
      await callback()
      lastUpdated.value = new Date()
    } catch {
      // 錯誤由錯誤追蹤服務自動追蹤，composable 不拋出異常
      // 這樣可以確保輪詢不會因為一次錯誤而停止
    }
  }

  // ...
}
```

### 需要回報錯誤時

```typescript
export function useDataFetch() {
  const error = ref<Error | null>(null)

  async function fetch() {
    error.value = null
    try {
      // ...
    } catch (e) {
      error.value = e instanceof Error ? e : new Error(String(e))
      // 錯誤由追蹤服務追蹤，同時回報給元件
    }
  }

  return {
    error: readonly(error),
    fetch,
  }
}
```

---

## 7. 與 Pinia Store 的區別

### 何時使用 Composable

| 情境                             | 使用       |
| -------------------------------- | ---------- |
| 邏輯複用（多個元件共用相同邏輯） | Composable |
| 單一元件內的複雜邏輯             | Composable |
| 與 DOM 或瀏覽器 API 互動         | Composable |
| 需要生命週期鉤子                 | Composable |

### 何時使用 Pinia Store

| 情境                       | 使用  |
| -------------------------- | ----- |
| 全域狀態（跨元件、跨頁面） | Store |
| 使用者認證狀態             | Store |
| 應用程式配置               | Store |
| 需要持久化的狀態           | Store |

### 組合使用

```typescript
// composable 可以使用 store
export function useUserPreferences() {
  const preferencesStore = useUserPreferencesStore()

  // 封裝 store 的邏輯，提供更友善的 API
  const isDarkMode = computed(() => preferencesStore.darkMode)

  function toggleDarkMode() {
    preferencesStore.setDarkMode(!isDarkMode.value)
  }

  return {
    isDarkMode,
    toggleDarkMode,
  }
}
```

---

## 8. 實際範例

### useTablePagination

分頁邏輯的完整實作：

```typescript
// app/composables/useTablePagination.ts
import { computed, ref, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import type { SelectOption } from '~/types/ui'

export interface UseTablePaginationOptions {
  defaultPageSize?: number
  pageSizeOptions?: number[]
  resetOnFilterChange?: boolean
}

export interface UseTablePaginationResult {
  page: Ref<number>
  pageSize: ComputedRef<number>
  pageSizeOption: Ref<SelectOption<number>>
  pageSizeOptions: SelectOption<number>[]
  resetPage: () => void
  queryParams: ComputedRef<{ page: number; pageSize: number }>
}

export function useTablePagination(
  options: UseTablePaginationOptions = {}
): UseTablePaginationResult {
  const {
    defaultPageSize = 10,
    pageSizeOptions = [5, 10, 20, 50, 100],
    resetOnFilterChange = true,
  } = options

  // 建立選項陣列
  const selectOptions: SelectOption<number>[] = pageSizeOptions.map((size) => ({
    label: String(size),
    value: size,
  }))

  // 找到預設選項
  const defaultOption =
    selectOptions.find((opt) => opt.value === defaultPageSize) || selectOptions[0]!

  // 狀態
  const page = ref(1)
  const pageSizeOption = ref<SelectOption<number>>(defaultOption)

  // 計算屬性
  const pageSize = computed(() => pageSizeOption.value.value)

  // 當每頁筆數變更時，重置頁數
  if (resetOnFilterChange) {
    watch(pageSize, (newSize, oldSize) => {
      if (oldSize !== undefined && newSize !== oldSize) {
        page.value = 1
      }
    })
  }

  // 重置頁數
  function resetPage(): void {
    page.value = 1
  }

  // API 查詢參數
  const queryParams = computed(() => ({
    page: page.value,
    pageSize: pageSize.value,
  }))

  return {
    page,
    pageSize,
    pageSizeOption,
    pageSizeOptions: selectOptions,
    resetPage,
    queryParams,
  }
}
```

### usePolling

輪詢機制的完整實作：

```typescript
// app/composables/usePolling.ts

interface UsePollingOptions {
  interval?: number
  immediate?: boolean
  pauseOnHidden?: boolean
}

interface UsePollingReturn {
  isPolling: ComputedRef<boolean>
  lastUpdated: Readonly<Ref<Date | null>>
  lastUpdatedText: ComputedRef<string>
  start: () => void
  stop: () => void
  toggle: () => void
  execute: () => Promise<void>
}

export function usePolling(
  callback: () => Promise<void>,
  options: UsePollingOptions = {}
): UsePollingReturn {
  const { interval = 30000, immediate = true, pauseOnHidden = true } = options

  const _isPolling = ref(false)
  const isPolling = computed(() => _isPolling.value)
  const lastUpdated = ref<Date | null>(null)
  let timer: ReturnType<typeof setInterval> | null = null

  const lastUpdatedText = computed(() => {
    if (!lastUpdated.value) return '尚未更新'
    return lastUpdated.value.toLocaleTimeString('zh-TW', { hour12: false })
  })

  async function execute() {
    try {
      await callback()
      lastUpdated.value = new Date()
    } catch {
      // 錯誤由追蹤服務追蹤
    }
  }

  function start() {
    if (timer) return
    _isPolling.value = true
    execute()
    timer = setInterval(execute, interval)
  }

  function stop() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    _isPolling.value = false
  }

  function toggle() {
    if (_isPolling.value) {
      stop()
    } else {
      start()
    }
  }

  function handleVisibilityChange() {
    if (!pauseOnHidden) return

    if (document.hidden) {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    } else {
      if (_isPolling.value && !timer) {
        execute()
        timer = setInterval(execute, interval)
      }
    }
  }

  onMounted(() => {
    if (immediate) {
      start()
    }

    if (pauseOnHidden) {
      document.addEventListener('visibilitychange', handleVisibilityChange)
    }
  })

  onUnmounted(() => {
    stop()

    if (pauseOnHidden) {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  })

  return {
    isPolling,
    lastUpdated: readonly(lastUpdated),
    lastUpdatedText,
    start,
    stop,
    toggle,
    execute,
  }
}
```

---

## 9. 使用範例

### 在元件中使用

```vue
<script setup lang="ts">
  import { usePolling } from '~/composables/usePolling'
  import { useTablePagination } from '~/composables/useTablePagination'

  // 使用分頁 composable
  const { page, pageSize, queryParams, resetPage } = useTablePagination({
    defaultPageSize: 20,
  })

  // 使用輪詢 composable
  const { isPolling, lastUpdatedText, toggle } = usePolling(
    async () => {
      await fetchData()
    },
    { interval: 60000, pauseOnHidden: true }
  )

  async function fetchData() {
    // 使用 queryParams 進行 API 呼叫
    const response = await $fetch('/api/data', {
      query: queryParams.value,
    })
    // ...
  }

  // 當搜尋條件變更時重置頁數
  watch(searchTerm, () => {
    resetPage()
  })
</script>
```

---

## 10. 快速檢查清單

建立新 Composable 時，確認以下項目：

- [ ] 檔案名稱使用 `use<功能名稱>.ts` 格式
- [ ] 定義明確的 Options 和 Return 介面
- [ ] 使用 `readonly()` 保護不應被外部修改的狀態
- [ ] 使用 `computed()` 而非直接暴露 `ref`
- [ ] 在 `onUnmounted` 中清理所有資源（timer、event listener）
- [ ] 錯誤處理不拋出異常，由追蹤服務追蹤
- [ ] 解構 options 時提供合理的預設值
- [ ] 加入 JSDoc 註解說明用途
