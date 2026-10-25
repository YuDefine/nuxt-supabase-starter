# Rule 1 - store ID 用 kebab-case

- Level: `MUST`
- `defineStore` 的第一個參數（store ID）用 kebab-case，且與檔名、函式名指同一個概念。

## Good Example

- 這個例子是好的，因為 ID 是 kebab-case，且與 `useUserPreferencesStore` 對得上。

```ts
export const useUserPreferencesStore = defineStore('user-preferences', () => { /* … */ })
```

## Bad Example

- 這個例子是壞的，因為 ID 是 camelCase，又只取了概念的一半。

```ts
export const useUserPreferencesStore = defineStore('preferences', () => { /* … */ })
```

# Rule 2 - store 內不用 Nuxt 的 useState

- Level: `MUST`
- setup store 內的狀態一律用 `ref`／`reactive`；**NEVER** 在 store 裡呼叫 `useState`。Pinia 已負責 SSR hydration，兩套狀態容器並存會讓同一份資料有兩個真相來源。

## Good Example

- 這個例子是好的，因為狀態交給 Pinia 管。

```ts
export const useCartStore = defineStore('cart', () => {
  const items = ref<CartItem[]>([])
  return { items }
})
```

## Bad Example

- 這個例子是壞的，因為 `useState` 另開一份 Nuxt 狀態，與 store 的 hydration 互相覆蓋。

```ts
export const useCartStore = defineStore('cart', () => {
  const items = useState<CartItem[]>('cart-items', () => [])
  return { items }
})
```

# Rule 3 - Pinia Colada 的 mutation loading 不看 status

- Level: `MUST`
- store 包 Pinia Colada 時，mutation 的 loading 用 `isLoading` 或 `asyncStatus === 'loading'`；**NEVER** 用 mutation 的 `status === 'pending'`（首次觸發前就是 `'pending'`，跑完才轉 `'success'`／`'error'`）。query 首載的 `status === 'pending'` 是對的。
- 完整推導與 query／mutation 對照表見 [[page-loading-golden-path]] Tier 2.5；該規約的載入路徑不含一般 store 檔，所以這裡留這條。

## Good Example

- 這個例子是好的，因為 mutation loading 讀的是 execution-state。

```ts
const saveMutation = useMutation({ mutation: savePreferences })
const isSaving = computed(() => saveMutation.asyncStatus.value === 'loading')
```

## Bad Example

- 這個例子是壞的，因為 mutation 的 `status` 在觸發前就是 `'pending'`，使用者還沒按儲存，按鈕一 mount 就顯示 loading。

```ts
const isSaving = computed(() => saveMutation.status.value === 'pending')
```

# Rule 4 - 登入後自動載入用 client plugin 監看 loggedIn

- Level: `MUST`
- store 的資料要跟著登入狀態載入／清除時，建立 `app/plugins/<name>-init.client.ts`，以 `watch(loggedIn, …, { immediate: true })` 在登入時載入、登出時呼叫 store 的清除 action；**NEVER** 散在各頁面或元件的 `onMounted` 手動呼叫。
- `useUserSession()` 是 nuxt-auth-utils 的 API；其他 auth stack 換成該 stack 的登入狀態來源，形狀不變。

## Good Example

- 這個例子是好的，因為全域只執行一次，登入、登出都自動跟上，`immediate` 也涵蓋重新整理時已登入的情況。

```ts
// app/plugins/user-preferences-init.client.ts
export default defineNuxtPlugin(() => {
  const { user, loggedIn } = useUserSession()
  const store = useUserPreferencesStore()

  watch(
    loggedIn,
    (isLoggedIn) => {
      if (isLoggedIn && user.value?.id) store.loadData()
      else store.clearData()
    },
    { immediate: true },
  )
})
```

## Bad Example

- 這個例子是壞的，因為只有進過這一頁才會載入，登出後舊資料也不會清掉。

```vue
<script setup lang="ts">
const store = useUserPreferencesStore()
onMounted(() => store.loadData())
</script>
```
