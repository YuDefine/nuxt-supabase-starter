<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/agents/references/clade-review-rules.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# 專案風格審查規則

本檔是 review 規則的**定義 SoT＋reviewer 語意兜底參考**。機械可檢段的 enforcement 由 `vendor/review-rules/patterns.json`（pre-commit / pre-push / CI 三層自動執行）承擔，**不靠 agent 讀本檔自律**；語意段由 commit 0-A review prompt 的 Semantic Verdict 契約承擔。新增規則 **MUST** 先分類機械或語意（見 [[pitfall-clade-review-rules-not-enforced-at-consumer]]）。

違反本檔語意段的項目歸類為 🟠 Major。

> **Enforcement 架構（TD-194，v1.4.176+；W5 四層攔截網）**：
>
> | 層 | 位置 | 職責 |
> | --- | --- | --- |
> | **pre-commit / pre-push / CI** | `vendor/review-rules/patterns.json` + `vendor/review-rules/scan.ts` | 純 grep pattern，三層自動執行（fail-fast，不靠 agent 自律） |
> | **audit script** | `scripts/audit-review-rules.ts --all-consumers` | 半機械 grep fleet scanner，reference signal |
> | **path-scoped rule** | `rules/modules/framework/nuxt/nuxt-overlay-slot.md` / `nuxt-form-validation.md` / `nuxt-error-localization.md` | 語意規則，改 `.vue` 時 session 自動載入 |
> | **本檔（語意段）** | commit 0-A review prompt 的 Semantic Verdict 契約 | 複雜語意規則（需讀 context 判斷），機械層抓不到的；review prompt 逐 verdict-id 輸出 pass/fail/n-a |
>
> 每個 `##` section 標題下的 `> enforcement:` 行標明其機械 / 語意歸屬；`scripts/audit-review-rules.ts --alignment` 對照 `patterns.json` 驗證一致性，為 publish blocking gate。

## 自定義 Review 清單熱區

> enforcement: mechanical(raw-img-tag, ubadge-size-ban, ubadge-size-ban-config, client-side-mutation, dark-mode-hardcoded-color, dark-mode-dark-prefix, dark-mode-semantic-color, overlay-width-class) + semantic(form-validation, error-localization, overlay-body-slot)

若本次變更包含下列路徑，**MUST** 逐條套用對應 checklist：

| 變更路徑 | 必跑 checklist |
| --- | --- |
| `server/api/**` | 分層真相 / API 契約、Drizzle 邊界 |
| `shared/schemas/**`、`shared/types/**` | 分層真相 / API 契約 |
| `server/utils/drizzle.ts`、`server/db/schema/**`、`drizzle.config.ts` | Drizzle 邊界 |
| `supabase/migrations/**`、`scripts/**`、`package.json`、`docs/**` | Drizzle 邊界 |
| `app/**/*.vue`、`packages/*/app/**/*.vue`、`components/**/*.vue`、`layouts/**/*.vue`、`pages/**/*.vue` | Nuxt a11y、Overlay slot 語意、**Nuxt 效能（Lazy 該不該 lazy＋有無 hydration strategy）**（機械段已由 hook/rule 覆蓋，reviewer 補語意段） |
| `server/**` | evlog 採用一致性、D-pattern audit、**Nitro 快取認證邊界** |
| `**/*.css`、`nuxt.config.*`、`app.config.*` | **字型宣告單一來源**（`@fontsource` weight subpath；`fonts.families` 與 CSS `@import` 不得雙重宣告） |

> **已由機械層覆蓋（本檔不再重複）**：元件替代規則（native-picker-ban.sh + patterns.json `raw-img-tag`）、UBadge size（`ubadge-size-ban`）、client-side mutation（`client-side-mutation`）、Dark Mode hardcoded color / `dark:` prefix / semantic color（3 patterns）、Overlay 寬度 `max-w-` on class（`overlay-width-class`）、Form 驗證（`nuxt-form-validation.md`）、錯誤本地化（`nuxt-error-localization.md`）、Overlay #body slot（`nuxt-overlay-slot.md`）。

## Overlay 元件語意補充（機械層抓不到的）

> enforcement: mechanical(overlay-width-class) + semantic(overlay-body-slot)

機械層（hook + path-scoped rule）已覆蓋 `#body` slot 與 `max-w-` class 的 deterministic 違規。

Reviewer **額外**需人工判斷：

1. **controlled mode default slot 非空**：overlay 用 `:open` prop + 無 trigger → default slot 應為空；非空 = 內容放錯 slot（grep 查 `<USlideover|<UModal|<UDrawer` 後逐個看）
2. **`#header` 內手寫 close button**：`<UButton icon="i-lucide-x"` → 優先改用 `title` prop + 內建 close，減少冗餘

## Pinia Colada mutation loading 欄位（機械層難抓的靜默 bug）

> enforcement: audit(audit-pinia-mutation-loading.ts)（單檔偵測器另見 `vendor/scripts/checks/mutation-loading-detect.ts`；無對應 patterns.json semantic id）

`@pinia/colada` 的 `useMutation()` 回傳的 `status`（`'pending' | 'success' | 'error'`）是 **data-state**，mount 當下就是 `'pending'`（還沒呼叫過、沒 data），**與有沒有執行無關**。拿它當 loading → 按鈕 / spinner 一進頁面就永久 loading，且 typecheck 全綠（`status` 是合法欄位、`'pending'` 是合法值）、不發任何 request、查 log 也查不到。實證：<consumer-a> 30+ 處、<consumer-b> 3 處（含**跨行 destructuring** 寫法，舊單行 grep heuristic 會漏抓）。

Reviewer **MUST** 檢查 diff 內 Pinia Colada loading 推導：

| 違規 | 正解 |
| --- | --- |
| **mutation** 的 `status === 'pending'` 當 loading / disabled | `mutation.isLoading` 或 `asyncStatus === 'loading'`；`status` 留給 success/error 判斷 |
| 為了「修」按鈕順手把 **query** 的 `status === 'pending'` 也改掉 | query 的 `'pending'` = 首載無資料，本來就該 loading，**維持不動** |

**Reviewer 檢查方式**（用 robust detector，**別**用單行 grep — 會漏跨行 destructuring）：

```bash
# 全站掃描（--all）或指定 diff 檔；支援跨行 destructuring + object-form mutation
node vendor/scripts/checks/mutation-loading-detect.ts --all --warn-only --root .
# 或只掃本次 diff 的 .vue：
node vendor/scripts/checks/mutation-loading-detect.ts $(git diff --name-only <base>..<head> -- '*.vue')
```

同一偵測器由 pre-commit（blocking）/ pre-push（warn-only）gate 共用，reviewer 看到 gate 已綠時可略過手動掃。正向 canonical pattern 與 query/mutation 欄位語意對照見 golden path [[page-loading-golden-path]] Tier 2.5（含 4 層 enforcement 表）；cross-consumer 盤點走 `scripts/audit-pinia-mutation-loading.ts`。

## MCP / DDL 存取限制

> enforcement: semantic(layered-truth)（工具呼叫層約束由 [[prod-mcp-safety]] settings deny 承擔；diff-review 僅涵蓋 layering 面）

| 禁止使用 | 說明 |
| --- | --- |
| `mcp__*-supabase__apply_migration` 執行 DDL | MCP 使用 `supabase_admin` role，建立的物件 owner 錯誤會導致 CI/CD 部署失敗。DDL 必須透過 `supabase migration new` 建立 migration 檔案。 |
| `mcp__*-supabase__execute_sql` 執行 DDL | 同上。Supabase MCP 只能用於 SELECT 查詢、除錯、檢查 table owner。 |

## 分層真相 / API 契約

> enforcement: mechanical(app-imports-server-internals) + semantic(layered-truth)

| 禁止使用 / 必查項 | 位置 | 說明 |
| --- | --- | --- |
| request / response contract 放在 `shared/types/**` | `server/api/**`、`app/**`、`shared/**` | 真相來源必須是 `shared/schemas/**`；`shared/types/**` 只能做相容轉發或 UI view-model 型別。 |
| request handler 預設使用 `getServerSupabaseClient()` | `server/api/**` | 預設路徑必須是 `getSupabaseWithContext(event)`；`getServerSupabaseClient()` 只留給 audit、backfill、背景工作。 |
| handler 回傳 payload 未經 response schema `parse()` | `server/api/**` | API handler 出口必須有 response contract drift guard。 |
| `shared/schemas/**` 與 handler / query / store 匯入漂移 | `server/api/**`、`app/**` | 若仍從 `shared/types/**` 匯入 request / response contract → 違反分層真相。 |

**Reviewer 檢查方式**：`grep -rEn "from.*shared/types.*(Request|Response|Payload)" server/api/ app/`

## Drizzle 邊界

> enforcement: semantic(layered-truth)（Drizzle 邊界與分層真相同源，共用同一 semantic id，定案 2026-07-06）

| 禁止使用 / 必查項 | 位置 | 說明 |
| --- | --- | --- |
| `drizzle-kit generate` / `drizzle-kit push` 引入正式流程 | `package.json`、`scripts/**`、CI | Supabase CLI 才是 migration owner。Drizzle 只能是選用 query layer。 |
| request handler 直接把 Drizzle 當預設存取路徑 | `server/api/**` | Drizzle 僅用於 service 層 / 系統任務；handler 預設保留 `getSupabaseWithContext(event)`。 |
| `server/db/schema/**` 當作 RLS / trigger / DDL 真相來源 | `server/db/schema/**`、`docs/**` | persistence truth 在 `supabase/migrations/**`。 |
| 文件暗示「有 Drizzle 就不需要 Supabase migration」 | `docs/**`、`.claude/**` | 直接破壞 truth layer。 |

## 耦合與內聚（coupling-cohesion）

> enforcement: audit(audit-coupling-cohesion.ts)（gate 由 `vp lint` 的兩條 oxlint 規則承擔，皆 error 級，不經 patterns.json；shotgun surgery 是 reviewer 語意判斷，無對應 patterns.json semantic id）

規約見 `.claude/rules/coupling-cohesion.md`。機械層擋 cycle 與 barrel，本段是 reviewer 補三項機械層抓不到或不該擋的判斷。

| 禁止使用 / 必查項 | 位置 | 說明 |
| --- | --- | --- |
| 針對 `import/no-cycle` 的 disable comment | 全部原始碼 | cycle 只有兩條合法路徑：當場修，或登 TD 記錄修法。`// oxlint-disable-next-line import/no-cycle` 出現在 diff 裡一律擋——它把 error 級 gate 降成無聲。 |
| 同一 discriminant 在 **≥3 個不同檔**各有一條 switch | `app/**`、`server/**`、`shared/**`、`packages/**` | 加一個 variant 要改 N 處，OCP 意義下的真違規，收斂成單一 map / strategy 表。discriminant 指 `type` / `kind` / `status` / `variant` / `mode` / `state`。**單檔內的 exhaustive switch 是慣用法，NEVER 當違規報**；判定前先確認那幾條 switch 吃的是不是同一個 union（不同 union 撞 prop 名是已知 false positive）。 |
| 既有 cycle 在 20 檔以下卻把規則降 `warn` | `vite.config.ts` | 降級只有一個合法情境：既有 cycle 涉及 **> 20 檔**的結構性 cycle，且同時登 TD 記錄涉及檔數與收斂計畫。20 檔以下降級 = 用 config 繞過 gate。 |

**Reviewer 檢查方式**：

```bash
# disable comment 逃逸
grep -rEn "oxlint-disable.*import/no-cycle" app/ server/ shared/ packages/ 2>/dev/null
# 規則被降級
grep -En "'import/no-cycle':\s*'warn'" vite.config.ts
```

## evlog 採用一致性

> enforcement: mechanical(server-console-logging, server-raw-throw-error) + semantic(evlog-consistency) + audit(evlog-adoption-audit.ts)

若專案已採用 evlog（`package.json` 列了 `evlog` 依賴），新寫或大改的程式碼 **MUST** 套用 evlog 模式。

> **機械層已覆蓋**：`evlog-adoption-audit.ts` 掃 `console.*` in server、consola import、createError no-why 等 block signal。本段是 reviewer 補語意判斷。

| 禁止 pattern | 應改為 | 說明 |
| --- | --- | --- |
| 新 `server/api/**` handler 沒有第一行 `const log = useLogger(event)` | 第一行 `const log = useLogger(event)` | handler 缺 logger = 該 request 沒有結構化 trace |
| `server/` 任何位置出現 `console.log` / `console.error` 等 | API handler 用 `log.*`；job/cron 用 `createLogger()` | `console.*` 不進 evlog drain |
| `catch (e) { console.error(e); throw e }` log-and-throw | `catch (e) { log.error(e, { step }); throw createError({...}) }` | 重複記錄 |
| 對「預期業務錯誤」（404、422）呼叫 `log.error` | 直接 `throw createError({ status, message })`，不 log.error | 告警疲勞 |
| 同一錯誤路徑 `log.error` 兩次以上 | 最內層或最外層 log.error 一次 | 重複告警 |
| Mutation handler 在 `requireAuth()` 後沒有 `log.set({ user, operation, table })` | 補 `log.set(...)` | 沒 user context 的 wide event 無法定位影響範圍 |

例外：純 build / CLI script（`scripts/**`）可用 `console`；pre-existing consola dep 不擋。

## D-pattern audit 一致性

> enforcement: mechanical(audit-table-direct-insert) + semantic(d-pattern-audit) + audit(d-pattern-audit.ts)

若專案已採用 D-pattern（`server/utils/audit.ts` 存在），新寫或大改的 mutation handler **MUST** 套用。

> **機械層已覆蓋**：`d-pattern-audit.ts` 掃 helper bypass / PII in migration / createError no-why / log.audit missing eventId。本段是 reviewer 補語意判斷。

| 禁止 pattern | 應改為 | 說明 |
| --- | --- | --- |
| 在 `business_keys` 內塞 PII / 姓名 / email / raw LLM prompt | 把 PII 放 evlog `context`，`business_keys` 只放結構化業務鍵 | GDPR 刪除權 |
| `requireRole` / `requireAuth` 失敗只 `throw` 沒呼 `auditDeny` | 自動在 helper 內呼 `auditDeny()` | 合規剛需 |
| Multi-tenant audit 表共用 global hash | advisory lock per tenant 或 partition | tenant A 高頻寫入干擾 B |

## Bug 修正文件同步

> enforcement: semantic(doc-sync)

若本次變更包含 `🐛 fix` 類型的 commit，檢查是否已更新 `docs/verify/PRODUCTION_BUG_PATTERNS.md`。

## Nuxt a11y 採用一致性

> enforcement: semantic(a11y-adoption) + audit(audit-review-rules.ts)

若專案已採用 `@nuxt/a11y`，新寫或大改的 UI 元件 **MUST** 套用 a11y 規則。

> **機械層已覆蓋**：`audit-review-rules.ts` 掃 img 缺 alt / icon-only 缺 aria-label / div @click / 正數 tabindex。本段是 reviewer 補需 AI 語意判斷的項目。

| 禁止 pattern | 應改為 | WCAG |
| --- | --- | --- |
| `<UIcon name="..." />` 裝飾未加 `aria-hidden="true"` | `<UIcon name="..." aria-hidden="true" />` | 1.3.1 |
| `tabindex="1"` 等正數值 | `tabindex="0"` 或 `-1` 或不寫 | 2.4.3 |
| `aria-hidden="true"` 套在仍可 focus 的元素 | 拿掉 `aria-hidden`，或同時 `tabindex="-1"` + `disabled` | 4.1.2 |
| Heading 跳級（h1 後直接 h3） | 依序 h1→h2→h3，page 只一個 h1 | 1.3.1 |
| `<input>` 不在 `<UFormField>` 內、也無 `aria-label` | 包 `<UFormField label="..." name="...">` | 1.3.1 |
| placeholder 取代 label | label visible；placeholder 只供範例 | 3.3.2 |
| `<a target="_blank">` 沒提示 | 加 external icon 或 sr-only 提示 | 3.2.5 |
| 動畫未處理 `prefers-reduced-motion` | CSS `@media (prefers-reduced-motion: reduce)` | 2.3.3 |
| 自製 modal 缺 focus trap / `role="dialog"` / Esc close | 用 `<UModal>` / `<UDrawer>`（Nuxt UI 自動處理） | 2.1.2 |
| `<table>` 未配 `<th scope>` / `<caption>` | 資料表加 header 關聯 | 1.3.1 |
| 互動元素尺寸 < 24×24 px（mobile） | 命中區域 ≥ 24×24 px | 2.5.8 |

例外：純後端 / admin debug / prototype branch 可豁免（PR 註明）。

## Nuxt 效能規約

> enforcement: mechanical(fontsource-bare-import, lazy-atomic-component, nuxtimg-missing-sizes, heavy-lib-client-static-import, colada-query-missing-signal) + semantic(lazy-hydration-strategy, nitro-cache-auth-safety)

規約本體見 [[nuxt-data-perf]]（HR-\* 高頻 / SR-\* 渲染兩組，條號以該檔為準）。本節只列**機械層抓不到、需 reviewer 讀 context 判斷**的四類，機械可檢部分已由 `patterns.json` 承擔。

### 1. Lazy 元件：先問該不該 lazy，再問有沒有 strategy

`<Lazy*>` 只做 **code-split**。Reviewer 對 diff 內**每一個**新增的 `<Lazy*>` 判斷：

| 判斷 | 不通過時的正解 | 適用 |
| --- | --- | --- |
| ① 它真的非首屏 / 條件渲染嗎？ | 首屏元件**移除** `Lazy` 前綴——多一個必定會被下載的 async chunk 卻無收益，是淨負面 | 全部 |
| ② 有搭 hydration strategy 嗎？ | 補 `hydrate-on-visible` / `hydrate-on-idle` / `hydrate-on-interaction` / `hydrate-on-media-query` / `:hydrate-after` / `:hydrate-when` / `hydrate-never` | **僅 `ssr: true`** |

> **先看 `nuxt.config` 的 `ssr` 值再判 ②**。`ssr: false`（SPA）沒有 hydration 階段——Vue 的 `hydrateStrategy` 只在 `__asyncHydrate()` 路徑被讀取，SPA 走一般 mount 完全不經過。對 SPA 專案要求補 `hydrate-on-*` 是**要求寫無效程式碼**，②**這一項** MUST 判 n/a 而非 fail。

> **複合 verdict**：只要**有任一適用的檢查不通過**就判 `fail`；只有在**全部**檢查都不適用時才判 `n/a`。SPA 專案的 ② 不適用**不會**讓整條規則變 n/a——① 對全部 consumer 都適用，diff 內有首屏原子元件加 `Lazy` 就是 `fail`，即使機械層 `lazy-atomic-component` 會擋同一行也一樣（機械層擋不擋是另一層的事，不改變本 verdict）。

Nuxt 官方立場：**Avoid delayed hydration for critical, above-the-fold content.**

**SSR 專案另檢查三個會讓 strategy 靜默失效的限制**：

1. **任何 prop 變更會立即觸發 hydration**，繞過設定的 strategy——綁了頻繁變動 prop 的元件，strategy 形同虛設
2. lazy hydration **僅在 SFC 內有效**，且 prop **MUST 寫在 template 上**；用 `v-bind="props"` 展開物件不生效
3. 從 `#components` 直接 import 的元件不適用

機械層 `lazy-atomic-component` 只擋最明確的原子元件濫用（`LazyUButton` / `LazyUBadge` / `LazyUSkeleton` 等），且為 `ratchet` 只擋新增；其餘交本 verdict。

### 2. Nitro 快取：先過認證邊界，再談效能

`defineCachedEventHandler` / `cachedEventHandler` / `defineCachedFunction` 出現在 diff 時，**MUST** 逐個確認：

| 檢查 | 理由 |
| --- | --- |
| 該 endpoint 回應內容**與呼叫者身分無關**嗎？ | Nitro 官方：**Request headers are dropped when handling cached responses**。帶 auth 的 endpoint 套快取＝把 A 使用者的回應發給 B 使用者，屬跨使用者資料外洩 |
| 若依身分而變仍要快取，`getKey()` 有把使用者識別納入快取鍵嗎？ | 否則所有使用者共用同一份快取 |
| 部署目標是 Cloudflare Workers / edge 嗎？ | Nitro production 預設 **memory storage**，在 Workers 上不跨 isolate 持久＝快取實質未生效，須顯式設 `storage.cache` driver（如 `cloudflare-kv-binding`） |

只有「public、與身分無關」的 endpoint 才可直接套用。**有疑慮一律不快取**——效能收益遠小於資料外洩成本。

### 3. 重函式庫的載入時機

機械層 `heavy-lib-client-static-import` 擋 client 層靜態 import（exceljs / jspdf / echarts / unovis 等）。Reviewer 補判斷**正解走哪一條**——兩者不可互換：

| 用途 | 正解 |
| --- | --- |
| 按需觸發（Excel 匯出 / PDF 產生 / 截圖） | handler 內 `await import('exceljs')`，點下去才下載 |
| 渲染必需（圖表） | 維持 import，改把**用到它的元件**寫成 `<LazyXxxChart />`；改 import 形式對這類無效，元件一渲染就需要它 |

另檢查 **零使用模組**：註冊在 `modules` / 列在 `dependencies` 但全 repo 0 處使用的套件仍會進 build（實證：一個死模組可拖 MB 級 artifact）。diff 若新增 module，MUST 確認確實有使用。

### 4. 字型宣告單一來源

`@fontsource/*` bare import 只給 weight 400（Fontsource 官方預設）；用到 `font-medium` / `font-semibold` / `font-bold` 卻沒載對應 weight，瀏覽器會合成粗體，CJK faux bold 筆畫糊化。機械層 `fontsource-bare-import` 已擋 CSS `@import`；reviewer 補判斷**跨檔的雙重宣告**——`nuxt.config` 的 `fonts.families` 與 CSS `@import` 同時宣告同一字型，機械層看單行看不出來。

### 5. 取消訊號：機械層只看得到零參數那一種

機械層 `colada-query-missing-signal` 只抓 `query: () =>` / `query: async () =>` 這種**零參數**寫法。Reviewer 補判斷 diff 內另外三種它看不到的（規約 [[nuxt-data-perf]] HR-6 / HR-7 / SR-9）：

| 檢查 | 違規長相 | 正解 |
| --- | --- | --- |
| query 有參數但沒用 signal | `query: ({ entry }) => $fetch(url)` | `query: ({ signal }) => $fetch(url, { signal })` |
| 共用 client 覆寫既有 signal | `onRequest({ options }) { options.signal = mine }` | `AbortSignal.any([options.signal, mine])`，或既有就跳過注入 |
| 拿取消當寫入防重 | 提交前 `cancelQueries` / `abortKey` 再 `mutate()` | 按鈕 disabled ＋ idempotency key（HR-7） |
| 取消被上報成 error 或被靜默吞掉 | `captureException(err)` 不分流；或 `if (isAbort) return` 什麼都不留 | `err.name === 'AbortError'` 分流 ＋ 留計數 / debug log（SR-9） |

判斷依據：Colada 的 abort 是無條件的（每次 `fetch()` ＋ 最後一個 dep 移除時各一處），signal 沒貫通到 `$fetch` 就整條打空。**NEVER** 因為「已經用 Colada」或「已經是預設 `dedupe: 'cancel'`」就判定頻寬已省。
