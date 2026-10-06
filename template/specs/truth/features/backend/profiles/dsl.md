# profiles 模組 DSL

> 屬於 backend 介面根（`../dsl.md`）；測試邊界、合約來源、權威狀態、可攜性沿用該檔宣告。
> 句型欄一字不改地被 `*.feature` 引用。
> 合約引用：`specs/truth/contracts/profiles.yaml`（operationId：`listProfiles`、`getMyProfile`、`getProfileById`）、`specs/truth/data/profiles.dbml`。
> StepDef 實作：`features/steps/profiles.steps.ts`（`pnpm test:bdd` 執行）。本模組句型全部是
> wire-oriented custom step——延遲 fixture 落地、別名綁定 dev-login 回傳 id、cookie 會話、
> 故障注入與 fetch 觀測斷言都不是六個內建指令能表達的；NEVER 在 isa.yml 複寫同名句型。

## id 別名

feature 不直接寫 UUID，改用 `<別名>`（例如 `<使用者甲>`）；同一個別名在同一個 Example 內代表同一個 UUID。UUID 的來源有兩種：出現在 `呼叫者是使用者` 的別名，其 id 是登入後 `POST /api/_dev/login` 回傳的實際使用者 id（`user.id`；TD-026 D4——路由不接受指定 id，由 Better Auth `generateId: 'uuid'` 指派）；其餘別名由 step 實作每次執行時產生合法的 UUID。
同一個 Example 內，`資料庫中有以下 profiles` 與 `資料庫中沒有 profile` 的落地 MUST 延遲到第一個 `When` 才執行（此時所有 `呼叫者是使用者` 已綁定別名），以便 profiles 列使用登入取得的 id。
別名出現在：Data Table 的 `id` 欄、句型參數、`呼叫 GET` 的路徑、`回應 data` 的值與 id 清單。字面 UUID 不支援也不使用（seed id 已合 RFC 9562，驗證種子 id 的逆向 Rule 已於 TD-026 D1/D4 刪除）。

## 角色語意（TD-026 D3）

授權只讀 `profiles.role`（DB），session 不攜帶也不被信任。`呼叫者是使用者 …，角色為 "{角色}"`
的 `{角色}` 值域沿用 DSL 字串（`admin`、`member`、`guest`），實作映射到 DB 值域
（`admin`→`admin`，其餘→`user`），並在 fixture 落地時校驗呼叫者資料列的 `role` 一致；
dev-login 一律不帶 `as`（`as` 只影響回應標籤，不參與授權）。

## 執行期清理

BDD 與 `SPECFORMULA_TEST=1 pnpm dev` 共用本機 supabase DB。每個 scenario 開始前
runner 清空 `profiles` 整表提供 clean slate；整表已在 `BeforeAll` 快照到
`specformula_bdd.profiles_backup`，`AfterAll` 寫回並補齊 `supabase/seed.sql` 的三列
種子（快照缺列時也會補）——BDD run 不會吃掉 seed 或 dev 使用者的列。故障注入的
權限變更在 `After` 復原；若在復原前中斷，下一輪 `BeforeAll` 會把權限正規化並把
殘留備份補回，不需手動 GRANT。

## Given 句型

| DSL 句型 | Gherkin 參數 | Data Table 參數 | 預設參數 | StepDef 實作語意 |
| --- | --- | --- | --- | --- |
| `資料庫中有以下 profiles` | 無 | `id`、`display_name`、`avatar_url`、`role`、`created_at`（皆對應 `profiles` 同名欄位） | `avatar_url` 預設為 NULL；`role` 預設為 user；`created_at` 預設為 now() | 已實作。`怎麼做`：延遲到第一個 `When`，把每一列 upsert 進 `profiles`（`id` 欄的 `<別名>` 先解析成綁定/產生的 UUID）。`權威狀態落地`：`profiles` 中恰有這些列。 |
| `資料庫中沒有 profile "{id}"` | `id`：id 別名。 | 不支援 | 無 | 已實作。`怎麼做`：延遲到第一個 `When`，`DELETE FROM profiles WHERE id = <解析後 id>`。`權威狀態落地`：`profiles.id` 不含該值。 |
| `呼叫者未登入` | 無 | 不支援 | 無 | 已實作。`怎麼做`：之後的請求不帶 session cookie。 |
| `呼叫者是使用者 "{id}"，角色為 "{角色}"` | `id`：id 別名；`角色`：DSL 角色字串（`admin`、`member`、`guest`），語意見上方「角色語意」。字面 UUID 不支援。 | 不支援 | 無 | 已實作。`怎麼做`：以別名導出 email（`bdd-<別名 hex>@test.local`，落在 `DEV_LOGIN_EMAIL_DOMAINS` 預設的 `test.local`），呼叫 `POST /api/_dev/login`（`email`、`password`，不帶 `as`），取回回應的 `user.id` 並綁定為該別名的 id，之後的請求都帶回應的 session cookie。`權威狀態落地`：session 的使用者 id 即別名綁定的 id；`{角色}` 映射到 DB 值域後與呼叫者的 `profiles.role` 一致（落地時校驗）。`前提`：Better Auth 的 user id 必須是 UUID（TD-026 D1 的 `generateId: 'uuid'`），profiles 列才寫得進去。 |
| `profiles 資料表的讀取會失敗` | 無 | 不支援 | 無 | 已實作。`怎麼做`：以本機 Postgres 先清欄位級 grant 再 `REVOKE SELECT ON public.profiles FROM service_role` 撤銷全部讀權；app 所有對 profiles 的 PostgREST 讀取（含角色查詢）回 42501，scenario 結束由 hook 復原，中斷殘留由下一輪 `BeforeAll` 自愈。 |
| `profiles 資料表的資料讀取會失敗` | 無 | 不支援 | 無 | 已實作。`怎麼做`：`REVOKE SELECT ON public.profiles FROM service_role` 撤整表讀權後 `GRANT SELECT (id, role)` 只留角色查詢需要的欄位——角色查詢（`select role` + `eq id`）與 count 查詢（`select id` head）仍通過，資料查詢缺欄位回 42501；scenario 結束由 hook 復原。 |

## When 句型

| DSL 句型 | Gherkin 參數 | Data Table 參數 | 預設參數 | StepDef 實作語意 |
| --- | --- | --- | --- | --- |
| `呼叫 GET "{路徑}"` | `路徑`：含 query string 的請求路徑，`<別名>` 片段先解析成 UUID。 | 不支援 | 無 | 已實作。`怎麼做`：先把延遲的 fixture 落地，再對 server 發出 HTTP GET（帶呼叫者 session cookie，若有）。`回寫`：狀態碼與 JSON 本文，供 Then 句型讀取；同時記下發請求前的時間戳供查詢觀測斷言切割範圍。 |

## Then 句型

| DSL 句型 | Gherkin 參數 | Data Table 參數 | 預設參數 | StepDef 實作語意 |
| --- | --- | --- | --- | --- |
| `回應狀態碼為 {狀態碼}` | `狀態碼`：整數。 | 不支援 | 無 | 已實作。`必查`：`呈現結果`：回應狀態碼相等。 |
| `回應 data 的 "{欄位}" 為 "{值}"` | `欄位`：profile 欄位名；`值`：字串，`null` 字面值代表 JSON null，`<別名>` 解析成 UUID。 | 不支援 | 無 | 已實作。僅用於單筆回應（`data` 是物件）。`必查`：`呈現結果`：該欄位值相等。 |
| `回應 data 的欄位恰為 "{欄位清單}"` | `欄位清單`：以逗號分隔的欄位名。 | 不支援 | 無 | 已實作。僅用於單筆回應。`必查`：`呈現結果`：`data` 的鍵集合與清單相同（不計順序）。 |
| `回應 data 的 id 依序為 "{id清單}"` | `id清單`：以逗號分隔的 id 別名，空字串代表空陣列。 | 不支援 | 無 | 已實作。僅用於列表回應（`data` 是陣列）。`必查`：`呈現結果`：`data[].id` 與清單逐項相同，順序一致。 |
| `回應 pagination 為 page {page}、perPage {perPage}、total {total}、totalPages {totalPages}` | 四個整數。 | 不支援 | 無 | 已實作。`必查`：`呈現結果`：`pagination` 四個欄位相等。 |
| `回應錯誤訊息為 "{訊息}"` | `訊息`：字串。 | 不支援 | 無 | 已實作。`必查`：`呈現結果`：回應的 `message` 相等（回應沒有 `message` 時改比 `statusMessage`）。 |
| `回應不含 PostgREST 診斷欄位` | 無 | 不支援 | 無 | 已實作。`必查`：`呈現結果`：錯誤回應沒有 `code`、`details`、`hint` 欄位（PostgREST 原生錯誤形狀不外漏；why／fix 與 zod issues 走內部日誌，TD-026 D5 wire 實測確認不進 HTTP body）。 |
| `profiles 資料表的資料列沒有被讀取` | 無 | 不支援 | 無 | 已實作。`必查`：`權威狀態`：對 `/test/db-log?since=<請求起始>` 的 PostgREST 觀測紀錄中，這次請求期間沒有任何 `select` 參數不是 `role` 的 profiles 讀取——TD-026 D3 的授權角色查詢（`select=role`）是允許的，其餘讀取都算違規。 |
