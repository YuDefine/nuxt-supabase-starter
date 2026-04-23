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

## 元件替代規則

| 禁止使用                                                                                                                                                                                | 應替換為                                                                                                                  | 說明                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<img>`                                                                                                                                                                                 | `<NuxtImg>`                                                                                                               | 使用 Nuxt Image 模組，支援自動最佳化、lazy loading、responsive sizes。除非有 `<!-- raw-img -->` 註解明確標記例外。                                                                                                                                       |
| 原生 HTML date / time 輸入：`<input type="date">`、`<input type="datetime-local">`、`<input type="time">`、`<input type="month">`、`<input type="week">`，或包成 `<UInput type="date">` | `<UCalendar>`（[@nuxt/ui Calendar](https://ui.nuxt.com/docs/components/calendar)），搭配 `UPopover` 做為 date picker 觸發 | 原生 date picker 在不同瀏覽器外觀不一致、無法套用 design system theming、a11y 行為不可控、無法本地化日期格式（zh-TW vs en-US）、無法支援 disabled date / range 等需求。例外：純後端工具腳本、admin debug 內部頁面可豁免，**MUST** 在 PR 註明理由與位置。 |

## 資料庫存取模式

| 禁止使用                                              | 位置                     | 說明                                                                                                                                    |
| ----------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `.insert()` / `.update()` / `.delete()` / `.upsert()` | `app/` 目錄（client 端） | Client 端只能用 `.select()` 讀取。所有寫入必須透過 `server/api/v1/*` 的 Server API。                                                    |
| `mcp__remote-supabase__apply_migration` 執行 DDL      | 任何位置                 | MCP 使用 `supabase_admin` role，建立的物件 owner 錯誤會導致 CI/CD 部署失敗。DDL 必須透過 `supabase migration new` 建立 migration 檔案。 |
| `mcp__remote-supabase__execute_sql` 執行 DDL          | 任何位置                 | 同上。Remote MCP 只能用於 SELECT 查詢、除錯、檢查 table owner。                                                                         |

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

**檢查動作**：

1. 掃 `app/**/*.vue` 中的 `<UButton[^>]*:disabled=` — 若 disabled 條件引用多個 form state，flag 為 🟠 Major，建議改用 UForm
2. 掃 auto-generate slug / id 邏輯 — 確認有空值 fallback
3. 掃 `<UFormField>` — 若對應 schema 欄位是 `.min(1)` 或非 optional，UFormField 必須有 `required` 且 `name` 屬性
