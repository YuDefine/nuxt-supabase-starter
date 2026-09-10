---
name: nuxt-data-audit
description: >-
  Use when 審計 Nuxt 專案 data-fetching 模式與效能 golden path checklist。NOT for 非 Nuxt
  專案，NOT for client-server 分頁參數不一致的偵測（走 data-sanity）。
metadata:
  author: clade
  version: '1.0'
  clade:
    permission_tier: read-only
effort: medium
---


本流程只稽核與回報。`metadata.clade.permission_tier` 是政策標記，不是原生權限控制；修正依本次任務既有授權處理。

`nuxt-data-audit` — Nuxt data-fetching & performance golden path audit。這是 skill 的檢查流程，沒有同名獨立 CLI；下方參數由執行 skill 的 agent 解讀。原生入口未載入時，讀取本文件與 reference rule 後依已授權工具執行。

開始評分前讀取 reference rule：clade 的 `rules/core/nuxt-data-perf.md`，或目前 runtime 已交付的同名規約。若無法取得該規約，報告標示未完成。
Cookbook：`~/offline/clade/vendor/snippets/nuxt-data-perf/`

## 何時跑

- **定期稽核**：跨 consumer fleet 完善度掃描（從 clade home 跑，指定 consumer path）
- **新功能完成後**：對 consumer 當前 codebase 的 data-fetching 品質做 baseline check
- **code-review 輔助**：reviewer 可跑此 skill 取得量化數據輔助 review
- **新 consumer onboard**：day-1 baseline 建立

## 怎麼跑

```
/nuxt-data-audit                          # 掃當前 cwd 的 consumer
/nuxt-data-audit ~/offline/<consumer-b>           # 掃指定 consumer
/nuxt-data-audit --fleet                  # 掃全 fleet（從 clade home 用 registry/consumers.json）
```

## Phase 1 — Dependency Detection

判斷 consumer 的 data-fetching stack：

```bash
# 檢查 package.json
grep -E '@pinia/colada|@pinia/colada-nuxt|@pinia/nuxt' package.json
```

分為兩類：
- **Colada consumer**：安裝了 @pinia/colada → 全部 checklist 適用
- **Non-Colada consumer**：未安裝 → E9/E10 標 N/A，其餘全部適用

## Phase 2 — 候選掃描與逐項查核

以下文字搜尋只產生候選；程式探索先使用當前可用的 codebase graph 工具，shell 搜尋依 repository 規約補充。逐筆讀取實際呼叫與資料路徑後評分。零命中、檔案數或函式名稱數量不等於行為已驗證。

每列保留適用範圍、檔案／呼叫位置與判定證據。沒有適用對象記 N/A 並說明已查範圍；尚未讀完呼叫鏈或缺執行證據記 unknown。這兩種狀態都不算 pass。

### E1 — setup 無裸 $fetch（HR-1）

```bash
# 找 .vue 檔中 <script setup> 的 $fetch（排除 event handler）
# 注意 $csrfFetch 等 alias 也要查
find . -name '*.vue' -not -path '*/node_modules/*' -not -path '*/.nuxt/*' -not -path '*/test/*' \
  | xargs grep -l '\$fetch\|\$csrfFetch'
```

**對每個命中檔案**：追查初始資料載入的實際呼叫路徑，包括 setup 呼叫的 helper／alias。函式包裝本身不提供 SSR payload 保護。

**判定**：
- pass：初始資料由 useFetch／useAsyncData／useQuery 等適用機制承接，其他 $fetch 只由事件等非初始載入入口觸發。
- fail：setup 初始載入直接或經 helper 呼叫裸 $fetch。

### E2 — useFetch 有適當 key（HR-4 useFetch 部分）

```bash
grep -rn 'useFetch\|useAsyncData' --include='*.ts' --include='*.vue' \
  | grep -v node_modules | grep -v .nuxt | grep -v test/
```

**判定**：custom composable（`composables/*.ts` / `queries/*.ts`）內的 useFetch 是否手動指定 key。Page/component 內的 useFetch 自動生成 key 通常 OK。

### E3 — 重複請求處理正確（HR-2）

```bash
# 找所有 useFetch 呼叫
grep -rn 'useFetch\|\.refresh(' --include='*.vue' --include='*.ts' \
  | grep -v node_modules | grep -v .nuxt
# 檢查有沒有 dedupe
grep -rn "dedupe" --include='*.vue' --include='*.ts' \
  | grep -v node_modules | grep -v .nuxt
```

**判定**（**NEVER** 把「0 處 dedupe」直接判 fail——預設 `'cancel'` 對「只要最新結果」的場景本來就是正解）：

| 觀察到的情形 | 評分 |
| --- | --- |
| 搜尋框 / 篩選器被加了 `dedupe: 'defer'` | **fail**（引入 bug：回傳舊關鍵字的 promise） |
| key 隨輸入變動的 query 加了 `'defer'` | **fail**（無效程式碼：該分支永遠走不到） |
| 輸入框觸發 fetch 但無 debounce，且舊請求不 abort | **fail**（請求放大） |
| 同一 key 的冪等重複觸發（連點 refresh）未處理 | partial |
| 全部維持預設 `'cancel'`，且無請求放大 | **pass** |

`defer` 只在「同一個 key 有 in-flight request」時生效，逐個 call site 對照 [[nuxt-data-perf]] HR-2 判斷。

### E4 — Reference data 有 cache 策略（HR-3）

```bash
# Colada consumer：檢查 staleTime 使用率
grep -rn 'staleTime' --include='*.ts' --include='*.vue' | grep -v node_modules | grep -v .nuxt
# Non-Colada：檢查 getCachedData
grep -rn 'getCachedData' --include='*.ts' --include='*.vue' | grep -v node_modules | grep -v .nuxt
```

**判定**：先列出 HR-3 所指的低變動 reference data，再追查每個呼叫的有效 cache 設定（含共用 defaults）。全部符合 HR-3 = pass；任一適用呼叫不符 = fail。一般即時 query 不放入此項分母。

### E5 — 大 payload 有 pick/transform（SR-1）

```bash
grep -rn 'pick:\|transform:' --include='*.ts' --include='*.vue' \
  | grep -v node_modules | grep -v .nuxt | grep -v test/ | grep -v nuxt.config | grep -v vite.config
```

**判定**：先對照大 payload 的實際回應與使用欄位。已在 server 選欄位，或 client pick／transform 已縮到需求範圍 = pass；確認傳輸／SSR payload 有不必要的大量資料 = fail。只有函式名稱，沒有 payload 或欄位證據 = unknown。

### E6 — Lazy 元件用對地方且有 hydration strategy（SR-2）

```bash
# 總量
grep -rn '<Lazy' --include='*.vue' | grep -v node_modules | grep -v .nuxt
# 原子元件濫用（首屏輕量元件，淨負面）
grep -roE '<Lazy(UButton|UBadge|UIcon|USeparator|USkeleton|UFormField|UInput|UTextarea|UAlert|UTooltip|UKbd|UAvatar|UChip)\b' \
  --include='*.vue' . | grep -v node_modules | grep -v .nuxt | wc -l
# hydration strategy 採用
grep -roE 'hydrate-on-(visible|idle|interaction|media-query)|hydrate-(after|when|never)' \
  --include='*.vue' . | grep -v node_modules | grep -v .nuxt | wc -l
```

**判定**（**NEVER** 用「Lazy 用得多 = 好」評分——`<Lazy*>` 只做 code-split，不搭 strategy 完全不省 hydration）：

依 SR-2 逐個判斷首屏原子元件、非首屏重元件與實際 hydration 路徑。確認有 Lazy 原子元件濫用，或適用的非首屏重元件缺策略／策略失效 = fail；所有適用元件符合規約 = pass。沒有延遲載入需求時記 N/A；strategy 數為零本身不構成 fail。SPA 的 code splitting 與 SSR hydration 分開評估。

### E7 — routeRules 有 performance 設定（SR-3）

```bash
grep -A20 'routeRules' nuxt.config.ts | grep -E 'prerender|swr|isr|ssr:\s*false'
```

**判定**：逐條檢查 public／landing routes 是否依內容更新需求採用 SR-3 策略，並核對部署支援。只有私人／個人化 routes 時，此項 N/A；不能為取得 pass 而對私人資料加共享快取。

### E8 — NuxtImg 最佳化（SR-5）

```bash
grep -rn '<NuxtImg\|<nuxt-img' --include='*.vue' | grep -v node_modules | grep -v .nuxt
# 檢查有沒有 format/loading/priority
grep -rn 'format=.*webp\|loading=.*lazy\|fetchpriority\|:preload=' --include='*.vue' | grep -v node_modules
```

**判定**：@nuxt/image 已安裝 + NuxtImg 有 format/loading → pass。裝了但沒 optimize → partial。沒裝 → N/A（不強制）。

### E9 — Colada key factory（HR-4，Colada only）

```bash
# Key factory pattern
grep -rn 'Keys\s*=\|KEYS\.\|queryKeys\|defineQueryOptions' --include='*.ts' | grep -v node_modules | grep -v .nuxt
# Magic string keys
grep -rn "key:\s*\['" --include='*.ts' --include='*.vue' | grep -v node_modules | grep -v .nuxt | grep -v test/
```

**判定**：逐個追查 useQuery／useMutation 的實際 key 來源，包含封裝與共用 defaults。全部適用 key 來自集中 factory = pass；任一散落 magic string key = fail。factory 定義數量不代表呼叫端採用率。

### E10 — useMutation 有 cache invalidation（HR-5，Colada only）

```bash
mutation_files=$(grep -rl 'useMutation' --include='*.ts' --include='*.vue' | grep -v node_modules | grep -v .nuxt | grep -v test/)
invalidate_files=$(grep -rl 'invalidateQueries' --include='*.ts' --include='*.vue' | grep -v node_modules | grep -v .nuxt | grep -v test/)
```

**判定**：逐個 mutation 追查 onSuccess／onSettled（含共用封裝），確認 invalidateQueries 的 key 涵蓋受影響 query。全部符合 HR-5 = pass；任一缺失或 key 錯誤 = fail。同檔存在 invalidateQueries 不代表該 mutation 已接上。

### E11 — 無跨 request state 污染

```bash
grep -rn 'export const.*= ref(\|export const.*= reactive(' --include='*.ts' \
  | grep -v node_modules | grep -v .nuxt | grep -v test/ | grep -v defineStore
```

**判定**：追查 server 可達的 module-scope 可變 state 與 request 隔離。確認跨 request 共用使用者資料 = fail；完成適用路徑查核且 state 隔離 = pass。SSR 不可達的 client-only state 不據此判污染；零搜尋命中但未完成查核 = unknown。

### E12 — Error handling 完整

對 useFetch/useQuery 呼叫：檢查 `error` ref 是否被 template 消費（`v-if="error"`、`{{ error }}`）或 watch。

**判定**：> 50% 有 error 消費 = pass。< 50% = partial。0 = fail。

### E13 — 平行 request 用 Promise.all

```bash
grep -rn 'Promise.all' --include='*.ts' --include='*.vue' | grep -v node_modules | grep -v .nuxt
```

**判定**：advisory，有就加分。

### E14 — watch/immediate 合理

```bash
grep -rn 'immediate:\s*false\|watch:\s*\[' --include='*.ts' --include='*.vue' \
  | grep -v node_modules | grep -v .nuxt | grep -v test/
```

**判定**：逐個呼叫對照觸發需求，包含預設 watch／immediate、reactive key 與顯式 refresh。行為符合需求 = pass；確認漏載或多次觸發 = fail。維持預設值本身不扣分。

### E15 — Nitro 快取有過認證邊界（SR-6）

```bash
grep -rn 'defineCachedEventHandler\|cachedEventHandler\|defineCachedFunction' \
  --include='*.ts' server/ | grep -v node_modules
# 對每個命中：檢查同檔有無 auth 取用
grep -n 'getUser\|requireAuth\|serverSupabaseUser\|event.context.user\|getKey' <命中檔>
# 部署目標與 cache driver
grep -n 'preset\|storage' nuxt.config.ts | grep -iE 'cloudflare|storage'
```

**判定**（**安全項，優先於效能**）：

- fail：有快取 handler 且該 endpoint 取用使用者身分，但 `getKey()` 未納入使用者識別 → **跨使用者資料外洩**
- 效能缺口：適用 edge cache 沒有符合 SR-6 的持久化 driver；列為 E15-performance fail，與下方安全評分分開。
- pass：每個適用快取的身分／授權邊界與必要 headers 都已逐項驗過，且 key 隔離符合 SR-6；無快取 handler 記 N/A。只看到 getKey 函式名稱仍為 unknown。

### E16 — 字型單一來源且明列 weight（SR-7）

```bash
# static 字型 bare import（只載 weight 400）
grep -rn "@import\s*['\"]@fontsource/[^/'\"]*['\"]" --include='*.css' . | grep -v node_modules
# 實際用到的字重
grep -roE 'font-(medium|semibold|bold|black|light|thin)' --include='*.vue' . | grep -v node_modules | sort -u
# 雙重宣告：nuxt.config fonts.families vs CSS @import
grep -n 'families' nuxt.config.ts
```

**判定**：

- fail：有 bare import **且** codebase 用了 400 以外字重 → 合成粗體（CJK faux bold 筆畫糊化）
- fail：`fonts.families` 與 CSS `@import` 宣告同一字型 → 雙重載入
- pass：明列 weight subpath，或只用 `@fontsource-variable/*`（可變字型 bare import 涵蓋全 weight）

### E17 — routeRules 選對渲染模式（SR-8）

```bash
grep -A30 'routeRules' nuxt.config.ts | grep -E 'prerender|isr|swr|cache|ssr'
grep -n 'ssr:\s*false' nuxt.config.ts
```

**判定**：public route 依內容性質選 `prerender` / `isr` / `swr` / `cache`。

> **`experimental.payloadExtraction` NEVER 計入缺口**：Nuxt 4 預設 `true`；`compatibilityVersion: 5` 時預設為 `"client"`；`ssr: false` 時強制 `false`。SPA consumer 此項一律 `n/a`。

### E18 — 取消訊號貫通 HTTP client（HR-6）

列出每個 query function／data-fetching handler，依 consumer 安裝版本查框架如何提供 `signal`，逐段追到實際 HTTP client。共用 interceptor 也在查核範圍：既有 signal 保留或合併，不被新 controller 取代。

- pass：每個適用呼叫均有來源到 HTTP client 的傳遞證據；interceptor 沒有覆寫。
- fail：任一適用呼叫遺漏 signal，或 interceptor 覆寫它。
- unknown：呼叫鏈或版本行為尚未查清；保留待查，不算 pass。

### E19 — 非冪等寫入有真正的防重機制（HR-7）

逐筆檢查 POST／PUT／PATCH／DELETE 與 mutation 的提交入口。依 HR-7 查 server idempotency key／dedup 或按鈕 loading-disabled；取消前端等待不能證明 server 沒有寫入。

- pass：每個適用寫入都有防重證據，未把 abort／cancel 當防重。
- fail：只靠取消前一個請求，或沒有防重機制。
- N/A：查核範圍沒有適用寫入，附範圍證據。

## Phase 3 — Grading

依下列順序判定，先檢查安全缺陷與查核完整性。N/A 排除分母；unknown 不併入 pass，並列出缺少的證據。

| Grade | 條件 |
|-------|------|
| F | 已確認 E11 跨 request 資料污染，或 E15 認證／快取隔離缺陷 |
| incomplete | 任一適用項目仍 unknown，或 reference rule／範圍尚未查清 |
| A | 所有適用 HR pass，且適用 SR 至少 80% pass |
| B | 所有適用 HR pass，SR 未達 A |
| C | 至少 3 個適用 HR pass，且有 HR fail／partial |
| D | 其餘有 HR fail／partial 的情形 |

HR = E1、E3、E4、E9、E10、E18、E19，對應 reference 的 HR-1～HR-7。E2 的 custom key 是額外檢查；E11、E15 的安全缺陷優先判 F。其他適用項目納入 SR；E15-performance 單列 SR。沒有適用 SR 時，A 的 SR 條件記為 N/A；沒有任何適用項目時報 N/A，不給 A。

此 grade 供 audit report／HANDOFF baseline 的讀者排查缺口，informational — 不觸發任何東西；不新增 publish gate。F 的安全缺陷按既有授權修正或交付對應 consumer，incomplete 保留待查證據。

## Phase 4 — Report Output

### Single consumer

```
## nuxt-data-audit report: <consumer>

Grade: C
Stack: Pinia Colada 1.3.1 + useFetch (mixed)

| # | Check | Score | Detail |
|---|-------|-------|--------|
| E1 | setup 無裸 $fetch | ✅ pass | 0 violations |
| E2 | useFetch key | ✅ pass | 3/3 custom composables have explicit key |
| E3 | dedupe | ❌ fail | 2 search boxes use defer; 3 inputs lack debounce |
| ... | ... | ... | ... |

### Top 3 Improvements
1. **E3 重複請求** — 2 個搜尋框誤加 dedupe:'defer'（回傳舊關鍵字），3 處輸入框無 debounce [files listed]
2. **E9 key factory** — 7 magic string keys should migrate to factory [files listed]
3. **E5 pick/transform** — 5 list endpoints return full rows [files listed]
```

### Fleet mode（--fleet）

```
## nuxt-data-audit fleet report

| Consumer | Grade | E1 | E2 | E3 | E4 | E5 | E6 | ... |
|----------|-------|----|----|----|----|----|----|-----|
| <consumer> | <依完整檢查計算> | pass | pass | fail | pass | partial | N/A | ... |
| ... | ... | ... | ... | ... | ... | ... | ... | ... |

### Fleet-wide gaps (priority order)
1. E3 dedupe — 0/7 consumers pass
2. E7 routeRules — 1/7 consumers pass
3. E6 Lazy — 2/7 consumers pass
```

## Enforcement Integration

本 skill 的 reference rule 由各 runtime adapter 交付正文與適用條件；`paths` metadata 本身不證明產品自動載入。執行 audit 前先讀目前 rule，依下列三層查核：

### Layer 1 — Rule Self-check Gate（寫 code 時）

Rule 內含：**每次寫完新的 useFetch / useQuery / $fetch 呼叫後，MUST 對照 HR-1~HR-7 自查**。這條靠主線的字面遵守生效，沒有機械 gate 接住它——Layer 2 / 3 才是兜底。

### Layer 2 — Code Review Cross-check（review 時）

`/code-review` 對 diff 中新增的 data-fetching 呼叫，SHOULD 跑以下 quick check：
- 新的 useFetch 的預設 cancel／顯式 defer 是否符合觸發情境？
- 新的 useQuery 有 staleTime 嗎？
- 新的 useMutation 有 invalidateQueries 嗎？
- 新的 $fetch 在 setup top-level 嗎？
- 每個適用 query 的 signal 是否傳到 HTTP client，且未被 interceptor 覆寫？
- 寫入是否有防重機制，而非依賴 abort／cancel？

### Layer 3 — Periodic Fleet Audit（定期）

從 clade home 跑 `/nuxt-data-audit --fleet`，更新 HANDOFF.md 稽核 baseline。


