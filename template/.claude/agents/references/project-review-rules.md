<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/agents/references/project-review-rules.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->

# 專案風格審查規則

Code review 時，除了標準檢查項目外，**MUST** 額外檢查以下專案特定規則。
違反項目歸類為 🟠 Major。

## 自定義 Review 清單熱區

若本次變更包含下列路徑，**MUST** 逐條套用對應 checklist，而不是只做一般風格審查：

| 變更路徑                                                              | 必跑 checklist                      |
| --------------------------------------------------------------------- | ----------------------------------- |
| `server/api/**`                                                       | 分層真相 / API 契約、資料庫存取模式 |
| `shared/schemas/**`、`shared/types/**`                                | 分層真相 / API 契約                 |
| `server/utils/drizzle.ts`、`server/db/schema/**`、`drizzle.config.ts` | Drizzle 邊界                        |
| `supabase/migrations/**`、`scripts/**`、`package.json`、`docs/**`     | 資料庫存取模式、Drizzle 邊界        |
| `app/**/*.vue`、`packages/*/app/**/*.vue`、`components/**/*.vue`、`layouts/**/*.vue`、`pages/**/*.vue` | Nuxt a11y 採用一致性、元件替代規則、Dark Mode、Form 驗證模式 |

## 元件替代規則

| 禁止使用                                                                                                                                                                                | 應替換為                                                                                                                  | 說明                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<img>`                                                                                                                                                                                 | `<NuxtImg>`                                                                                                               | 使用 Nuxt Image 模組，支援自動最佳化、lazy loading、responsive sizes。除非有 `<!-- raw-img -->` 註解明確標記例外。                                                                                                                                       |
| 原生 HTML date / time / calendar 輸入：`<input type="date">`、`<input type="datetime-local">`、`<input type="time">`、`<input type="month">`、`<input type="week">`，或包成 `<UInput type="date">` / `<UInput type="time">` / `<UInput type="datetime-local">` / `<UInput type="month">` / `<UInput type="week">`（`UInput` 只是 wrapper，底層仍走原生 picker） | 日期 / 日期區間：`<UCalendar>`（[@nuxt/ui Calendar](https://ui.nuxt.com/docs/components/calendar)）搭配 `<UPopover>` 做為 trigger；純時間輸入：`<USelectMenu>` / `<UInputMenu>` 提供固定時間選項，或專案內部封裝的時間選擇器；日期 + 時間：`<UCalendar>` + 時間選擇器組合 | 原生 date / time / calendar picker 在不同瀏覽器外觀不一致、無法套用 design system theming（含 dark mode）、a11y 行為不可控、無法本地化日期格式（zh-TW vs en-US）、無法支援 disabled date / range / 最小最大日期 / 預設 highlight 等需求。第三方 picker（`v-calendar`、`@vuepic/vue-datepicker`、`flatpickr`、`vue-datepicker` 等）一律改用 `@nuxt/ui` 對應元件，避免再多一條 design system / dark mode / i18n drift 來源。例外：純後端工具腳本、admin debug 內部頁面可豁免，**MUST** 在 PR 註明理由與位置。 |

**Reviewer 檢查方式（針對原生 date / time picker 與 `<NuxtImg>` 替代）**：

1. `grep -rEn '<input[^>]*type="(date\|datetime-local\|time\|month\|week)"' app/ packages/*/app/ components/ layouts/ pages/ 2>/dev/null` — 找原生 date / time `<input>`
2. `grep -rEn '<UInput[^>]*type="(date\|datetime-local\|time\|month\|week)"' app/ packages/*/app/ components/ layouts/ pages/ 2>/dev/null` — 找 `<UInput>` 偽裝（底層仍是原生 picker）
3. `grep -rEn "from ['\"](v-calendar\|@vuepic/vue-datepicker\|flatpickr\|vue-flatpickr-component\|vue-datepicker)['\"]" app/ packages/*/app/ components/ 2>/dev/null` — 找第三方 date picker import
4. `grep -rEn '<(img\|image)\s' app/ packages/*/app/ components/ layouts/ pages/ 2>/dev/null | grep -v "raw-img"` — 找未標記例外的原生 `<img>`

**例外條件**：

- 純後端腳本、admin debug 內部頁面、第三方套件強制原生 HTML 元素：**MUST** 在 PR 註明位置與理由
- `<input type="color">` 等非日期 / 時間類 picker 不在本條範圍

## 資料庫存取模式

| 禁止使用                                              | 位置                     | 說明                                                                                                                                    |
| ----------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `.insert()` / `.update()` / `.delete()` / `.upsert()` | `app/` 目錄（client 端） | Client 端只能用 `.select()` 讀取。所有寫入必須透過 `server/api/v1/*` 的 Server API。                                                    |
| `mcp__*-supabase__apply_migration` 執行 DDL           | 任何位置                 | MCP 使用 `supabase_admin` role，建立的物件 owner 錯誤會導致 CI/CD 部署失敗。DDL 必須透過 `supabase migration new` 建立 migration 檔案。 |
| `mcp__*-supabase__execute_sql` 執行 DDL               | 任何位置                 | 同上。Supabase MCP（dev / staging / prod）只能用於 SELECT 查詢、除錯、檢查 table owner。                                                |

## Dark Mode 色彩規則（Nuxt UI Color Mode）

專案使用 `@nuxt/ui` 的 color mode 系統，UI 元素 **MUST** 使用 semantic theme tokens；hardcoded 色彩在 dark mode 下會破版或刺眼。違反視為 🟠 Major。

| 禁止使用                                            | 應替換為                       | 說明                                                                                            |
| --------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------- |
| `text-black` / `text-neutral-900` / `text-slate-900` / `text-slate-800` | `text-highlighted`             | 禁止 hardcoded 文字色，dark mode 下不可見。                                                     |
| `text-slate-700` / `text-neutral-700`               | `text-default`                 | 預設文字色用 token；若該位置本來就是預設色可直接移除 class。                                    |
| `text-gray-500` / `text-slate-500` / `text-slate-400` / `text-neutral-500` | `text-muted`                   | 次要文字使用 theme token。                                                                      |
| `text-gray-400` / `text-slate-300` / `text-neutral-400` | `text-dimmed`                  | 最低對比文字使用 theme token。                                                                  |
| `text-gray-600` / `text-neutral-600`                | `text-toned`                   | 第三層文字使用 theme token。                                                                    |
| `text-white`                                        | `text-inverted`                | 反轉文字色用 token。                                                                            |
| `bg-white` / `bg-neutral-50`                        | `bg-default`                   | 白色背景在 dark mode 下刺眼。                                                                   |
| `bg-slate-50` / `bg-gray-50` / `bg-neutral-100`     | `bg-muted`                     | 區塊底色用 token；面板級用 `bg-elevated`。                                                      |
| `bg-gray-100` / `bg-slate-100`                      | `bg-accented`                  | 強調背景色使用 theme token。                                                                    |
| `bg-black` / `bg-neutral-900`                       | `bg-inverted`                  | 反轉背景色用 token。                                                                            |
| `border-slate-200` / `border-gray-200` / `border-neutral-200`            | `border-default`               | 邊框色使用 theme token。                                                                        |
| `border-gray-100` / `border-slate-100`              | `border-muted`                 | 淡化邊框色使用 theme token。                                                                    |
| `bg-blue-50` / `bg-green-50` / `bg-red-50` 等語意底色 | `bg-info/10` / `bg-success/10` / `bg-error/10` | 語意背景色使用 Nuxt UI color token + opacity。                                                  |
| `text-blue-700` / `text-blue-500` / `text-red-600` 等語意文字色 | `text-info` / `text-error` / `text-success` / `text-warning` | 語意文字色使用 Nuxt UI color token。                                                            |
| `dark:` prefix（如 `dark:text-white`、`dark:bg-gray-800`） | 改用 semantic token，由 Nuxt UI 自動處理     | Nuxt UI color mode 會根據 token 自動切色，自己寫 `dark:` 會與系統衝突造成不一致。               |
| Raw `<input>` / `<textarea>` with manual styling    | `<UInput>` / `<UTextarea>`     | Nuxt UI 元件自動適配 dark mode，raw HTML 元素需手動維護色彩。例外：第三方套件要求 raw element。 |

**Reviewer 檢查方式**：

1. `grep -rEn "(^| |\")(text|bg|border)-(slate|gray|neutral|zinc|stone)-[0-9]+" app/ packages/*/app/` — 找 hardcoded grayscale 色彩
2. `grep -rEn "(^| |\")(text|bg)-(white|black)\b" app/ packages/*/app/` — 找 hardcoded 黑白
3. `grep -rEn "dark:(text|bg|border)-" app/ packages/*/app/` — 找手寫 `dark:` prefix（除 CSS 變數定義外都不該出現）
4. `grep -rEn "(^| |\")(bg|text)-(blue|green|red|yellow|orange|purple|pink)-(50|100|500|600|700)" app/ packages/*/app/` — 找硬編碼語意色

**例外條件**：
- CSS 變數定義（`--ui-primary`、`--ui-bg-default` 等）內可使用 `black` / `white`
- Nuxt UI 元件的 `color` prop（`color="neutral"` / `color="error"` / `color="success"` 等）可直接傳 semantic 名稱
- 系統回饋元件（`UAlert`、toast 等）使用 `color="error"` / `color="success"` 等 prop 控制
- 第三方套件強制 raw HTML 元素時可豁免，但 **MUST** 在 PR 註明理由與位置

## 分層真相 / API 契約

| 禁止使用 / 必查項                                       | 位置                                   | 說明                                                                                                                                    |
| ------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| request / response contract 放在 `shared/types/**`      | `server/api/**`、`app/**`、`shared/**` | request / response contract 的真相來源必須是 `shared/schemas/**`；`shared/types/**` 只能做相容轉發或 UI / view-model 型別。             |
| request handler 預設使用 `getServerSupabaseClient()`    | `server/api/**`                        | request-scoped 預設路徑必須是 `getSupabaseWithContext(event)`；`getServerSupabaseClient()` 只留給 audit、backfill、資料修復、背景工作。 |
| handler 回傳 payload 未經 response schema `parse()`     | `server/api/**`                        | API handler 出口必須有 response contract drift guard。若有 response schema，review 時必須確認回傳前有 `parse()`。                       |
| `shared/schemas/**` 與 handler / query / store 匯入漂移 | `server/api/**`、`app/**`              | 若程式碼仍從 `shared/types/**` 匯入 request / response contract，視為違反分層真相。                                                     |

## Drizzle 邊界

| 禁止使用 / 必查項                                                      | 位置                                                   | 說明                                                                                                                     |
| ---------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| 在正式 schema 變更流程引入 `drizzle-kit generate` / `drizzle-kit push` | `package.json`、`scripts/**`、`docs/**`、CI / workflow | Supabase CLI 才是 migration owner。Drizzle 只能是選用 query layer，不得接管 schema deploy。                              |
| 在 request handler 直接把 Drizzle 當預設資料存取路徑                   | `server/api/**`                                        | Drizzle 僅用於 service 層 / 系統任務；request handler 預設仍應保留 `getSupabaseWithContext(event)` 與 request context。  |
| 把 `server/db/schema/**` 當作 RLS / trigger / DDL 真相來源             | `server/db/schema/**`、`docs/**`                       | persistence truth 仍在 `supabase/migrations/**`。Drizzle schema 只能作 query metadata 或選用整合層，不可取代 migration。 |
| 新增文件或範例暗示「有 Drizzle 就不需要 Supabase migration」           | `docs/**`、`.claude/**`                                | 這會直接破壞現有 truth layer，review 必須視為 Major。                                                                    |

## UI 錯誤訊息本地化

UI **MUST NOT** 出現任何未經處理的原始英文錯誤代碼或訊息（如 `not_found`、`unauthorized`、`forbidden`、`invalid_token`、`PGRST116`、堆疊追蹤等）。所有對使用者顯示的錯誤都必須是專案語系（預設繁體中文）的友善訊息。

| 禁止 pattern                                                                                | 應改為                                                                       | 說明                                                                                                                                                |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `errorMessages[code] ?? code`                                                               | `errorMessages[code] ?? '發生未預期的錯誤'`                                  | 對照表 fallback **MUST** 落在中文預設訊息，不可把未知 code 原封不動回傳給 UI。常見漏網之魚：`not_found`、`forbidden`、`bad_request`、`invalid_grant`。 |
| `error.message` / `e.statusMessage` 直接綁到 `<UAlert :title>` / `<p>{{ error }}</p>`         | `parseError(error)` / `getErrorMessage(error, '預設中文訊息')`               | UI 一律經過正規化 helper；**NEVER** 把 raw error 物件 / API code 餵給 template。                                                                    |
| `:title="route.query.error"` / `{{ $route.query.error }}` 直接顯示 query string             | `parseError(route.query.error)` 或 server 端 redirect 時帶已本地化 message   | URL query 來源不可信，可能是任意英文 token；必須先過對照表。                                                                                       |
| 後端 `throw createError({ statusMessage: 'not_found' })` 被前端 `useFetch` 接到後直接顯示   | 前端 `parseError(err)`，且 helper 對 H3 error 有 `statusCode` 對應的中文 fallback | server 拋的 statusMessage 是給 log 用的英文 enum，**NEVER** 假設可以直接顯示。                                                                       |
| 在 `useAuthError` / 類似 helper 新增 server-side error code 時只加 server，未補對照         | 新增 code 時 **MUST** 同步更新對應 `errorMessages` 對照表                   | 新 code 流到 UI 前一定要在對照表先有條目；缺漏會走 fallback 顯示原文。                                                                              |
| Toast / notification 直接 `toast.add({ title: error.message })`                              | `toastError(title, error)`（內部會 `parseError`），或先 `getErrorMessage(error, fallback)` | toast 訊息一旦顯示就已洩漏，不要假設 error 來源都可控。                                                                                              |

**Reviewer 檢查方式**：

1. `grep -rn "?? error\b\|?? code\b\|?? err\b\|?? statusMessage" app/ packages/*/app/` — 找對照表 fallback 直接回傳原值的 anti-pattern
2. `grep -rn "statusMessage\|error\.message\|err\.message" app/**/*.vue packages/*/app/**/*.vue` — 找 template 直接綁原始錯誤
3. PR 若新增 server-side error code（throw `createError`、redirect with `error=xxx`），檢查對應前端 helper（`useAuthError` 等）是否同步補上中文對照
4. 對改動的登入 / 認證 / API 錯誤 UI，逐一過一次「unknown code 進來時畫面顯示什麼」
5. `grep -rn "toast\.add\|useToast" app/` — 確認 toast 文案來源都經過正規化

**例外條件**：開發環境 debug toast / dev-only banner 可保留原始訊息，但 **MUST** 用 `if (import.meta.dev)` 包起來，且 production build 不可觸發。

## evlog 採用一致性

若專案已採用 [evlog](https://github.com/HugoRCD/evlog)（判斷依據：`package.json` 列了 `evlog` 依賴，或 `nuxt.config.ts` 含 `evlog/nuxt` module，或 codebase 已存在 `useLogger(event)` 用法），新寫或大改的程式碼 **MUST** 套用 evlog 模式；review 時要主動抓「該套未套」的情況。違反視為 🟠 Major。

| 禁止 pattern                                                                                | 應改為                                                                                 | 說明                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 新增 `server/api/**` handler 沒有第一行 `const log = useLogger(event)`                     | 第一行 `const log = useLogger(event)`，後續用 `log.set(...)` / `log.error(err, {...})` | request-scoped wide event 是 evlog 的核心；handler 缺 logger 等於該 request 沒有結構化 trace。GET endpoint 至少要初始化 logger，方便錯誤路徑用 `log.error`。              |
| `server/` 任何位置出現 `console.log` / `console.error` / `console.warn` / `console.info` / `console.debug` | API handler 用 `log.*`；request utils 接收 `RequestLogger`；job/cron/script 用 `createLogger()` / `createRequestLogger()`；drain failure fallback 需 `evlog-exempt` 註解 | `console.*` 不會進入 evlog drain（Axiom / OTLP / Sentry 等），等於 production 永久看不到。唯一例外是 evlog drain 自身失敗時不可再透過同一條 drain 記錄。                 |
| `server/api/**` 內 `import { consola } from 'consola'` / `useLogger` 之外的 logger          | 一律 `useLogger(event)`                                                                | 該層必須是 request-scoped；用 consola 會繞過 wide event 累積機制，丟失 user / request 對應。                                                                          |
| PR diff 新增 `package.json` `consola` runtime dependency                                    | 移除；用 evlog 的 request / standalone / pipeline API                                  | evlog 已提供 `useLogger(event)`、`createLogger()`、`createRequestLogger()` 與 `createDrainPipeline()`；不需要多裝 consola 當 fallback。**Pre-existing dep 不擋**（見例外條件）。                                |
| `throw new Error('...')` / `throw Error('...')`（在 evlog handler 內）                      | `throw createError({ message, status, why?, fix?, cause? })`（從 `evlog` import）     | 結構化 error 才能在前端 `parseError` 拿到 `why` / `fix` / `link`；`new Error` 等於丟掉 debugging context。                                                              |
| `catch (e) { console.error(e); throw e }` log-and-throw                                     | `catch (e) { log.error(e, { step: '...' }); throw createError({...}) }`                | log + 重新拋同一個 error 會在上游重複記錄；evlog 模式是「log.error 留 trace + 拋結構化 error 給 caller」。                                                            |
| `catch (e) { throw e }` 重新拋出但沒補 context                                              | 補 `log.error(e, { step })` 並包成 `createError({ message, why: e.message, cause: e })` | 重拋不補 context 等於這層白搭；至少要留下 `step` 標記與原 error 的 `cause`。                                                                                          |
| Mutation handler 在 `requireAuth()` / `requireRole()` 之後沒有 `log.set({ user, operation, table })` | `log.set({ user: { id }, operation: '...', table: '...' })`                            | 沒 user context 的 wide event 在告警 / 追蹤時無法定位影響範圍。GET endpoint 可省略，但 POST / PATCH / DELETE 必要。                                                  |
| `handleDbError(error)` 後沒 `throw`（perno 等專案的 helper returns，不 throw）              | `const r = handleDbError(error); throw createError({ status: r.statusCode, ... })`      | helper 設計是 returns，缺 `throw` 會讓錯誤被吞掉，handler 繼續往下跑。是 evlog 採用後最常見漏網情境之一。                                                              |
| 對「預期業務錯誤」（404、422、`PGRST116`、`invalid_credentials` 等）呼叫 `log.error`        | 直接 `throw createError({ status, message })`，不要 log.error                          | `log.error` 留給「系統異常」（5xx、非預期 DB error）。把 caller 錯誤當系統錯誤記錄會造成告警疲勞。                                                                    |
| 同一錯誤路徑出現 `log.error` 兩次以上                                                       | 整條路徑只在最內層或最外層 `log.error` 一次                                            | 重複 log = 重複告警 = 真實事故被噪音淹沒。                                                                                                                            |
| `log.error(maybeNull as Error)` 沒先檢查 null                                               | `if (err) log.error(err as Error)`                                                     | `useFetch` 的 `error.value` / 條件路徑可能是 null，傳 null 會 noop 或 runtime error。                                                                                |
| 前端只用 `error.message` 顯示，忽略 evlog `error.data.data` 的 `why` / `fix` / `link`       | 前端 toast / inline error 顯示 `message` + `why` + `fix`（由 `parseError(err)` 解構）  | evlog 的 structured error 把 debug context 帶到前端是設計重點，前端只取 message 等於浪費。                                                                            |

**Reviewer 檢查方式**：

1. `grep -rn "console\.\(log\|error\|warn\|info\|debug\)" server/` — `server/` 內任何 console 都要 flag（除非檔頭顯式 `// evlog-exempt: <理由>`）
2. `grep -rn "throw new Error\|throw Error(" server/` — 新增的 `new Error` 必須轉 `createError`
3. 對每個 PR 新增的 `server/api/**/*.ts` 檔，Read 開頭 5 行確認 `const log = useLogger(event)` 存在
4. `grep -rn "handleDbError(" server/api/` — 每個呼叫點往下看 3 行，確認後續有 `throw`
5. `git diff <base>..HEAD -- server/ package.json` 內 `+.*from 'consola'` 或 `+.*"consola"` 才 flag；pre-existing usage / dep 不擋（遷移走專案的 evlog adoption spectra change）
6. `grep -rn "log\.error" server/api/` — 對每個出現點檢查：(a) 是否為預期業務錯誤被誤 log；(b) 同一路徑是否多次 log
7. `grep -rn "console\.error" server/plugins/evlog-*` — 僅允許 drain failure fallback，且同段必須有 `evlog-exempt` 註解

**例外條件**：
- 純 build / CLI script（`scripts/**`、`drizzle.config.ts` 等）可用 `console` 作終端輸出；若 script 需要 production observability，改用 evlog standalone API
- 一次性 migration script、debug 用 admin endpoint 可豁免，但 **MUST** 在 PR 註明
- 專案尚未採用 evlog（`package.json` 沒有依賴）→ 整段規則不適用，但若 PR 同時引入 evlog，新 / 改的 handler 必須直接到位，不接受「先用 console 之後再遷」
- **Pre-existing `consola` runtime dep + pre-existing `import { consola } from 'consola'` usage**：本條 review 不擋；遷移走專案的 evlog adoption spectra change（如 `adopt-evlog-hardening-t2`）統一處理。新 PR 不得新增 consola usage，也不得在 evlog 已完成遷移後保留殘留 dep。Reviewer **MUST** 用 `git diff <base>..HEAD` 範圍判斷，不能 `grep -rn` 全 codebase 掃出 pre-existing 然後當作違規

## D-pattern audit 一致性

若專案已採用 D-pattern audit（判斷依據：`server/utils/audit.ts` 存在、`audit_logs` / `operation_logs` 表有 `prev_hash` / `hash` 欄位），新寫或大改的程式碼 **MUST** 套用 D-pattern；review 時要主動抓「該套未套」的情況。違反視為 🟠 Major。

| 禁止 pattern | 應改為 | 說明 |
| --- | --- | --- |
| handler 直接 `db.from('audit_logs').insert(...)` / `db.from('operation_logs').insert(...)` | `await audit(event, {...})` / `await auditDeny(event, {...})` | 直接 insert 繞過 hash chain trigger 與 helper PII 過濾 |
| `log.audit({...})` 沒帶 `auditEventId` | `log.audit({..., auditEventId})` 在 `audit()` 之後呼叫 | evlog audit 是 derived stream，必須 cross-reference DB canonical row |
| 在 `business_keys` 內塞 PII / 姓名 / email / raw LLM prompt | 把 PII 放 evlog `context`，`business_keys` 只放結構化業務鍵 | DB row 為長期 immutable，PII 進去違反 GDPR 刪除權 |
| Migration 加 `audit_logs.ip_address` / `audit_logs.user_agent` | PII 進 evlog envelope；DB 表只留 `actor_id` UUID | DB 永久 PII 跟法遵刪除權衝突 |
| `requireRole` / `requireAuth` 失敗只 `throw` 沒呼 `auditDeny` | 自動在 helper 內呼 `auditDeny()` | 拒絕操作的紀錄是合規剛需 |
| Multi-tenant audit 表沒 per-tenant chain（共用 global hash） | advisory lock per tenant 或 partition | tenant A 的高頻寫入會干擾 tenant B 的 chain verification |

**Reviewer 檢查方式**（搜尋路徑涵蓋 monorepo `packages/*/server/` 與單包 `server/`）：

1. `grep -rEn "from\(['\"](audit_logs|operation_logs)['\"]\)\.insert" server/ packages/*/server/ 2>/dev/null` — 找直接 insert 繞 helper
2. `grep -rn "log\.audit(" server/ packages/*/server/ 2>/dev/null` — 對每個出現點檢查是否帶 `auditEventId`
3. `grep -rEn "ip_address|user_agent" supabase/migrations/` — 找新 migration 是否塞 PII 進 DB
4. PR 含新 mutation handler（`server/api/**` 或 `packages/*/server/api/**`）→ 確認是否呼 `audit()` / `auditDeny()`
5. PR 改 `requireAuth` / `requireRole` / 任何 auth helper → 確認失敗路徑有 `auditDeny()`

**例外條件**：
- `server/utils/audit.ts` 或 `packages/*/server/utils/audit.ts` 自身是唯一允許直接寫 audit 表的位置
- 一次性 migration script（補資料）可豁免，但 **MUST** 在 PR 註明
- 專案尚未採用 D-pattern（`server/utils/audit.ts` 不存在）→ 整段不適用，但若 PR 同時引入 D-pattern，新 / 改的 mutation handler 必須直接到位

Reference: `docs/d-pattern-master-plan.md`

## Bug 修正文件同步

若本次變更包含 `🐛 fix` 類型的 commit，檢查是否已更新 `docs/verify/PRODUCTION_BUG_PATTERNS.md`。該文件記錄已發生過的錯誤模式與防範措施，修正 bug 時應同步補充對應的 Pattern 紀錄。

## Form 驗證模式

專案已內建 `@nuxt/ui` 的 `UForm` 與 `zod`，**MUST** 用於所有多欄位表單。違反時視為 🟠 Major。

| 禁止的寫法                                                                                    | 正確的替代方案                                                                                                    | 說明                                                                                                                                |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `<UButton :disabled="!field1 \|\| !field2" @click="submit">`                                  | `<UForm :schema="zodSchema" :state="state" @submit="onSubmit"><UButton type="submit">`                            | 手寫 `:disabled` 鎖 submit 沒有告訴使用者缺什麼、也不會 inline 顯示錯誤。UForm + Zod 會自動 focus 第一個錯誤欄位並 inline 提示。    |
| `<UFormField label="標題">` 但該欄實際必填                                                    | `<UFormField label="標題" name="title" required>` + schema 對應欄位 `z.string().min(1)`                           | 必填必須在 UI 上有星號標示；`name` 屬性才能讓 UForm 把 Zod 錯誤對應到欄位。                                                         |
| 從使用者輸入（檔名、標題等）自動產生識別字串（slug / id）後未處理「結果為空字串」的 edge case | 產生後必須 `if (!result) result = fallback()`（例如 `crypto.randomUUID().slice(0, 8)`），或顯式提示使用者手動填寫 | 全中文、emoji、純符號等輸入經 `[^a-z0-9]+` replace 後會變成空字串，欄位只剩 placeholder 看起來像已填、實際為空 → 使用者無法 debug。 |
| 把 `placeholder` 當作「這欄已有值」的視覺訊號                                                 | `placeholder` 僅供範例；必填提示用 `required` / inline error                                                      | placeholder 是灰字提示，使用者無法區分「已填」與「範例文字」。                                                                      |
| `<UInput>` / `<input>` / `<textarea>` / `<UTextarea>` 沒設 `maxlength`                       | `:maxlength="<schema/DB 上限>"`（例 `decimal(12, 4)` → 14；`varchar(N)` → N；自由文字依 schema `z.string().max(N)` 一致） | 沒上限的 input 等於對 server 開放任意長度寫入：DB column overflow 變 500 / 422 錯誤、payload 無限大、UI 文字 layout 爆版。`maxlength` 是輸入端硬閘門，schema validation 是第二層；兩層都要。 |

**檢查動作**：

1. 掃 `app/**/*.vue` 中的 `<UButton[^>]*:disabled=` — 若 disabled 條件引用多個 form state，flag 為 🟠 Major，建議改用 UForm
2. 掃 auto-generate slug / id 邏輯 — 確認有空值 fallback
3. 掃 `<UFormField>` — 若對應 schema 欄位是 `.min(1)` 或非 optional，UFormField 必須有 `required` 且 `name` 屬性
4. `grep -rEn "<(UInput|input|UTextarea|textarea)\b" app/ packages/*/app/ layers/*/components/ 2>/dev/null` — 逐筆檢查是否有 `:maxlength` / `maxlength`；缺者比對對應 schema / DB column 上限是否合理省略

**例外條件**：

- 第三方套件元件強制無 `maxlength` 屬性 → PR **MUST** 註明位置與套件名
- 純展示用 `readonly` / `disabled` input 可豁免
- 已透過 schema `z.string().max(N)` 嚴格約束且 UI 額外有 character counter 顯示 → 可省略 `maxlength`，但 PR 須註明改用 counter 的原因

## Nuxt a11y 採用一致性

若專案已採用 [`@nuxt/a11y`](https://nuxt.com/modules/a11y)（判斷依據：`package.json` 列了 `@nuxt/a11y` 依賴，或 `nuxt.config.ts` 含 `'@nuxt/a11y'` module，或 `.nuxt/dev/index.html` 載入 a11y devtools panel），新寫或大改的 UI 元件 **MUST** 套用以下 a11y 規則。違反視為 🟠 Major。

`@nuxt/a11y` 由 axe-core 驅動，在 Nuxt DevTools 即時掃描 WCAG 2.0 / 2.1 / 2.2 違規，但 **review 不能只依賴 DevTools**：

- 動態 / 條件渲染區塊（`UModal`、`UDrawer`、loading state、route transition）可能未被 DevTools 自動掃到
- 開發者可能根本沒開 DevTools panel 就 commit
- DevTools **沒有** build-time error gate；CI 不會擋

所以 reviewer 必須對著規則表逐條過，DevTools 只是輔助而不是門。專案尚未採用 `@nuxt/a11y` 時，仍建議套用（a11y 是 baseline 品質要求），但嚴重程度降為 🟡 Minor 提示。

| 禁止 pattern | 應改為 | 說明 / WCAG |
| --- | --- | --- |
| `<NuxtImg>` / `<img>` 缺 `alt` 屬性 | 內容圖：`<NuxtImg alt="描述">`；裝飾圖：`<NuxtImg alt="" aria-hidden="true">` | screen reader 對沒 `alt` 的圖會唸出檔名或路徑。WCAG 1.1.1 |
| icon-only `<UButton :icon="i-..." />` 無 `aria-label` 也無 visible label | `<UButton :icon="i-..." aria-label="關閉" />`，或同時用 `<UTooltip>` 包並提供 `text` | screen reader 唸到「button」沒上下文。WCAG 4.1.2 |
| `<UIcon name="..." />` 純裝飾未加 `aria-hidden="true"` | `<UIcon name="..." aria-hidden="true" />` | 裝飾 icon 不該被 screen reader 朗讀，會打斷閱讀流。WCAG 1.3.1 |
| `<div @click="...">` / `<span @click="...">` 模擬 button | 改用 `<button>` / `<UButton>` / `<NuxtLink>`（語意 element） | div / span 預設不可 focus、不會觸發 Enter / Space、screen reader 不知道是互動元素。WCAG 4.1.2 |
| `tabindex="1"` 等正數值 | `tabindex="0"`（加入 tab order）或 `tabindex="-1"`（programmatic focus）或不寫（natural order） | 正數 tabindex 會破壞 native tab order，造成跳躍式焦點。WCAG 2.4.3 |
| `aria-hidden="true"` 套在仍可 focus 的元素（input、button、link） | 拿掉 `aria-hidden`；若真要藏，同時加 `tabindex="-1"` 並 `disabled` | 鍵盤可 tab 到但 screen reader 看不到 = 雙標，AT user 困惑。WCAG 4.1.2 |
| Heading 跳級（`<h1>` 後直接 `<h3>`、page 內出現多個 `<h1>`） | 依序 h1 → h2 → h3，page 只有一個 h1 | screen reader 用 heading 結構導航；跳級破壞 outline。WCAG 1.3.1、2.4.6 |
| `<input>` / `<UInput>` 不在 `<UFormField>` 內、也無 `aria-label` / `aria-labelledby` | 一律包 `<UFormField label="姓名" name="name">`；極少數無 label 場合用 `aria-label` | 沒 label 的 input 對 screen reader 是匿名輸入框。WCAG 1.3.1、3.3.2 |
| 用 `placeholder` 取代 label | label 必須在 visible UI；placeholder 只供範例提示 | placeholder 灰字、輸入後消失，且對比通常不足。WCAG 3.3.2 |
| `<a target="_blank">` / `<NuxtLink target="_blank">` 沒視覺或 sr-only 提示 | 加「開新視窗」icon（如 `i-lucide-external-link`），或 `<span class="sr-only">（在新視窗開啟）</span>` | screen reader / 鍵盤 user 不預期跳新分頁。WCAG 3.2.5 |
| `<a>` / `<NuxtLink>` 內只有 icon 沒 visible text 也沒 `aria-label` | 加 `aria-label="..."` 或 sr-only text | 無名連結對 screen reader 沒意義。WCAG 2.4.4、4.1.2 |
| 動畫 / transition / parallax 沒處理 `prefers-reduced-motion` | CSS 包 `@media (prefers-reduced-motion: reduce) { ... }` 關閉或縮短動畫；Vue transition 條件啟用 | 前庭功能障礙者會頭暈。WCAG 2.3.3 |
| 自製 modal / drawer / dialog 缺 focus trap、`role="dialog"`、`aria-labelledby`、Esc close | 優先用 `<UModal>` / `<UDrawer>`（Nuxt UI 自動處理）；自製必須補齊四項 | 鍵盤 user 進入 dialog 會 tab 到底層、screen reader 不知 context。WCAG 2.1.2、4.1.2 |
| Modal / Drawer 的 close button 是 icon-only 沒 `aria-label` | `<UButton icon="i-lucide-x" aria-label="關閉對話框" />` | 同 icon-only button，screen reader 唸不出。WCAG 4.1.2 |
| `<html>` 缺 `lang` 屬性，或 i18n 切語言時未同步更新 | `nuxt.config.ts` 設 `app.head.htmlAttrs.lang`；i18n 用 `useHead({ htmlAttrs: { lang } })` 動態更新 | screen reader 用 lang 決定發音引擎，缺 lang 會用使用者預設語系唸中文。WCAG 3.1.1、3.1.2 |
| `<table>` 未配 `<caption>` / `<th scope>` / `aria-label`（資料表，非 layout） | `<th scope="col">` / `<th scope="row">` + `<caption>` 或 `aria-labelledby` | 沒 header 關聯的表格對 screen reader 是無意義 grid。WCAG 1.3.1 |
| 表單錯誤只用紅色字體標示，沒 icon、沒 text、沒 `aria-invalid` / `aria-describedby` | `<UFormField>` 自動帶 `aria-invalid`；自製表單須補；錯誤訊息須有文字（不只顏色） | 色盲 user 看不到差異。WCAG 1.4.1、3.3.1 |
| `autoplay` 影片 / 音訊 | 移除 autoplay；或加 mute + 明顯暫停按鈕 + `aria-label="暫停"` | 自動播放干擾螢幕閱讀器、認知障礙者。WCAG 1.4.2 |
| 互動元素（button / link / input）尺寸 < 24×24 px（mobile） | 命中區域 ≥ 24×24 px（理想 44×44 px） | 行動裝置難以點擊。WCAG 2.5.8（new in 2.2） |

**Reviewer 檢查方式**：

1. `grep -rEn "<(img|NuxtImg)\b[^>]*>" app/ packages/*/app/ components/ layouts/ pages/ 2>/dev/null | grep -v "alt="` — 找缺 alt 的圖片
2. `grep -rEn "<UButton\b[^>]*\bicon=" app/ packages/*/app/ 2>/dev/null | grep -vE "(aria-label|label=|>[^<]+</UButton>)"` — 找 icon-only 沒 aria-label 的 UButton
3. `grep -rEn "<UIcon\b[^>]*/>" app/ packages/*/app/ 2>/dev/null | grep -vE "aria-(hidden|label)"` — 找裸的 UIcon
4. `grep -rEn "@click[^=]*=" app/ packages/*/app/ 2>/dev/null | grep -E "<(div|span|li|p)\b"` — 找非互動 element 上的 @click
5. `grep -rEn 'tabindex="[1-9]' app/ packages/*/app/ 2>/dev/null` — 找正數 tabindex
6. `grep -rEn 'target="_blank"' app/ packages/*/app/ 2>/dev/null` — 逐筆檢查是否有 sr-only 提示或 external icon
7. `grep -rEn '<input\b|<UInput\b' app/ packages/*/app/ 2>/dev/null` — 對每個輸入元素確認外層 `<UFormField>` 或 `aria-label`
8. PR 含新 modal / drawer / dialog（搜 `<UModal|<UDrawer|role="dialog"`）→ 手動驗 keyboard tab order + Esc close + focus return
9. PR 引入 transition / animation / motion → 確認 CSS 有 `prefers-reduced-motion` 分支
10. 對照 DevTools `@nuxt/a11y` panel：reviewer 在 dev 環境跑過該 PR 涉及頁面，確認 critical / serious 級違規清空

**例外條件**：

- 純後端 / API / migration 改動不適用
- admin 內部 debug 頁面、非產品流程 UI 可豁免，但 **MUST** 在 PR 註明位置與理由
- 第三方套件強制使用 raw HTML 元素（無 Nuxt UI 對應）→ PR 註明
- 「裝飾用」icon、image 一律明示 `aria-hidden="true"` / `alt=""`，不接受省略
- 一次性 prototype / spike branch（不會 merge 到 main）可豁免，但須在 PR description 標註「PROTOTYPE — NO MERGE」
