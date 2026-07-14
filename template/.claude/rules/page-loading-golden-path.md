---
description: Nuxt 導航 loading 回饋 golden path — app.vue 必掛 NuxtLoadingIndicator、主資料用非阻塞 fetch + in-content skeleton、重頁可選全域 overlay + 逾時 toast；禁止頂層 blocking await useFetch 抓主資料
paths: ['app/app.vue', 'packages/*/app/app.vue', 'template/app/app.vue', 'app/pages/**/*.vue', 'packages/*/app/pages/**/*.vue', 'template/app/pages/**/*.vue', 'pages/**/*.vue', 'app/plugins/**/*.ts', 'packages/*/app/plugins/**/*.ts', 'app/composables/use*Loading*.ts', 'packages/*/app/composables/use*Loading*.ts', 'app/stores/ui.ts', 'packages/*/app/stores/ui.ts']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/modules/framework/nuxt/page-loading-golden-path.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# Nuxt 導航 Loading Golden Path（實作階段強制）

**核心命題**：頁面切換時的 loading 回饋是 cross-cutting concern，不集中規範就會每個 consumer 各自漏。最常見的兩個破洞：(1) `app.vue` 沒掛 `<NuxtLoadingIndicator>` → 路由切換時零回饋；(2) 頁面用頂層 **blocking `await useFetch`** 抓主資料 → Nuxt 卡住 route `setup()`、等 request 回來才 render 整頁 → 初次導航時頁面還沒掛載、頁面自己的 skeleton 沒機會顯示 → 使用者盯空白等，體感像「卡死」。

**Reference impl = <consumer-b>**（`app/app.vue` + `app/plugins/page-loading.client.ts` + `app/composables/usePageLoading.ts` + `app/stores/ui.ts`）。本 rule 從 <consumer-b> 萃取**架構**，但修掉其 warts（自刻 bar 跟 NuxtLoadingIndicator 重複、skeleton 用硬編碼 `bg-gray-*` 違反 color-mode rule）。

> Cookbook 範本：`vendor/snippets/nuxt-page-loading/`（絕對路徑：`~/offline/clade/vendor/snippets/nuxt-page-loading/`，不 bulk-propagate）。
>
> Audit signal：`scripts/audit-nuxt-page-loading.mjs`（diagnostic-only）。

此 rule 與 [[nuxt-ui-mcp]]（API 正確性）、[[nuxt-ui-conventions]]（慣例一致性）、[[development]] § Nuxt UI Color Mode（語意色）並列同 spirit，範圍不重疊。

---

## 三層架構（Tier 1/2 是 MUST，Tier 3 OPTIONAL）

### Tier 1（MUST，普世、零成本）— `<NuxtLoadingIndicator />`

`app.vue` 的 `<UApp>` 內、`<NuxtLayout>` 前掛一行 `<NuxtLoadingIndicator />`。Nuxt 內建路由級頂部進度條，hook `page:start` / `page:finish` 自動開關，零 per-page code，自帶 a11y。單這條就解掉多數「導航空白感」。

### Tier 2（MUST，資料抓取慣例）— 非阻塞 fetch + in-content loading

頁面**主資料** **MUST** 用非阻塞 fetch，讓導航即刻完成、頁面框架立刻 render、資料區用自己的 skeleton 補位：

- `useLazyFetch(url, opts)`（= `useFetch(url, { ...opts, lazy: true })`，但不要頂層 `await`）
- `useAsyncData(key, fn, { lazy: true })`
- Pinia Colada `useQuery(...)`（內建 `state` / `asyncStatus` loading 狀態）

In-content skeleton **MUST** 用 `<USkeleton>`（theme-aware）或語意色 token（`bg-elevated` / `bg-muted`），**NEVER** 硬編碼 `bg-gray-*` + `dark:` prefix（違反 [[development]] § Nuxt UI Color Mode）。skeleton 容器標 `aria-hidden="true"`，配一個 sr-only `role="status"` 告知「載入中」即可（per modern-web-guidance accessibility：別對每個 interstitial 過度播報）。

#### Tier 2.5（MUST）— Pinia Colada loading 欄位推導（query ≠ mutation）

`@pinia/colada` 的 `useQuery` / `useMutation` 各回傳兩個狀態欄位，語意**不同**，混用會造成「按鈕 / spinner 一進頁面就永久 loading」的靜默 bug（typecheck 全綠、無 network request、查 log 也查不到）：

| 欄位 | 型別 | 語意 |
| --- | --- | --- |
| `status` | `'pending' \| 'success' \| 'error'` | **data-state**：`'pending'` = 還沒有資料 |
| `asyncStatus` | `'idle' \| 'loading'` | **execution-state**：`'loading'` = 正在抓取 |
| `isLoading` | `boolean`（computed） | = `asyncStatus === 'loading'`，mutation loading 的最短寫法 |

關鍵差異：**`useMutation()` 在 component mount 當下就建立 entry，初始 `status` 寫死為 `'pending'`**（data-state「還沒被呼叫過、沒有 data」），**與有沒有觸發 mutation 無關**。因此把 `mutation.status === 'pending'` 當 loading → 按鈕從進頁面就 `:loading="true"`，要等第一次成功呼叫後 `status` 翻 `'success'` 才停。

**Canonical pattern（對齊 <consumer-b> reference）**：

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

> ⚠️ **不要反向誤修**：query 的 `status === 'pending'` 是**對的**（首載無資料就是要顯示 loading）。本規約只禁 **mutation** 的 `status === 'pending'` 當 loading；query 維持不動。

### Tier 3（OPTIONAL）— 全域 overlay + 逾時 toast（重頁 / in-page 長操作）

給「沒有 in-content skeleton 的頁」或「in-page 長操作（匯出 / 批次 mutation）需要 blocking overlay + 逾時處理」用。cookbook 提供 UI store slice + `usePageLoading` composable（`withLoading(fn)` + timeout 預設 + 最小顯示 300ms 防閃 + 逾時 toast 重試）+ theme-compliant `GlobalLoadingSpinner` / `GlobalLoadingSkeleton`。

**已有 in-content skeleton 的頁（如用 `AdminDataTable` 的列表）不需要 Tier 3**，疊上去會變雙重 loading UI。

---

## MUST

- **MUST** `app.vue` 掛 `<NuxtLoadingIndicator />`（Tier 1）。
- **MUST** 頁面主資料走非阻塞 fetch（`useLazyFetch` / `useAsyncData {lazy}` / Pinia Colada `useQuery`），並把 loading 狀態接到 in-content skeleton（Tier 2）。
- **MUST** Pinia Colada **mutation** 的 loading / disabled 狀態用 `mutation.isLoading` 或 `asyncStatus === 'loading'` 推導（Tier 2.5）。
- **MUST** skeleton 用 `<USkeleton>` 或語意色 token；overlay 用 `bg-default`/`bg-elevated`/`text-muted` + backdrop，**不**硬編碼黑白灰。
- **MUST** Tier 3 overlay 標 `role="status"` + `aria-live="polite"` + 可存取 label；spinner 動畫尊重 `prefers-reduced-motion`；逾時用 toast（assertive 等級的 API-timeout 訊息 + 重試）。

## MUST NOT

- **MUST NOT** 用頂層 blocking `await useFetch(...)` 抓**主資料**（卡住 route render，skeleton 永遠不顯示）。例外：該資料是 `definePageMeta` / 404 redirect / SEO 標題等 **render 前同步必需** 的前置條件，且無法用 `watch`/`computed` 容 null 時，才保留 await（並在該行註明理由）。
- **MUST NOT** 自刻 top progress bar 跟 `<NuxtLoadingIndicator>` 功能重複（<consumer-b> 的 `GlobalLoadingBar` 是反例；NuxtLoadingIndicator 已涵蓋）。
- **MUST NOT** 在 skeleton / overlay 用硬編碼 `bg-gray-*` / `bg-white` / `bg-black` + `dark:` prefix。
- **MUST NOT** 對「已有 in-content skeleton 的列表頁」再疊 Tier 3 全域 overlay。
- **MUST NOT** 用 Pinia Colada **mutation** 的 `status === 'pending'` 當 loading（data-state，mount 後恆為 true → 按鈕永久 spinner）；query 的 `status === 'pending'` 不在此限（首載無資料是對的）。

## Anti-pattern

| 反模式 | 為何錯 | 正解 |
| --- | --- | --- |
| 頂層 `await useFetch` 抓列表主資料 | 卡 route render，初次導航空白、in-content skeleton 不顯示 | `useLazyFetch` / `useAsyncData {lazy}` / Pinia Colada `useQuery` |
| `app.vue` 無 `<NuxtLoadingIndicator>` | 路由切換零回饋 | 掛 `<NuxtLoadingIndicator />` |
| skeleton 用 `bg-gray-200 dark:bg-gray-700` | 違反 color-mode rule、light/dark 不一致 | `<USkeleton>` 或 `bg-elevated` 語意 token |
| 自刻 setInterval 假進度條 | 跟 NuxtLoadingIndicator 重複、維護成本 | 刪掉，用 NuxtLoadingIndicator |
| overlay spinner 無 `prefers-reduced-motion` | a11y：暈眩使用者 | reduced-motion 時停動畫 / 降透明度 |
| 真慢 API 只加 skeleton | skeleton 治標不治本，仍轉很久 | skeleton（感知）+ 查 [[query-optimization]] 修實際延遲 + Tier 3 逾時 toast 給出路 |
| mutation `status === 'pending'` 當 loading | mutation 的 `status` 是 data-state，mount 後第一次呼叫前恆為 `'pending'` → 按鈕永久 spinner、不發 request | `mutation.isLoading` 或 `asyncStatus === 'loading'`；`status` 留給 success/error 判斷 |
| 為了「修」按鈕順手改掉 query 的 `status === 'pending'` | query 的 `'pending'` = 首載無資料，本來就該顯示 loading | 只動 mutation；query 維持 `status === 'pending' \|\| asyncStatus === 'loading'` |

## Reference signal（不 block）

`scripts/audit-nuxt-page-loading.mjs` 對每 consumer 報（diagnostic-only，exit 0）：

```
nuxtLoadingIndicator      app.vue 是否掛 <NuxtLoadingIndicator>（Y/—）
blockingAwaitUseFetch     pages 內頂層 await useFetch 命中數（越低越好）
usePageLoadingPresent     是否有 Tier 3 usePageLoading composable（Y/—）
```

各 consumer 落地由自家 session 處理（per clade-role-and-todo-discipline）；clade 主線只散播標準 + 出表。

## Tier 2.5 Mechanical Enforcement（4 層，對齊 nuxt-ui-native-picker-ban）

mutation `status === 'pending'` 當 loading 是**真 functional bug**（永久 spinner），比 perceived-perf 議題嚴重，且反覆再犯（<consumer-b> 3 處、<consumer-a> 30+ 處）。故 Tier 2.5 有**四層** enforcement，各管不同 scope：

| 層 | scope | 何時跑 | 行為 |
| --- | --- | --- | --- |
| **impl-time rule** | 當次 session 寫的 `.vue`（本檔 path-scoped 自動 load） | 寫 code 當下 | agent 自查（Anti-pattern 表最後一列） |
| **pre-commit gate** | staged `.vue` | `git commit` | **blocking**（`vendor/scripts/pre-commit/checks/mutation-loading.sh`） |
| **pre-push gate** | 全 repo `.vue`（回溯型） | `git push` | **warn-only**（fleet 有大量歷史命中，全擋會癱瘓 push；`vendor/scripts/pre-push/checks/mutation-loading.sh`） |
| **review 層** | PR diff | code-review agent / `/commit` 0-A | `clade-review-rules.md` § Pinia Colada mutation loading |

三層 mechanical gate 共用同一偵測器 `vendor/scripts/checks/mutation-loading-detect.mjs`（**支援跨行 destructuring** — 舊 audit heuristic 要求 `status:` 與 `Mutation(` 同行，會漏抓多行寫法，已修）。cross-consumer 盤點另有 `scripts/audit-pinia-mutation-loading.mjs`（diagnostic-only，exit 0，import 同一偵測器）。

- **pre-commit blocking**：新違規在源頭就擋，`git diff --cached` 的 `.vue` 有命中 → commit 失敗。
- **pre-push warn-only**：全站掃描回溯提醒既有違規，不阻擋 push。某 consumer 清到 0 後可在自家 `pre-push/runner.sh` 把本 check 改 blocking。
- **偵測範圍**：只認「alias 來源自 `use*Mutation()`」或「物件名帶 `Mutation`」的 `status === 'pending'`；query 的 `status === 'pending'`（首載無資料）**不誤報**。

## 為什麼這條 rule 存在

- 導航 loading 是每個 Nuxt consumer 都會遇到的 cross-cutting concern，散規範必漂移：盤點顯示 <consumer-b> 有完整 pattern、<consumer-a>/starter 有分歧半套、yuntech / agentic-rag / rental-scout / co-purchase 全缺。
- `await useFetch` 的 blocking 行為是 Nuxt 新手最常踩的 perceived-performance 坑，typecheck / lint 抓不到，只有使用者抱怨「卡」才暴露 → 需要 impl-time 規約在最接近犯錯時點對齊。
- skeleton 的色彩硬編碼會同時違反本 rule 與 color-mode rule；統一走 `<USkeleton>` 才 theme-safe。
