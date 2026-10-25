---
name: server-api
description: "Use when adding or changing Nitro API handlers, including request validation and server-side data access. Not for frontend global state."
---


# Server API

`requireRole`、`getSupabaseWithContext`／`getAuthedSupabase` 等 helper 是 consumer 自己實作的函式，使用前查其來源與授權行為。回應 envelope 與錯誤碼照 consumer 已安裝的 runtime 規約 `api-patterns`（與該 repo 自己宣告的 envelope），本 skill 不另訂；這裡只放與預設不同的慣例，以及列表、搜尋、聚合端點的查詢契約。

# SOP

## Phase 1 -- 判定 auth stack 與資料路徑

1. READ 讀取 consumer manifest（canonical `.clade/manifest.json`；canonical 缺席的未遷移 consumer 讀 legacy `.claude/hub.json`）的 `modules.auth` 與 `server/utils/` 的 helper 實作。
2. THINK 依 [[auth-data-path-consistency]] § Auth 策略與資料路徑的合法組合、已安裝的 db-runtime 規約（`database-access` 或 `database`）與 runtime 規約 `api-patterns`，決定讀寫路徑、helper 名、授權層與回應 envelope。

## Phase 2 -- 契約與 handler

1. READ 讀取 `rules/API慣例判準.md`。
2. READ 若要新增或修改列表、搜尋或聚合端點，先讀取 `rules/列表查詢契約判準.md`，再照它定這類端點的 query 參數、篩選、搜尋跳脫與分頁回應欄位。
3. WRITE 依已載入規則在 `shared/schemas/` 定義 request／response schema，在 `server/api/v1/` 實作 handler。
4. WRITE 接 user input 的 schema 依已載入規則補 boundary test；DELEGATE `rg -n "z\.string\(\).*\.optional\(\)" shared/schemas/ server/api/`，逐筆比對 client 是否會送 null。
5. READ 回頭逐條對照已載入規則；不符就修正。
