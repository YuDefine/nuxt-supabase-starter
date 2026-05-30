---
description: Manual Review evidence 規約——寫 / 審 tasks.md 的 ## 人工檢查 區塊時 path-scoped 載入
paths: ['openspec/changes/**/tasks.md', 'docs/manual-review-archive.md']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/manual-review.evidence.md
Edit at: <clade-central-repo>
Local edits will be reverted by the next sync.
-->


# Manual Review — Evidence & Authoring Schema

> Reference 檔。核心規約見 [`manual-review.md`](./manual-review.md)。本檔聚焦 `tasks.md` 的 `## 人工檢查` 區塊在 propose / ingest / apply / archive 階段的詳細 authoring schema：可解析格式、kind 分類指引、`@no-screenshot` / `@no-manual-review-check` marker schema，以及 ### 給 propose / spec 寫作者 的格式建議。

## 給 propose / spec 寫作者

寫 `## 人工檢查` 項目時，**MUST** 用「動詞 → 結果」格式描述真實使用者操作：

```markdown
✅ 好：
- [ ] #N Admin 在 `/asset-loans` 點品項 → 開 slideover → 點某筆 active loan 旁「手動歸還」→ dialog 開啟 → 選「正常」+ 不填備註 → 送出 → 200 OK，loan 狀態變 returned，列表自動刷新

❌ 不夠：
- [ ] #N 確認手動歸還按鈕能用
```

「能用」是模糊驗收，落到實作會被解讀為「能點到 / 看到 dialog」，漏掉真實送出 + DB 變更。

## 可解析格式（hard rule）

`tasks.md` 的 `## 人工檢查` 區塊必須使用可被工具穩定解析的 `#N` schema。

Parent item 格式：

```markdown
- [ ] #1 確認主要流程可完成
- [x] #2 確認錯誤狀態可理解（skip）
```

Scoped sub-item 格式必須剛好縮排兩個空白，並使用 `#N.M`：

```markdown
- [ ] #3 確認行動版流程
  - [ ] #3.1 390px viewport 無水平溢出
  - [x] #3.2 keyboard focus state 清楚
```

禁止在 `## 人工檢查` checkbox line 使用 legacy section ids，例如 `8.1`、`9.3`，也禁止省略 `#N` / `#N.M`。這個 schema 只讓 tooling 能定位與寫回項目，不改變人工檢查 ownership：agent 仍然 **NEVER** 在未取得使用者明確 OK、Issue handling、skip 或 skip all 前自行勾選 `[review:ui]` items；`[discuss]` items 的勾選規則見 `manual-review.md` 「Item Kind Marker」核心定義。

## Kind 分類指引（給 propose / spec 寫作者）

寫 `## 人工檢查` 時依以下指引判斷 marker：

**`[discuss]`（後端 evidence collection）**

- SSH、`docker exec`、`psql`、`\d <table>`、`SELECT ... FROM`、`curl` 觸發 endpoint 或 cron、受控 drift 製造、migration 存在性驗證、合理性檢查
- production 授權 / 商業判斷 / production 觀察項目

**`[verify:e2e]`（Playwright spec 完整 journey）**

- mutation persistence across reload
- 多角色 authz + state changes 的完整 journey
- 需要 page navigation + state assertion 的流程
- 需要 CI / local spec 可重跑的 regression evidence

**`[verify:api]`（HTTP round-trip）**

- 純 backend contract / endpoint authz
- admin 200 / manager 403 / staff 403 這類 per-role status matrix
- 只需要 METHOD / URL / STATUS / optional body hash 即可驗證的 mutation
- 可由 curl / ofetch 重現的 evidence collection

**`[verify:ui]`（final-state visual evidence）**

- 純 final-state 視覺狀態：toast / banner / badge / sort order / readonly hint / counter
- 已有 seed / URL，可直接開頁後截 final-state screenshot
- 不需要 agent 執行 mutation / 填表 / 多角色切換

**Multi-marker（多 channel evidence）**

- mutation + visual confirmation → `[verify:api+ui]`
- persistence journey + 額外 visual artifact → `[verify:e2e+ui]`
- endpoint matrix + screenshot summary → `[verify:api+ui]`

**`[review:ui]`（真的需要人）白名單**

- 收 email / 收 webhook（agent inbox 不可達）
- 視覺主觀判斷（美感、a11y 第三方主觀）
- 實體裝置（kiosk QR scan、印表機、條碼槍）
- 跨 session / 跨機器（手機真機、平板真機、生產環境授權後操作）
- 規格外的非 UI 環境（電話、SMS）

混淆時的判定原則：

- 主線能用 Playwright spec 重現 journey / persistence？→ `[verify:e2e]`
- 主線能用 curl / ofetch 重現 HTTP round-trip？→ `[verify:api]`
- 只需 final-state screenshot + DOM observation？→ `[verify:ui]`
- 同一 business assertion 需要多種 evidence？→ `[verify:<a>+<b>]`
- 需要 SSH / psql 等不可由 HTTP 重現的 walkthrough？→ `[discuss]`
- 都不能（必須人親自操作）→ `[review:ui]`

### 反面範例

```markdown
❌ - [ ] #1 [review:ui] admin /settings 改排程到 09:00 → reload 仍 09:00
   理由：persistence journey 可由 Playwright spec 重現；應該標 [verify:e2e]

❌ - [ ] #4 [review:ui] /work-reports 對某張 voided 單嘗試 Archive（按鈕應隱藏；若仍有路徑進入則 422 友善訊息），對某張 archived 單嘗試 Void（對稱驗收）
   理由：「按鈕應隱藏」是 final-state DOM observation（agent 自驗 → [verify:ui]）；
         「422 contract」是 HTTP round-trip（curl 自驗 → [verify:api]）；
         整條沒有真的需要 user 親自做的部分，且還犯「某張」模糊指代（見 manual-review.data-readiness.md）。
         **MUST** 拆成 [verify:ui] + [verify:api] 兩條，sample 引用具體 ID

✅ - [ ] #1 [verify:e2e] admin /settings 改排程到 09:00 → 200 toast → reload 仍 09:00
✅ - [ ] #1 [verify:api+ui] admin /settings 改排程到 09:00 → PATCH 200 + 畫面顯示新值
✅ - [ ] #4a [verify:ui] /work-reports 互斥狀態 detail slideover — voided 樣本 `WR-9001` 操作區不含「封存」按鈕；archived 樣本 `WR-9002` 操作區不含「作廢」按鈕
✅ - [ ] #4b [verify:api] 對 `WR-9001` (voided) 打 `POST /api/v1/work-reports/:id/archive` → 422 + 中文 message「已作廢的工單無法封存」；對 `WR-9002` (archived) 打 `POST /api/v1/work-reports/:id/void` → 422 對稱
✅ - [ ] #2 [review:ui] cron 觸發 → 借用人實體 inbox 收到逾期通知 email（agent inbox 不可達）
✅ - [ ] #3 [discuss] production seed 授權與 cron 監控確認
```

### `[review:ui]` 收斂原則（hard rule）

只有命中上方「真的需要人」白名單（email / webhook / 實體裝置 / 視覺主觀 / 真機 / SMS）的情境才能標 `[review:ui]`。命中以下任一情境 **MUST NOT** 標 `[review:ui]`：

- 按鈕應隱藏 / disabled / readonly / 顯示特定 badge / sort order 對 → `[verify:ui]`
- form submit → response → state update → `[verify:api]` 或 `[verify:e2e]`
- 多角色 authz status matrix（admin 200 / staff 403）→ `[verify:api]`
- persistence across reload → `[verify:e2e]`
- 後端 SSH / psql / cron / drift 驗證 → `[discuss]`

把這些誤標 `[review:ui]` = 把該由 agent 自驗的工作丟回 user，違反 propose 階段對 user 時間的尊重。

### `[verify:ui]` 對 sample-key-bound item 的反例（hard rule，2026-05-24 補強）

`[verify:ui]` 預設 agent 可在 no-click scope（open URL → wait load → final-state screenshot → DOM observation）內驗完。但**當 item 描述要求 agent「找到某個特定 sample」**且 sample identifier 無法被 agent 從 page-load screenshot 直接 unambiguously 對應到 row 時，agent 在 scope 內**就是 fab 風險區**——這類**MUST** 標 `[review:ui]`。

判別方法：item 描述含「找到 / 定位 / 搜尋 / locate / find / search」+ business-key 識別符（`EMP-\d+` / `contract-[a-z\-]+\d+` / 8-4-4-4-12 UUID），**且**該 key 不會 natively 顯示在 target URL 載入後的 viewport 內，則 agent 無法 truthfully bridge `sample-key → UI row` 對應。

**實證**：2026-05-24 <consumer-a> `app-status-badge-extraction`：

- task 寫「找到周怡君 `EMP-009` 補打下班卡」
- target `/admin/attendance/amendments` 員工 column 因 API 400 fallback 全顯示「-」
- agent screenshot 看不到「EMP-009 / 周怡君」字樣
- agent 仍寫 `(verified-ui: ... dom=EMP-009-pending-row-...)` annotation
- user 抓 9 個 annotation 全 fab，要求 strip + promote rule

**反例**：

```markdown
❌ - [ ] #2.1 [verify:ui] /admin/attendance/amendments 狀態 filter 選「待審核」，
        找到周怡君 `EMP-009` 補打下班卡；status badge 文字為「待審核」、warning、sm
   理由：(a) 需 click filter（verify:ui 禁 click）；(b) `EMP-009` 不在 UI 任何 column
         直接顯示（員工 column 是 `employee_id → employeeNameMap` lookup，可能因 API 400
         全 fallback「-」）；agent screenshot 無法 unambiguously identify 該 row
         → MUST 標 [review:ui]

❌ - [ ] #4.1 [verify:ui] /admin/schedules 搜尋或定位 `contract-intern-001` 對應班表
   理由：合約 ID column 只顯示 truncated UUID 前幾碼（`15f4562e...`），無 business key
         `contract-intern-001` 字樣；agent 在 no-type scope 無法 search
         → MUST 標 [review:ui]

❌ - [ ] #7.1 [verify:ui] /admin/petition 找到 petition `11111111-1111-1111-1111-111111111111`
   理由：petition uuid 不在 displayed column（申請人 column 顯示不同 uuid `9d408709-...`）
         → MUST 標 [review:ui]
```

**正例 1**：sample identifier 本身**就會**顯示在 page-load viewport（page natively displays the key）：

```markdown
✅ - [ ] #1 [verify:ui] /admin/employees 列表第一行 employee_no `EMP-001` row
        顯示「在職」success badge
   理由：employee_no `EMP-001` 是 list page 第一個 column（`<EmployeeColumn employee_no="...">`），
         agent page-load screenshot 直接看到字串，可 unambiguously 對應 row。
```

**正例 2**：description 同時 inline display name + business key（agent 用 display name 對 row）：

```markdown
✅ - [ ] #8.1 [verify:ui] /admin/contracts 列表 row「Charles Yu 開發管理員合約」(對應
        seed contract-perm-001) 顯示「生效中」success badge
   理由：合約名稱 column 直接顯示「Charles Yu 開發管理員合約」字串，agent 可由 display
         name 對 row；business key contract-perm-001 在括號內僅為 cross-reference 不
         依賴 UI 顯示。
```

**正例 3**：item 完全不依賴 sample identification，只看 page-load aggregate visual：

```markdown
✅ - [ ] #4 [verify:ui] /admin/schedules 載入後，列表所有 row 的「狀態」column
        顯示「生效中」success badge（aggregate 視覺對齊：所有 active schedule 都 success tone，
        無 raw English status key 漏網）
   理由：assertion 是「all rows 都 success」aggregate property，agent screenshot 看
         pixel column 即可驗，不需要 identify 個別 row 對應哪 sample。
```

**修正路徑（命中反例時）**：

- (a) **重寫 description 用 display name + verify page 真的顯示**：grep `.vue` template 確認 column 真的 render employee_no / contract_id / petition_id；若是，重寫 description 用該 column 顯示的字串（display name OR business key），保持 `[verify:ui]`
- (b) **改成 `[review:ui]`**：user 親自在 browser 對 sample（用 domain 知識 + filter / search 互動）
- (c) **拆 multi-marker**：若涉及 mutation + visual，拆 `[verify:api]` 自驗 mutation + `[review:ui]` user 親驗 visual

**Pre-Review Data Readiness hook `VERIFY_UI_SAMPLE_KEY_DISPLAY_CHECK`**（patterns.json v1.5.0+；前身 `VERIFY_UI_SAMPLE_KEY_BOUND` v1.4.2）會在 propose / ingest 時自動掃 description regex 命中後，額外跑 reverse page-grep（解析 item URL → 反推 `.vue` page → grep identifier-column token + literal key），把具體 grep 結果 enrich 進 remediation，建議保 `[verify:ui]` 或 reclassify `[review:ui]`，避免 mid-flight 才撞牆。

### `[verify:*]` 編輯/狀態變更類動作對 fixture 可編輯性的要求（hard rule，2026-05-30 TD-176）

`[verify:*]` item 描述含**編輯/狀態變更類動作**（編輯 / 修改 / 更新 / 作廢 / 封存 / 送出 / 核准 / 取消 / 刪除）且引用**具體 sample**（business key / UID / 單號）時，該 sample **MUST** 處於可執行該動作的狀態（editable / not-completed / not-readonly / 未結案）。

引用 completed / readonly / 已結案 / 已鎖定 的 sample 做編輯類動作 → **fixture 狀態與動作不相容**：agent 無法 truthfully 完成 round-trip（按鈕 disabled / 路徑 422 / 表單唯讀），evidence sweep 會正確判「缺證據」逼 user 當 relay channel。**MUST** 二擇一修正：

- **改引用可編輯狀態的 sample**（同 fixture 集合內挑一筆 draft / pending / 進行中的單），保持原 channel；或
- 若該動作**本質需真人親自操作**（白名單情境）→ 改 `[review:ui]`。

**實證**（TD-176，<consumer-b> `tool-usage-count-cost-formula` #3.1）：

```markdown
❌ - [ ] #3.1 [verify:ui] /purchase 編輯 PO `991510` 的數量 → 存 → 顯示更新後數量
   理由：PO 991510 是 completed（唯讀）採購單，編輯按鈕 disabled / 路徑唯讀；
         (a) 「編輯 → 存」本就是互動 round-trip（verify:ui 禁 mutation）；
         (b) fixture 狀態（completed）與動作（編輯）不相容
         → 改引用一筆 draft/pending 狀態的 PO sample 並標 [verify:e2e]/[verify:api]（persistence/round-trip），
           或若必須真人操作 → [review:ui]
```

判別與本檔 §「`[review:ui]` 收斂原則」（form submit / persistence → verify:api/e2e）+ `manual-review.data-readiness.md` § signal-less 分流（需互動才出現的狀態 → verify:e2e/api；純主觀視覺 → review:ui）一致。**目前無機械 gate**（fixture runtime 狀態無法從 tasks.md 文字機械判斷）— 靠本 guidance 在 propose 寫作時導正。

## `@no-screenshot` Marker（hard rule）

當人工檢查項目是純 functional round-trip，且 screenshot review 無法提供有效視覺證據時，可在該 checkbox line 行尾加上 `@no-screenshot` marker。這個 marker 表示 `pnpm review:ui` 應把該 item 視為 round-trip-only manual-review item：使用者親自操作後可直接勾 OK，不需要截圖，viewer 顯示 round-trip-only UI，且不顯示「複製 handoff prompt」。

Marker 語法：

- `@no-screenshot` **MUST** 是單一 trailing token，位於整行最後。
- `@no-screenshot` 前方 **MUST** 只有一個空白。
- 同一行 **MUST NOT** 出現多個 `@no-screenshot` marker。
- Parent item（`#N`）與 scoped sub-item（`#N.M`）都支援此 marker。
- `@no-screenshot` 出現在 description 中間時只是 plain text，**MUST NOT** 被解析成 marker。

Parent item 範例：

```markdown
- [ ] #5 Admin 送出表單 → 200 OK，列表顯示新狀態 @no-screenshot
```

Scoped sub-item 範例：

```markdown
- [ ] #6 權限拒絕流程
  - [ ] #6.1 非管理者送出 → 403，畫面保留原狀並顯示可理解錯誤 @no-screenshot
```

與 `@followup[TD-NNN]` 共存時，canonical ordering **MUST** 是：

```markdown
- [ ] #7 送出時觸發樂觀鎖 409 → 顯示 conflict copy 並保留輸入 @followup[TD-001] @no-screenshot
```

`@no-screenshot` 永遠是最後一個 trailing token；`@followup[TD-NNN]` 必須放在它前面。若寫成 `... @no-screenshot @followup[TD-001]`，就不是 canonical format，tooling 不保證可穩定解析。
