---
description: Nuxt data fetching 選用決策、Pinia Colada 最佳實踐、dedupe/cache/payload 效能規約；涵蓋 useFetch / useAsyncData / $fetch / useQuery / useMutation 全棧
paths: ['**/*.vue', '**/*.ts', 'nuxt.config.*', 'app.config.*', 'composables/**', 'queries/**', 'stores/**']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/nuxt-data-perf.md
Edit at: <clade-central-repo>
Local edits will be reverted by the next sync.
-->


# Nuxt Data Fetching & Performance

> Cookbook 範本：`~/offline/clade/vendor/snippets/nuxt-data-perf/`
>
> 稽核 skill：`/nuxt-data-audit`（14 項 checklist 自動掃描）

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

### HR-2 高頻觸發 endpoint MUST 有 dedupe

**每個**會被 button click / form submit / polling / watch 快速連續觸發的 fetch 呼叫：

- useFetch：加 `dedupe: 'defer'`（保留 pending request，不發新的）
- Pinia Colada useQuery：同 key 自動 dedup（內建），但 UI 端按鈕**仍 MUST** 綁 `isPending` / `asyncStatus === 'loading'` 做 disable
- useFetch `refresh()` 呼叫：傳 `{ dedupe: 'defer' }` 選項

`dedupe: 'cancel'`（預設）適用於搜尋框即時搜尋（每次 keystroke 只要最新結果）。其他場景預設用 `'defer'`。

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

## Should Rules（非 hard，但稽核會標）

### SR-1 大 payload SHOULD 用 pick/transform

API 回傳欄位 > 5 個但 UI 只用 2-3 個 → useFetch 加 `pick: ['field1', 'field2']` 或 `transform`。減少 SSR payload 體積 + hydration 成本。

### SR-2 非首屏 heavy component SHOULD 用 Lazy prefix

Modal、chart、editor、below-fold 區塊 → `<LazyHeavyChart />` 做 code-split。搭配 `hydrate-on-visible` / `hydrate-on-interaction` 做 lazy hydration。

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

### SR-5 NuxtImg SHOULD 設 format + loading + priority

- LCP hero image：`loading="eager"` + `:preload="{ fetchPriority: 'high' }"` + `format="webp"`
- Below-fold image：`loading="lazy"` + `fetchpriority="low"` + `format="webp"`

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

此規約有**四層** enforcement，對齊 [[nuxt-ui-native-picker-ban]] 同一架構：

| 層 | scope | 何時跑 | 偵測項 | 行為 |
| --- | --- | --- | --- | --- |
| **impl-time rule** | 當次 session 寫的 `.vue`（path-scoped 自動 load） | 寫 code 當下 | Self-check Gate 5 項（下方 § Self-check Gate） | agent 自查 |
| **pre-commit gate** | staged `.vue` | `git commit` | file-level：有 `$fetch` 但無 `useFetch`/`useQuery`/`useAsyncData`（HR-1） | **blocking** |
| **pre-push gate** | **全 repo** `.vue` | `git push` | 同上，回溯型 | **warn-only**（既有 codebase 違規量大，暫不阻擋） |
| **review 層** | PR diff | code-review agent / `/commit` 0-A | 全 5 條 HR 語意 check | agent review |

偵測 heuristic（file-level）：`.vue` 檔含 `$fetch` 但**不含** `useFetch` / `useQuery` / `useAsyncData` → 代表所有 data-fetching 都走 raw `$fetch`。含 composable 的 `.vue` 檔有 `$fetch` 不被標記（通常是 event handler mutation）。

> **為何 pre-push 是 warn-only**：既有 Nuxt consumer（如 <consumer-b>）通常有 30-50 個 `.vue` 檔只用 `$fetch`。全部阻擋會讓 push 完全停擺。等主要 consumer 逐步遷移到 composable 後 promote 為 blocking。

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
- **review-layer**：`plugins/hub-core/agents/references/clade-review-rules.md`

## Self-check Gate（Enforcement Layer 1）

**每次**寫完新的 `useFetch` / `useQuery` / `useAsyncData` / `$fetch` 呼叫後，**MUST** 暫停並逐條自查：

1. ✅ 這個呼叫在 setup top-level 嗎？→ 不能用裸 `$fetch`（HR-1）
2. ✅ 這個呼叫會被按鈕 / 表單 / polling 快速連續觸發嗎？→ 需要 `dedupe: 'defer'`（HR-2）
3. ✅ 這是 reference data（下拉選單、config、category）嗎？→ 需要 `staleTime` 或 `getCachedData`（HR-3）
4. ✅ key 是 magic string 還是來自 factory？→ 必須用 factory（HR-4）
5. ✅ 如果是 mutation，有沒有接 `invalidateQueries`？→ 必須有（HR-5）

**不需要逐次跟 user 報告自查結果**，但如果發現自己剛寫的 code 違反任何一條，**立刻修正後再繼續**。

## 為什麼這條 rule 存在

2026-06-23 跨 8 consumer 稽核發現：
- `dedupe` 全 fleet = 0（MasteringNuxt tip 指出的盲區）
- `getCachedData` 全 fleet = 0
- 未安裝 Colada 的 consumer（rental-scout / co-purchase / blog）全面 D 級
- 已安裝 Colada 的 consumer（<consumer-a> / <consumer-b> / sroi / agentic-rag）全部 B+ 以上，但 key management 和 dedupe 仍有缺口
- <consumer-a> 的 pattern（STALE_TIME 三級 + key factory + 100% mutation invalidation）是 gold standard，需推廣

## 與其他 rule 的分工

| 主題 | 走哪個 |
|------|--------|
| D1 / Drizzle / wrangler / NuxtHub binding | `data-layer-d1.md` |
| useFetch / useQuery / $fetch 選用 / dedupe / cache / payload | 本 rule |
| Nuxt UI component props / theming | nuxt-ui-remote MCP（見 `~/.claude/rules/nuxt-ui-mcp.md`） |
| CSS / Web Platform API（dialog / popover / anchor） | modern-web-guidance skill（見 `~/.claude/rules/modern-web-mcp.md`） |
| Error handling pattern（server/client） | `error-handling.md` |
