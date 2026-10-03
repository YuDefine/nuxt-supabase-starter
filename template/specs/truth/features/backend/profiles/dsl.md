# profiles 模組 DSL

> 屬於 backend 介面根（`../dsl.md`）；測試邊界、合約來源、權威狀態、可攜性沿用該檔宣告。
> 句型欄一字不改地被 `*.feature` 引用；`StepDef 實作語意` 標「未實作」＝目前沒有任何 step definition。
> 合約引用：`specs/truth/contracts/profiles.yaml`（operationId：`listProfiles`、`getMyProfile`、`getProfileById`）、`specs/truth/data/profiles.dbml`。

## id 別名

feature 不直接寫 UUID，改用 `<別名>`（例如 `<使用者甲>`）；同一個別名在同一個 Example 內代表同一個 UUID。UUID 的來源有兩種：出現在 `呼叫者是使用者` 的別名，其 id 是登入後 `POST /api/_dev/login` 回傳的實際使用者 id（`user.id`；路由不接受指定 id，由 Better Auth 指派）；其餘別名由 step 實作每次執行時產生合法的 UUID。
同一個 Example 內，`資料庫中有以下 profiles` 與 `資料庫中沒有 profile` 的落地 MUST 延遲到第一個 `When` 才執行（此時所有 `呼叫者是使用者` 已綁定別名），以便 profiles 列使用登入取得的 id。
別名出現在：Data Table 的 `id` 欄、句型參數、`呼叫 GET` 的路徑、`回應 data` 的值與 id 清單。唯一例外：驗證「出廠種子 id 不符 UUID」的 Rule 直接寫字面 id。

## Given 句型

| DSL 句型 | Gherkin 參數 | Data Table 參數 | 預設參數 | StepDef 實作語意 |
| --- | --- | --- | --- | --- |
| `資料庫中有以下 profiles` | 無 | `id`、`display_name`、`avatar_url`、`role`、`created_at`（皆對應 `profiles` 同名欄位） | `avatar_url` 預設為 NULL；`role` 預設為 user；`created_at` 預設為 now() | 未實作。`怎麼做`：把每一列寫入 `profiles` 資料表。`權威狀態落地`：`profiles` 中恰有這些列。 |
| `資料庫中沒有 profile "{id}"` | `id`：id 別名。 | 不支援 | 無 | 未實作。`怎麼做`：確保 `profiles` 沒有該 id。`權威狀態落地`：`profiles.id` 不含該值。 |
| `呼叫者未登入` | 無 | 不支援 | 無 | 未實作。`怎麼做`：之後的請求不帶 session cookie。 |
| `呼叫者是使用者 "{id}"，角色為 "{角色}"` | `id`：id 別名；`角色`：`admin`、`member` 等 session 角色字串。字面 UUID 不支援（見 Q-profiles-8）。 | 不支援 | 無 | 未實作。`怎麼做`：以別名導出 email（例如 `<別名>@test.local`，落在 `DEV_LOGIN_EMAIL_DOMAINS` 預設的 `test.local`），呼叫 `POST /api/_dev/login`（`email`、`as`＝角色；`as: admin` 的 email 須列入 `ADMIN_EMAIL_ALLOWLIST`），取回回應的 `user.id` 並綁定為該別名的 id，之後的請求都帶回應的 session cookie。`權威狀態落地`：session 的使用者 id 即別名綁定的 id。**角色目前無法落地**：`as` 只出現在 dev-login 的回應 JSON，`syncDevLoginRole` 是刻意的 no-op、`server/auth.config.ts` 沒有 admin plugin 或 `additionalFields.role`，所以 session 的 `user.role` 為空；`角色為 "member"` 的 Example 因「非 admin」恰好成立，`角色為 "admin"` 的 Example 無法實作（見 Q-profiles-9，這些 Example 已標 `[need clarification]`）。`前提`：Better Auth 的 user id 必須是 UUID，profiles 列才寫得進去（Q-profiles-6）。 |
| `profiles 資料表的讀取會失敗` | 無 | 不支援 | 無 | 未實作。`怎麼做`：讓 `profiles` 的 SELECT 回傳資料庫錯誤（例如暫時撤銷 service-role 對該表的權限）。 |

## When 句型

| DSL 句型 | Gherkin 參數 | Data Table 參數 | 預設參數 | StepDef 實作語意 |
| --- | --- | --- | --- | --- |
| `呼叫 GET "{路徑}"` | `路徑`：含 query string 的請求路徑。 | 不支援 | 無 | 未實作。`怎麼做`：對 server 發出 HTTP GET。`回寫`：狀態碼與 JSON 本文，供 Then 句型讀取。 |

## Then 句型

| DSL 句型 | Gherkin 參數 | Data Table 參數 | 預設參數 | StepDef 實作語意 |
| --- | --- | --- | --- | --- |
| `回應狀態碼為 {狀態碼}` | `狀態碼`：整數。 | 不支援 | 無 | 未實作。`必查`：`呈現結果`：回應狀態碼相等。 |
| `回應 data 的 "{欄位}" 為 "{值}"` | `欄位`：profile 欄位名；`值`：字串，`null` 字面值代表 JSON null。 | 不支援 | 無 | 未實作。僅用於單筆回應（`data` 是物件）。`必查`：`呈現結果`：該欄位值相等。 |
| `回應 data 的欄位恰為 "{欄位清單}"` | `欄位清單`：以逗號分隔的欄位名。 | 不支援 | 無 | 未實作。僅用於單筆回應。`必查`：`呈現結果`：`data` 的鍵集合與清單相同（不計順序）。 |
| `回應 data 的 id 依序為 "{id清單}"` | `id清單`：以逗號分隔的 id 別名，空字串代表空陣列。 | 不支援 | 無 | 未實作。僅用於列表回應（`data` 是陣列）。`必查`：`呈現結果`：`data[].id` 與清單逐項相同，順序一致。 |
| `回應 pagination 為 page {page}、perPage {perPage}、total {total}、totalPages {totalPages}` | 四個整數。 | 不支援 | 無 | 未實作。`必查`：`呈現結果`：`pagination` 四個欄位相等。 |
| `回應錯誤訊息為 "{訊息}"` | `訊息`：字串。 | 不支援 | 無 | 未實作。`必查`：`呈現結果`：回應的 `message` 相等（回應沒有 `message` 時改比 `statusMessage`）。 |
| `回應錯誤的 data 含 why 與 fix` | 無 | 不支援 | 無 | 未實作。`必查`：`呈現結果`：`data.why` 與 `data.fix` 皆為非空字串。 |
| `profiles 資料表沒有被查詢` | 無 | 不支援 | 無 | 未實作。`必查`：`權威狀態`：這次請求期間資料庫沒有收到對 `profiles` 的查詢（例如查資料庫統計或 query log）。 |
