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
> | **pre-commit / pre-push / CI** | `vendor/review-rules/patterns.json` + `vendor/review-rules/scan.mjs` | 純 grep pattern，三層自動執行（fail-fast，不靠 agent 自律） |
> | **audit script** | `scripts/audit-review-rules.mjs --all-consumers` | 半機械 grep fleet scanner，reference signal |
> | **path-scoped rule** | `rules/modules/framework/nuxt/nuxt-overlay-slot.md` / `nuxt-form-validation.md` / `nuxt-error-localization.md` | 語意規則，改 `.vue` 時 session 自動載入 |
> | **本檔（語意段）** | commit 0-A review prompt 的 Semantic Verdict 契約 | 複雜語意規則（需讀 context 判斷），機械層抓不到的；review prompt 逐 verdict-id 輸出 pass/fail/n-a |
>
> 每個 `##` section 標題下的 `> enforcement:` 行標明其機械 / 語意歸屬；`scripts/audit-review-rules.mjs --alignment` 對照 `patterns.json` 驗證一致性，為 publish blocking gate。

## 自定義 Review 清單熱區

> enforcement: mechanical(raw-img-tag, ubadge-size-ban, ubadge-size-ban-config, client-side-mutation, dark-mode-hardcoded-color, dark-mode-dark-prefix, dark-mode-semantic-color, overlay-width-class) + semantic(form-validation, error-localization, overlay-body-slot)

若本次變更包含下列路徑，**MUST** 逐條套用對應 checklist：

| 變更路徑 | 必跑 checklist |
| --- | --- |
| `server/api/**` | 分層真相 / API 契約、Drizzle 邊界 |
| `shared/schemas/**`、`shared/types/**` | 分層真相 / API 契約 |
| `server/utils/drizzle.ts`、`server/db/schema/**`、`drizzle.config.ts` | Drizzle 邊界 |
| `supabase/migrations/**`、`scripts/**`、`package.json`、`docs/**` | Drizzle 邊界 |
| `app/**/*.vue`、`packages/*/app/**/*.vue`、`components/**/*.vue`、`layouts/**/*.vue`、`pages/**/*.vue` | Nuxt a11y、Overlay slot 語意（機械段已由 hook/rule 覆蓋，reviewer 補語意段） |
| `server/**` | evlog 採用一致性、D-pattern audit |

> **已由機械層覆蓋（本檔不再重複）**：元件替代規則（native-picker-ban.sh + patterns.json `raw-img-tag`）、UBadge size（`ubadge-size-ban`）、client-side mutation（`client-side-mutation`）、Dark Mode hardcoded color / `dark:` prefix / semantic color（3 patterns）、Overlay 寬度 `max-w-` on class（`overlay-width-class`）、Form 驗證（`nuxt-form-validation.md`）、錯誤本地化（`nuxt-error-localization.md`）、Overlay #body slot（`nuxt-overlay-slot.md`）。

## Overlay 元件語意補充（機械層抓不到的）

> enforcement: mechanical(overlay-width-class) + semantic(overlay-body-slot)

機械層（hook + path-scoped rule）已覆蓋 `#body` slot 與 `max-w-` class 的 deterministic 違規。

Reviewer **額外**需人工判斷：

1. **controlled mode default slot 非空**：overlay 用 `:open` prop + 無 trigger → default slot 應為空；非空 = 內容放錯 slot（grep 查 `<USlideover|<UModal|<UDrawer` 後逐個看）
2. **`#header` 內手寫 close button**：`<UButton icon="i-lucide-x"` → 優先改用 `title` prop + 內建 close，減少冗餘

## Pinia Colada mutation loading 欄位（機械層難抓的靜默 bug）

> enforcement: audit(audit-pinia-mutation-loading.mjs)（單檔偵測器另見 `vendor/scripts/checks/mutation-loading-detect.mjs`；無對應 patterns.json semantic id）

`@pinia/colada` 的 `useMutation()` 回傳的 `status`（`'pending' | 'success' | 'error'`）是 **data-state**，mount 當下就是 `'pending'`（還沒呼叫過、沒 data），**與有沒有執行無關**。拿它當 loading → 按鈕 / spinner 一進頁面就永久 loading，且 typecheck 全綠（`status` 是合法欄位、`'pending'` 是合法值）、不發任何 request、查 log 也查不到。實證：<consumer-a> 30+ 處、<consumer-b> 3 處（含**跨行 destructuring** 寫法，舊單行 grep heuristic 會漏抓）。

Reviewer **MUST** 檢查 diff 內 Pinia Colada loading 推導：

| 違規 | 正解 |
| --- | --- |
| **mutation** 的 `status === 'pending'` 當 loading / disabled | `mutation.isLoading` 或 `asyncStatus === 'loading'`；`status` 留給 success/error 判斷 |
| 為了「修」按鈕順手把 **query** 的 `status === 'pending'` 也改掉 | query 的 `'pending'` = 首載無資料，本來就該 loading，**維持不動** |

**Reviewer 檢查方式**（用 robust detector，**別**用單行 grep — 會漏跨行 destructuring）：

```bash
# 全站掃描（--all）或指定 diff 檔；支援跨行 destructuring + object-form mutation
node vendor/scripts/checks/mutation-loading-detect.mjs --all --warn-only --root .
# 或只掃本次 diff 的 .vue：
node vendor/scripts/checks/mutation-loading-detect.mjs $(git diff --name-only <base>..<head> -- '*.vue')
```

同一偵測器由 pre-commit（blocking）/ pre-push（warn-only）gate 共用，reviewer 看到 gate 已綠時可略過手動掃。正向 canonical pattern 與 query/mutation 欄位語意對照見 golden path [[page-loading-golden-path]] Tier 2.5（含 4 層 enforcement 表）；cross-consumer 盤點走 `scripts/audit-pinia-mutation-loading.mjs`。

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

## evlog 採用一致性

> enforcement: mechanical(server-console-logging, server-raw-throw-error) + semantic(evlog-consistency) + audit(evlog-adoption-audit.mjs)

若專案已採用 evlog（`package.json` 列了 `evlog` 依賴），新寫或大改的程式碼 **MUST** 套用 evlog 模式。

> **機械層已覆蓋**：`evlog-adoption-audit.mjs` 掃 `console.*` in server、consola import、createError no-why 等 block signal。本段是 reviewer 補語意判斷。

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

> enforcement: mechanical(audit-table-direct-insert) + semantic(d-pattern-audit) + audit(d-pattern-audit.mjs)

若專案已採用 D-pattern（`server/utils/audit.ts` 存在），新寫或大改的 mutation handler **MUST** 套用。

> **機械層已覆蓋**：`d-pattern-audit.mjs` 掃 helper bypass / PII in migration / createError no-why / log.audit missing eventId。本段是 reviewer 補語意判斷。

| 禁止 pattern | 應改為 | 說明 |
| --- | --- | --- |
| 在 `business_keys` 內塞 PII / 姓名 / email / raw LLM prompt | 把 PII 放 evlog `context`，`business_keys` 只放結構化業務鍵 | GDPR 刪除權 |
| `requireRole` / `requireAuth` 失敗只 `throw` 沒呼 `auditDeny` | 自動在 helper 內呼 `auditDeny()` | 合規剛需 |
| Multi-tenant audit 表共用 global hash | advisory lock per tenant 或 partition | tenant A 高頻寫入干擾 B |

## Bug 修正文件同步

> enforcement: semantic(doc-sync)

若本次變更包含 `🐛 fix` 類型的 commit，檢查是否已更新 `docs/verify/PRODUCTION_BUG_PATTERNS.md`。

## Nuxt a11y 採用一致性

> enforcement: semantic(a11y-adoption) + audit(audit-review-rules.mjs)

若專案已採用 `@nuxt/a11y`，新寫或大改的 UI 元件 **MUST** 套用 a11y 規則。

> **機械層已覆蓋**：`audit-review-rules.mjs` 掃 img 缺 alt / icon-only 缺 aria-label / div @click / 正數 tabindex。本段是 reviewer 補需 AI 語意判斷的項目。

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
