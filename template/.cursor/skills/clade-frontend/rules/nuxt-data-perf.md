---
description: Nuxt data fetching 選用決策、Pinia Colada 最佳實踐、dedupe/cache/payload 效能規約；涵蓋 useFetch / useAsyncData / $fetch / useQuery / useMutation 全棧
paths: ['**/*.vue', 'app/**/*.ts', 'packages/*/app/**/*.ts', 'server/**/*.ts', 'packages/*/server/**/*.ts', 'composables/**', 'packages/*/composables/**', 'queries/**', 'packages/*/queries/**', 'stores/**', 'packages/*/stores/**', 'nuxt.config.*', 'app.config.*']
---
<!-- Clade native rule; source: rules/core/nuxt-data-perf.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->

# Nuxt Data Fetching & Performance

> Cookbook：`~/offline/clade/vendor/snippets/nuxt-data-perf/`；稽核 skill：`/nuxt-data-audit`。

## Data Fetching 選用決策樹

| 場景 | 用什麼 | 原因 |
|------|--------|------|
| Component setup 取 API data（需 SSR hydration） | `useFetch` | 自動 SSR → payload → client hydrate，防 double fetch |
| Component setup 做複雜 async（CMS、third-party SDK） | `useAsyncData` | 同上 SSR 保護，handler 自由度更高 |
| Event handler / form submit / mutation（不需 reactive） | `$fetch` | 不需 SSR hydration，直接 fire-and-forget |
| 需要跨 component cache + 自動 dedup + staleTime | `useQuery`（Pinia Colada） | 內建 cache layer、hierarchical key invalidation |
| 寫入 + optimistic update / cache invalidation | `useMutation`（Pinia Colada） | onMutate/onSettled hooks + queryCache.invalidateQueries |

**每個新的 data-fetching 呼叫都 MUST 對照此表選用**，不憑慣性。已安裝 Pinia Colada 的 consumer，新 query 預設走 `useQuery`；未安裝的 consumer，`useFetch` 是預設。

## Hard Rules

### HR-1 禁止 setup top-level 裸 $fetch

**每個** `.vue` 檔案的 `<script setup>` 區塊，**NEVER** 在 top-level 用 `$fetch` 取初始資料。

- ❌ `const data = await $fetch('/api/items')` — double fetch + hydration mismatch
- ✅ `const { data } = useFetch('/api/items')` — SSR payload hydration
- ✅ `const { data } = useQuery({ key: ['items'], query: () => $fetch('/api/items') })` — Colada cache
- ✅ event handler 內的 `$fetch` 不受此限（`@click="() => $fetch('/api/action', { method: 'POST' })""`）

### HR-2 高頻觸發 endpoint MUST 處理重複請求

`dedupe: 'defer'` 只在「**同一個 key** 有 in-flight request」時生效（`nuxtApp._asyncDataPromises[key]`），key 一變就走不到。

| 場景 | 正解 | 理由 |
| --- | --- | --- |
| 每次觸發都要**最新**結果（搜尋框、篩選、分頁） | **維持預設 `'cancel'`** | 取消舊請求發新的正是要的語意 |
| 同一 key 的**冪等**重複觸發（連點同一個 refresh 按鈕、多元件共用同 key 同時掛載） | `dedupe: 'defer'` | 回傳既有 promise，不重複打 |
| key 會隨輸入變動的 query | **`defer` 無效**，改用 debounce | 每次 key 不同 → `_asyncDataPromises[key]` 不存在 → 該分支永遠不執行 |
| Pinia Colada `useQuery` | 同 key 自動 dedup（內建） | UI 端按鈕**仍 MUST** 綁 `isLoading` / `asyncStatus === 'loading'` 做 disable |

**NEVER 對搜尋框加 `dedupe: 'defer'`**——它會回傳**舊關鍵字**的 promise。**`dedupe` 用量為 0 不構成違規**，稽核時 MUST 逐個 call site 對照上表。真正該防的是**請求放大**：無 debounce 的輸入框、迴圈內逐筆 await 的 N+1、in-flight 不 abort 的舊請求（取消要省頻寬需 HR-6）。

### HR-3 reference data MUST 有 cache 策略

下拉選單選項、category 列表、config、user profile 等**讀完很少變的資料**：

- Pinia Colada：`staleTime` MUST ≥ 30 秒（推薦用 `STALE_TIME.STABLE` = 5 分鐘）
- useFetch：`getCachedData` 搭配 `nuxtApp.payload.data[key]` 或 `nuxtApp.static.data[key]`

Cookbook 範本：`~/offline/clade/vendor/snippets/nuxt-data-perf/stale-time.ts`

### HR-4 Pinia Colada key MUST 用 factory pattern

**每個** `useQuery` / `useMutation` 的 key **MUST** 來自集中定義的 key factory，**NEVER** 用 magic string。

- ❌ `key: ['products']` 散落在 component 各處
- ✅ `key: productKeys.list(filters)` 來自 `queries/products.ts`

Key factory pattern：

```ts
export const productKeys = {
  all: ['products'] as const,
  list: (filters?) => [...productKeys.all, 'list', filters ?? {}] as const,
  detail: (id: MaybeRefOrGetter<string>) => [...productKeys.all, 'detail', toValue(id)] as const,
}
```

Cookbook 範本：`~/offline/clade/vendor/snippets/nuxt-data-perf/query-keys.ts`

### HR-5 useMutation MUST 接 cache invalidation

**每個** `useMutation` 的 `onSettled`（或 `onSuccess`）hook **MUST** 呼叫 `queryCache.invalidateQueries`，精準 invalidate 受影響的 query key。

- ❌ mutation 後手動 `refetch()` — 只 refresh 當前 component，其他讀同 key 的 component 不會更新
- ✅ `onSettled: () => queryCache.invalidateQueries({ key: domainKeys.all })` — 全域 cache 一致

### HR-6 取消訊號 MUST 貫通到 HTTP client

**每一個** query function / data-fetching handler 都 MUST 接住框架給的 `signal` 並傳進 HTTP client 的請求選項——**每一個**，不是只處理慢的或大 payload 的那幾個 endpoint。

- ❌ `useQuery({ key: reportKeys.daily(), query: () => $fetch('/api/report/daily') })`
- ✅ `useQuery({ key: reportKeys.daily(), query: ({ signal }) => $fetch('/api/report/daily', { signal }) })`
- ✅ `useAsyncData('report', (_app, { signal }) => $fetch('/api/report', { signal }))`

**取消是預設行為，沒接 signal 就是空包彈**：Colada 每次 `fetch()` 與元件卸載 / key 變更時都無條件 abort，Nuxt `useAsyncData` 預設 `dedupe: 'cancel'`；signal 沒傳進 `$fetch`，瀏覽器照樣下載完整 response。**NEVER** 把「已經用了 Colada / 已經是預設 `'cancel'`」讀成「頻寬已經省下來了」。

**共用 HTTP client 的 request interceptor NEVER 覆寫已存在的 `signal`**——MUST 用 `AbortSignal.any([...])` 合併或跳過注入。

- ❌ `$fetch.create({ onRequest({ options }) { options.signal = mine.signal } })`
- ✅ `options.signal = options.signal ? AbortSignal.any([options.signal, mine.signal]) : mine.signal`

**新增全域 abort manager 模組**前，MUST 在 PR 描述寫出框架內建機制不涵蓋該場景的 predicate；列不出即 NEVER 新增。

Cookbook 範本：`~/offline/clade/vendor/snippets/nuxt-data-perf/colada-query-signal.ts`

### HR-7 NEVER 用取消當寫入的重複提交防護

**每一個**非冪等寫入（POST / PUT / PATCH / DELETE、`useMutation`）**NEVER** 用 abort / cancel 當重複提交防護。取消砍掉的是**前端的等待**，server 可能已經執行完寫入——使用者看到「沒送出」，帳已經入了。

防重三選一：server 依 idempotency key 去重、按鈕 `disabled` 綁 `isLoading` / `asyncStatus === 'loading'`（HR-2 已要求）、server-side dedup。

- ❌ `handleSubmit() { abortKey('form/submit'); submitForm() }`
- ❌ 提交前先 `cancelQueries` / `mutationCache.cancel` 當防重
- ✅ 按鈕 disabled ＋ 寫入帶 idempotency key

Colada 的 `useMutation` 刻意不建 `AbortController`、不自動取消，**NEVER** 自己補上。

### HR-8 拿掉 composable 的 `await` MUST 同時保住呼叫端的渲染時序

`useFetch` **MUST** 在任何 `await` 之前呼叫完（vite-doctor `NUXT0020`）。但呼叫端的 `await useX()` 同時綁著「資料到齊才渲染」；直接拿掉 `async` / `await` 會靜默拆掉時序，症狀是**頁面缺一塊**（`status` 仍 `pending`，資料與「尚無資料」都不出現）。

**MUST** 兩件事分開處理——`useFetch` 全部前置，「資料到齊」用一個 promise 交回呼叫端：

```ts
export function useMasterCatalog() {
  const itemsFetch = useFetch("/api/v1/items");
  const suppliersFetch = useFetch("/api/v1/suppliers");
  const ready = Promise.all([itemsFetch, suppliersFetch]);  // AsyncData 本身是 thenable
  return { ready, items, suppliers, isEmpty };
}
// 呼叫端：const { ready, items } = useMasterCatalog(); await ready;
```

**MUST** 改 composable 的 async 簽章前先 `rg -n 'await use[A-Z][A-Za-z]*\(\)' app/` 查呼叫端；**NEVER** 只憑 typecheck ＋ doctor 綠判定修好（只有空白 / loading 狀態的驗收測試抓得到）。診斷時 **NEVER 截斷擷取到的 body text**——截斷後只看得到 nav。

> Pitfall：`docs/pitfalls/2026-09-07-usefetch-after-await-fix-changes-render-timing.md`

### HR-9 CSRF-aware fetch MUST 走 library 官方入口，NEVER 覆寫 `globalThis.$fetch`

SFC 裡的 `$fetch` 是 `#build/fetch.mjs` 在 import 當下凍結的 `globalThis.$fetch` reference（早於所有 plugin），`useFetch` 也用它。所以「寫一支 plugin 統一掛 CSRF header」是**完全的 no-op，且沒有任何錯誤訊息**：

- ❌ `defineNuxtPlugin(() => { globalThis.$fetch = ofetch.create({ ... }) })`

兩條有效路徑，依「要不要動每一個呼叫點」選：

| 做法 | 代價 | 適用 |
| --- | --- | --- |
| **A**：`app:templates` hook 覆寫 `fetch.mjs` template，讓被 export 的 const 在 `create()` 當下就掛好 interceptor | 整份覆寫、與 Nuxt 版本耦合——升版 MUST 比對上游 `dollarFetchTemplate` 的 import / `baseURL` / export 形狀，並用單元測試執行產出的字串驗行為 | 既有呼叫點多、不想逐一改 |
| **B**：`export function useApi() { return useNuxtApp().$csrfFetch }`，呼叫端 setup 頂層 `const api = useApi()`，之後一律 `api(...)` | 呼叫點要逐一改，且需要下方的掃描測試擋住「未來忘記用」 | 呼叫點少、不想與 Nuxt 內部 template 耦合 |

走 A：method 可能只在 Request 物件上（只看 `options.method` 會漏附 token）；**same-origin MUST 用 `new URL()` 正規化後比 origin**，NEVER 用字串前綴判斷（反斜線路徑會被誤判 same-origin，把 token 送去外站）。

走 B：**MUST 用掃描測試而非 lint** 擋未來忘記用（oxlint `no-restricted-globals` 對 `<script setup>` 不命中），掃 `app/**/*.{vue,ts}` 的 `/(?<![\w$.])\$fetch\s*[<(]/`。

只在 production build 才炸的兩點：`nuxt-csurf` 在 production 改用 `__Host-csrf` + `secure: true`（`http://ip:port` 直連全 403；測試 harness MUST 同時接受 `csrf=` 與 `__Host-csrf=`）；`encryptSecret` 未設時每次 build 隨機——固定 `NUXT_CSURF_ENCRYPT_SECRET`，或在 `onResponseError` 攔 403 `EBADCSRFTOKEN` → reload。`ssr: false` 不影響 CSRF，但 `nuxt generate` / prerender 的靜態 shell 會讓它失效。

> Pitfall：`docs/pitfalls/2026-09-07-nuxt-global-fetch-override-is-a-noop.md`

## Should Rules（非 hard，但稽核會標）

### SR-1 大 payload SHOULD 用 pick/transform

API 回傳欄位 > 5 個但 UI 只用 2-3 個 → useFetch 加 `pick: ['field1', 'field2']` 或 `transform`。減少 SSR payload 體積 + hydration 成本。

### SR-2 Lazy prefix 限非首屏重元件，且 MUST 搭 hydration strategy

`<Lazy*>` 只做 **code-split**。不搭 hydration strategy 的 `<Lazy*>` **完全不省 hydration 成本**，只多出一個 async chunk。

**`ssr: false`（SPA）的 consumer：hydration strategy 完全不生效**，只適用條件 ①，**NEVER** 為了「補 strategy」而加 `hydrate-on-*`。

| 條件 | 判準 | 適用 |
| --- | --- | --- |
| ① 非首屏或條件渲染 | Modal、chart、editor、map、below-fold 區塊。**NEVER** 用於首屏就會渲染的輕量原子元件（`UButton` / `UBadge` / `UIcon` / `UFormField` / `UInput` / `USeparator` / `UTooltip` / `USkeleton` 等） | **全部 consumer** |
| ② 帶 hydration strategy | `hydrate-on-visible` / `hydrate-on-idle` / `hydrate-on-interaction` / `hydrate-on-media-query` / `:hydrate-after` / `:hydrate-when` / `hydrate-never` | **僅 `ssr: true`** |

```vue
<!-- ❌ 首屏原子元件：多一個 chunk，零 hydration 收益 -->
<LazyUBadge :label="status" />
<LazyUSkeleton v-if="pending" />   <!-- 本末倒置：loading 指示器自己要等 chunk 下載 -->

<!-- ❌ 重元件但無 strategy：只拿到 code-split -->
<LazyRevenueChart :data="rows" />

<!-- ✅ 重元件 + 進視窗才 hydrate -->
<LazyRevenueChart :data="rows" hydrate-on-visible />
<!-- ✅ 互動才 hydrate -->
<LazyRichTextEditor hydrate-on-interaction="click" />
<!-- ✅ 純展示、永不互動 -->
<LazyStaticReport hydrate-never />
```

**三個會讓 strategy 靜默失效的限制**：

1. **任何 prop 變更會立即觸發 hydration**，繞過設定的 strategy——綁頻繁變動 prop 的元件等於沒設
2. 僅在 **SFC** 內有效，且 prop **MUST 直接寫在 template 上**；`v-bind="props"` 展開物件不生效
3. 從 `#components` 直接 import 的元件不適用

Enforcement：`lazy-atomic-component`（ratchet）＋ review 層 `lazy-hydration-strategy` verdict。

### SR-3 landing page / public page SHOULD 有 routeRules

```ts
// nuxt.config.ts
routeRules: {
  '/': { prerender: true },
  '/login': { prerender: true },
  '/blog/**': { prerender: true },  // content-driven
}
```

### SR-4 平行獨立 request SHOULD 用 Promise.all

同一 handler / setup 內多個獨立 fetch → 包在 `useAsyncData` + `Promise.all` 內平行發送。

### SR-5 NuxtImg SHOULD 設 format + loading + priority + sizes

- LCP hero image：`loading="eager"` + `:preload="{ fetchPriority: 'high' }"` + `format="webp"`
- Below-fold image：`loading="lazy"` + `fetchpriority="low"` + `format="webp"`
- **響應式圖片 MUST 設 `sizes`**：沒有 `sizes`，`@nuxt/image` 無從產生 `srcset` 候選，行動裝置會下載桌機尺寸的原圖。`sizes="sm:100vw md:50vw lg:400px"`

> 部署在 Cloudflare Workers 的 consumer 另需確認 `image.provider` 有正確解析——preset 選錯會讓 provider 退化成 `none`，`<NuxtImg>` 等同裸 `<img>`，所有優化設定靜默失效。

### SR-9 取消事件 MUST 與錯誤分流，且 MUST 留下訊號

**每一處**錯誤處理（`catch` / interceptor / error-reporting hook）MUST 把取消（`err.name === 'AbortError'`）從錯誤中分流，**NEVER** 上報成 error（灌水 error rate）；也 **NEVER** 整個吞掉——MUST 留計數 metric 或 debug log，否則誤砍永遠不可見。

## Server 端與資源層

### SR-6 Nitro 快取 MUST 先過認證邊界

`defineCachedEventHandler` / `cachedEventHandler` / `defineCachedFunction` 是**安全敏感**設定，不是單純效能開關。

Nitro 快取回應時會丟掉 request headers——對帶認證的 endpoint 套用 = **跨使用者資料外洩**。

**每一個**快取 handler 都 MUST 逐條確認：

| 檢查 | 不通過時 |
| --- | --- |
| 回應內容與呼叫者身分**完全無關**？ | 不無關就**不要快取**；真要快取則 `getKey()` MUST 把使用者識別納入快取鍵 |
| 需要保留的 header 有列進 `varies`？ | 未列的 header 在快取回應中會消失 |
| 部署在 Cloudflare Workers / edge？ | Nitro production 預設 **memory storage**，在 Workers 上不跨 isolate 持久＝快取實質未生效；MUST 顯式設 `storage.cache` driver（如 `cloudflare-kv-binding`） |

有疑慮一律不快取——效能收益遠小於資料外洩成本。

### SR-7 字型宣告 MUST 單一來源且明列 weight

`@fontsource/<name>` 的 bare import **只載入 weight 400**；用了其他字重卻沒載，瀏覽器合成粗體（CJK 筆畫糊化）。

```css
/* ❌ 只給 weight 400，其餘字重全部退化成合成粗體 */
@import '@fontsource/noto-sans-tc';

/* ✅ 明列實際用到的 weight */
@import '@fontsource/noto-sans-tc/400.css';
@import '@fontsource/noto-sans-tc/500.css';
@import '@fontsource/noto-sans-tc/700.css';

/* ✅ 可變字型單檔涵蓋全 weight，bare import 正確 */
@import '@fontsource-variable/geist';
```

**NEVER 雙重宣告**：`nuxt.config` 的 `fonts.families` 與 CSS `@import` 同時宣告同一字型 = 兩套 `@font-face` 疊加。擇一即可。

Enforcement：機械層 `fontsource-bare-import`（error）擋單行 bare import；跨檔雙重宣告由 review 層判斷。

### SR-8 routeRules 依渲染需求選模式

`prerender` 只是其中一種。**每一條** public route 都 MUST 對照下表選：

| 內容性質 | 用什麼 |
| --- | --- |
| build 時即固定（landing / login / 靜態文件） | `prerender: true` |
| 內容會變但可接受短暫過期（部落格 / 商品頁） | `isr: <秒>` |
| 需要背景更新、先回舊值 | `swr: <秒>` |
| API 回應可共用 | `cache: { maxAge: <秒> }` — **先過 SR-6 認證邊界** |
| 需要即時且因人而異 | 不設 route rule |

> **`experimental.payloadExtraction` 不需要手動開**：Nuxt 4 預設即為 `true`（`compatibilityVersion: 5` 時為 `'client'`），且 **`ssr: false` 時強制為 `false`**。SPA consumer 設它無效，**NEVER** 把「未設定」當成缺口。

## Pinia Colada 層（已安裝 consumer 適用）

### staleTime 三級制

所有 Colada consumer **SHOULD** 採用集中的 `STALE_TIME` 常數：

| Tier | 值 | 適用 |
|------|-----|------|
| REALTIME | 0 ms | 即時資料：dashboard、pending approvals、clock |
| SHORT | 30 s | 工作階段內會變的資料：list、reports、search |
| STABLE | 5 min | Reference/master data：settings、categories、types |

Cookbook 範本：`~/offline/clade/vendor/snippets/nuxt-data-perf/stale-time.ts`

### Query 檔案組織

推薦 `queries/<domain>.ts` 一個 domain 一個檔，內含：
1. Key factory（`domainKeys`）
2. `useQuery` composable（讀）
3. `useMutation` composable（寫 + invalidation）

Cookbook 範本：`~/offline/clade/vendor/snippets/nuxt-data-perf/query-file-example.ts`

## Mechanical Enforcement（4 層）

四層 enforcement（同 [[nuxt-ui-native-picker-ban]] 架構）：

| 層 | scope | 何時跑 | 偵測項 | 行為 |
| --- | --- | --- | --- | --- |
| **impl-time rule** | 當次 session 寫的 `.vue` | 寫 code 當下 | 下方 § Self-check Gate 的全部項目 | agent 自查 |
| **pre-commit gate** | staged `.vue` | `git commit` | file-level：有 `$fetch` 但無 `use(Lazy)?(Fetch\|AsyncData)`/`useQuery`（HR-1） | **blocking** |
| **pre-push gate** | **全 repo** `.vue` | `git push` | 同上，回溯型 | **warn-only**（既有 codebase 違規量大，暫不阻擋） |
| **review 層** | PR diff | code-review agent / `/commit` 0-A | 全部 HR 語意 check ＋ `lazy-hydration-strategy` / `nitro-cache-auth-safety` verdict | agent review |

資源層另有兩條機械 pattern（走 `vendor/review-rules/patterns.json`，pre-commit / pre-push / CI 三層）：

| pattern id | 對應 | severity | 說明 |
| --- | --- | --- | --- |
| `fontsource-bare-import` | SR-7 | error | 命中量極低，直接 blocking |
| `lazy-atomic-component` | SR-2 | warning + `layer: ratchet` | 既有違規量大，只擋新增；豁免標記 `lazy-atomic-ok` |

偵測 heuristic（file-level）：`.vue` 含 `$fetch` 但**不含** `use(Lazy)?(Fetch|AsyncData)` / `useQuery`。改 regex 時 `use(Lazy)?` 前綴不可省（否則誤判逼人掛全檔豁免，gate 被掏空）。

### 合法例外（file-level ignore）

純 mutation component（只有 POST/PUT/DELETE、無 data-fetching 需求）在檔案內任何位置加 `data-perf-ignore-file` 標記即跳過：

```vue
<!-- data-perf-ignore-file: pure mutation component, no data fetching -->
<script setup>
async function handleSubmit() {
  await $fetch('/api/items', { method: 'POST', body })
}
</script>
```

仍**MUST** 在 commit message 註明位置與理由，讓 review 層核實。

### 規約來源

- **pre-commit gate**：`vendor/scripts/pre-commit/checks/data-perf-check.sh`（掃 staged `.vue`）
- **pre-push gate**：`vendor/scripts/pre-push/checks/data-perf-check.sh`（掃**全 repo** `.vue`，warn-only 回溯型）
- **資源層 pattern**：`vendor/review-rules/patterns.json` 的 `fontsource-bare-import` / `lazy-atomic-component`（由 `vendor/review-rules/scan.mjs` 於 pre-commit / pre-push / CI 三層執行）
- **review-layer**：`capabilities/core/agents/references/clade-review-rules.md` § Nuxt 效能規約

## Self-check Gate（Enforcement Layer 1）

**每次**寫完新的 `useFetch` / `useLazyFetch` / `useAsyncData` / `useLazyAsyncData` / `useQuery` / `$fetch` 呼叫後，**MUST** 暫停並逐條自查：

1. ✅ 這個呼叫在 setup top-level 嗎？→ 不能用裸 `$fetch`（HR-1）
2. ✅ 這個呼叫的 key 會隨輸入 / 篩選變動嗎？→ 會就**維持預設 `'cancel'`** 並用 debounce 控頻；只有「固定 key 的冪等重複觸發」才加 `dedupe: 'defer'`（HR-2）
3. ✅ 這是 reference data（下拉選單、config、category）嗎？→ 需要 `staleTime` 或 `getCachedData`（HR-3）
4. ✅ key 是 magic string 還是來自 factory？→ 必須用 factory（HR-4）
5. ✅ 如果是 mutation，有沒有接 `invalidateQueries`？→ 必須有（HR-5）
6. ✅ query / handler 有接住 `signal` 並傳進 `$fetch` 嗎？→ 沒接的話框架的 abort 全打空（HR-6）；如果是寫入，有沒有拿取消當防重？→ 不可以（HR-7）

發現違反就**立刻修正後再繼續**，不需逐次報告。

### 資源層自查

**每次**新增 `<Lazy*>` 元件、`defineCachedEventHandler` / `defineCachedFunction`、或字型 `@import` 後，**MUST** 暫停並逐條自查：

1. ✅ 這個 `<Lazy*>` 是首屏就渲染的輕量元件嗎？→ 移除 `Lazy` 前綴（SR-2 ①，全部 consumer 適用）
2. ✅ 本專案 `ssr: true` 嗎？→ 是才檢查有無 hydration strategy（SR-2 ②）；`ssr: false` 跳過此項，**NEVER** 補無效的 `hydrate-on-*`
3. ✅ 這個快取 handler 的回應與呼叫者身分無關嗎？→ 有關就不能快取，或 `getKey()` 納入使用者識別（SR-6）
4. ✅ 部署目標是 Workers / edge 嗎？→ MUST 顯式設 `storage.cache` driver（SR-6）
5. ✅ 這個字型 `@import` 有明列 weight subpath 嗎？→ static 字型 bare import 只給 400（SR-7）

## 與其他 rule 的分工

| 主題 | 走哪個 |
|------|--------|
| D1 / Drizzle / wrangler / NuxtHub binding | `data-layer-d1.md` |
| useFetch / useQuery / $fetch 選用 / dedupe / cache / payload | 本 rule |
| Nuxt UI component props / theming | nuxt-ui-remote MCP 與專案的 Nuxt UI 查詢規約 |
| CSS / Web Platform API（dialog / popover / anchor） | 專案的瀏覽器支援政策與 Web Platform 官方文件 |
| Error handling pattern（server/client） | `error-handling.md` |
