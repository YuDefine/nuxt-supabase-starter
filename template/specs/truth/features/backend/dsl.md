# backend 共用 DSL（HTTP wire）

> **介面**：backend（`specs/truth/features/backend/`）。本檔是介面根：只收兩個以上模組的 feature 共用的句型，
> 以及這些句型依賴的對照表；只被一個模組使用的句型放在該模組的 `<模組>/dsl.md`。
> **測試邊界**：系統外（wire）。規格從 HTTP 進入完整啟動的 Nuxt／Nitro server，資料落在本機 Supabase（PostgreSQL）。
> 驗證一律另開資料庫連線直讀資料表，不讀應用程式的記憶體物件。Runner 是 SpecFormula + Cucumber
> （`pnpm test:bdd`；bootstrap 見 `features/support/environment.ts`，實際上線需先 `supabase start`
> 並起 Nuxt dev server，見 `features/support/README` 與 TD-026）。
> **合約來源**：HTTP 合約 `specs/truth/contracts/openapi.yaml`（以 operationId 或 HTTP 方法與路徑引用）；
> 資料合約 `specs/truth/data/`（入口 `data-model.dbml`）。Better Auth 的 session 與 cookie 沒有獨立合約檔，這是已知缺口。
> **合約同步**：code-first。合約由人依程式碼逆向寫成，程式碼出處記在 OpenAPI 的 `x-source` 與 DBML 的 Note；
> `specs/plans/001-baseline-reverse/tools/check-truth.mjs` 只檢查 `x-source` 能解析到檔案與行號、三處模組鍵一致、
> feature 句型與 `dsl.md` 對得上。目前沒有自動比對程式碼行為與合約的 CI gate，這是已知缺口。
> **權威狀態**：資料庫中的資料表列（`profiles` 等）。HTTP 回應只用於對外契約判讀；錯誤 `data.why`／`data.fix` 的文字不作為主張依據，只檢查存在。
> **可攜性**：實作語意只使用協定詞彙（HTTP 方法／路徑／operationId、資料表.欄位、請求內容的 schema property 名稱）。**列內出現任何程式語言識別字即違規。**

## 資料前提

測試資料庫的 schema 來自 `supabase/migrations/*.sql`（`supabase start` 套用）。`supabase/seed.sql` 是開發用種子資料；
feature 的 Given 自行建立所需列，不依賴種子（TD-026 D1 起種子 id 已合 RFC 9562，可直接引用）。

## 跨模組共用句型

目前只展開一個模組（profiles），沒有被兩個以上模組使用的句型；全部句型在 `profiles/dsl.md`。
展開第二個模組時，登入與 HTTP 呼叫類句型（`呼叫者未登入`、`呼叫者是使用者…`、`呼叫 GET`、`回應狀態碼為`）由專責一方提升到本檔，
並依規約 MUST 5 刪掉模組內的舊位置。
