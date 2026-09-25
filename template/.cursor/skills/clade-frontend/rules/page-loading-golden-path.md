---
description: Nuxt 導航 loading 回饋 golden path — app.vue 必掛 NuxtLoadingIndicator、主資料用非阻塞 fetch + in-content skeleton、重頁可選全域 overlay + 逾時 toast；禁止頂層 blocking await useFetch 抓主資料
paths: ['app/app.vue', 'packages/*/app/app.vue', 'app/pages/**/*.vue', 'packages/*/app/pages/**/*.vue', 'pages/**/*.vue', 'packages/*/pages/**/*.vue', 'app/plugins/**/*.ts', 'packages/*/app/plugins/**/*.ts', 'app/composables/use*Loading*.ts', 'packages/*/app/composables/use*Loading*.ts', 'app/stores/ui.ts', 'packages/*/app/stores/ui.ts']
---
<!-- Clade native rule; source: rules/modules/framework/nuxt/page-loading-golden-path.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->

# Nuxt 導航 Loading Golden Path（實作階段強制）

最常見的兩個破洞：`app.vue` 沒掛 `<NuxtLoadingIndicator>`（路由切換零回饋），以及頁面用頂層 **blocking `await useFetch`** 抓主資料（卡住 route `setup()`，頁面自己的 skeleton 沒機會顯示，使用者盯空白）。

Reference impl = <consumer-b>（`app/app.vue` + `app/plugins/page-loading.client.ts` + `app/composables/usePageLoading.ts` + `app/stores/ui.ts`），但不含它自刻 bar 與硬編碼 `bg-gray-*` 的 warts。Cookbook：`~/offline/clade/vendor/snippets/nuxt-page-loading/`。與 [[nuxt-ui-mcp]]、[[nuxt-ui-conventions]]、[[development]] § Nuxt UI Color Mode 並列，範圍不重疊。

## 三層架構（Tier 1/2 是 MUST，Tier 3 OPTIONAL）

### Tier 1（MUST）— `<NuxtLoadingIndicator />`

`app.vue` 的 `<UApp>` 內、`<NuxtLayout>` 前掛 `<NuxtLoadingIndicator />`。**MUST NOT** 自刻 top progress bar 跟它重複（<consumer-b> 的 `GlobalLoadingBar` 是反例）。

### Tier 2（MUST）— 非阻塞 fetch + in-content loading

- 頁面**主資料** **MUST** 用非阻塞 fetch：`useLazyFetch`（不要頂層 `await`）、`useAsyncData(key, fn, { lazy: true })`、或 Pinia Colada `useQuery`，並把 loading 接到 in-content skeleton
- **MUST NOT** 用頂層 blocking `await useFetch(...)` 抓主資料。例外：`definePageMeta` / 404 redirect / SEO 標題等 render 前同步必需、且無法用 `watch`/`computed` 容 null 的前置條件，保留 await 並在該行註明理由
- skeleton **MUST** 用 `<USkeleton>` 或語意色 token（`bg-elevated` / `bg-muted`），**NEVER** 硬編碼 `bg-gray-*` / `bg-white` / `bg-black` + `dark:` prefix；容器標 `aria-hidden="true"`，配一個 sr-only `role="status"`
- 真慢的 API 不只加 skeleton：同時查 [[query-optimization]] 修延遲，必要時用 Tier 3 逾時 toast

#### Tier 2.5（MUST）— Pinia Colada loading 欄位推導（query ≠ mutation）

| 欄位 | 語意 |
| --- | --- |
| `status`（`'pending' \| 'success' \| 'error'`） | **data-state**：`'pending'` = 還沒有資料 |
| `asyncStatus`（`'idle' \| 'loading'`）／`isLoading` | **execution-state**：正在抓取 |

`useMutation()` 在 mount 當下就建立 entry，初始 `status` 恆為 `'pending'`，與有沒有觸發無關。所以 **MUST** mutation 的 loading / disabled 用 `mutation.isLoading` 或 `asyncStatus === 'loading'`；**MUST NOT** 用 mutation 的 `status === 'pending'`（mount 後永久 spinner、不發 request、typecheck 全綠）。

```ts
// ✅ query loading：兩段都要（status 首載無資料、asyncStatus refetch 中）
const { data, status, asyncStatus } = useFooListQuery(params)
const isLoading = computed(() => status.value === 'pending' || asyncStatus.value === 'loading')

// ✅ mutation loading：一律 asyncStatus / isLoading；SHOULD 不解構 mutation 物件（可讀 + 可 grep）
const deleteMutation = useDeleteFooMutation()
const deleting = computed(() => deleteMutation.asyncStatus.value === 'loading')
//   或 template 直接：:loading="deleteMutation.isLoading.value"

// ✅ status 仍可用於成功 / 失敗判斷（watch 或 onSuccess/onError），那才是它的用途
watch(() => acceptMutation.status.value, (s) => { if (s === 'success') toast.success('已核准') })
```

```ts
// ❌ mutation loading 用 status === 'pending'：mount 後恆為 true → 永久 spinner
const { mutate: accept, status: acceptStatus } = useAcceptMutation(id)
const acceptLoading = computed(() => acceptStatus.value === 'pending')  // BUG
```

> ⚠️ **不要反向誤修**：query 的 `status === 'pending'` 是**對的**（首載無資料就是要顯示 loading）。只禁 **mutation** 的 `status === 'pending'`。

### Tier 3（OPTIONAL）— 全域 overlay + 逾時 toast

給沒有 in-content skeleton 的頁、或 in-page 長操作（匯出 / 批次 mutation）。cookbook 提供 UI store slice + `usePageLoading`（`withLoading(fn)` + timeout + 最小顯示 300ms + 逾時 toast 重試）+ theme-compliant 元件。**MUST** 標 `role="status"` + `aria-live="polite"` + 可存取 label、動畫尊重 `prefers-reduced-motion`、逾時用 toast（含重試）；overlay 用 `bg-default`/`bg-elevated`/`text-muted`。**MUST NOT** 對已有 in-content skeleton 的列表頁（如 `AdminDataTable`）再疊 Tier 3。

## Reference signal（不 block）

`scripts/audit-nuxt-page-loading.ts`（diagnostic-only，exit 0）每 consumer 報 `nuxtLoadingIndicator` / `blockingAwaitUseFetch` / `usePageLoadingPresent`。各 consumer 落地 **MUST relay 給該 consumer 的 session**（[[clade-role-and-todo-discipline]] § Consumer 工作命中時 MUST relay），**NEVER** 停在「出了表」。

## Tier 2.5 Mechanical Enforcement（4 層，對齊 nuxt-ui-native-picker-ban）

| 層 | scope | 行為 |
| --- | --- | --- |
| impl-time rule（本檔） | 當次 session 寫的 `.vue` | agent 自查 |
| pre-commit gate | staged `.vue` | **blocking**（`vendor/scripts/pre-commit/checks/mutation-loading.sh`） |
| pre-push gate | 全 repo `.vue` | **warn-only**（歷史命中多；某 consumer 清到 0 後可在自家 `pre-push/runner.sh` 改 blocking） |
| review 層 | PR diff | `clade-review-rules.md` § Pinia Colada mutation loading |

兩個 gate 共用偵測器 `vendor/scripts/checks/mutation-loading-detect.ts`（支援跨行 destructuring；只認 alias 來自 `use*Mutation()` 或物件名帶 `Mutation` 的 `status === 'pending'`，query 不誤報）。跨 consumer 盤點：`scripts/audit-pinia-mutation-loading.ts`。
