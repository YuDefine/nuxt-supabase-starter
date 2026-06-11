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

### Issue fix 後重拍範圍（hard rule，2026-05-30 補強）

當 user 對某個 `[verify:ui]` / `[review:ui]` item 留 `（issue: ...）`、agent fix code 後要交回 user 重驗時：

- **MUST** 重拍「受該次 code 改動影響的**所有** `[verify:ui]` / `[review:ui]` item」的 screenshot，**NEVER** 只重拍被標 issue 那一張。Issue 範圍是 item-scoped，但 code 改動常是 view-scoped（一次改動橫跨整批 item / 整個頁面）— 重拍範圍 **MUST** 對齊 code 改動影響範圍，不是 issue 標記範圍。
- **MUST** 刪掉同 change 截圖目錄內所有無 `#N` 前綴的 legacy 舊圖（`#N` / `#N.M` 命名規約前的初版殘留）— 它們不再配對任何 item，留著只會被 review-gui filename-matching 誤補位。
- **MUST** 在交回 user 重驗前跑 `audit-screenshot-staleness.mts`（或人工比對 mtime vs 最後 UI commit）確認 0 stale（在影響範圍內的）。
- **NEVER** 倚賴 review-gui filename-matching 把舊圖補位當作 evidence 完整 — 舊圖配對的是改動前狀態，user 會對非最新狀態 OK。

判別測試：「這次 fix 改的是哪些檔？這些檔 render 出哪些 item 的畫面？」凡命中的 item 都 **MUST** 重拍，與 issue 標在哪一張無關。

偵測：`vendor/scripts/audit-screenshot-staleness.mts` 的 `stale_screenshot_after_ui_change` signal（screenshot mtime < change 最後 UI commit → STALE）；詳見 `docs/pitfalls/2026-05-30-issue-fix-refreshes-only-flagged-screenshot-leaves-batch-stale.md`。

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

## Parent State Derivation — 真相層責任分工

> 自主檔 [[manual-review]] § Parent State Derivation 移入；parent AND-derive hard rule 與禁止項仍在主檔。

| 真相層 | 責任 |
| --- | --- |
| Review GUI (`applyReviewActionToContent`) | 每次寫回 child line 後 **MUST** 重 derive parent state 並寫回 parent line（auto-rollup / un-rollup） |
| commit Step 0-MR awk gate | **MUST** leaf-only count — parent-with-scoped-children 不計 pending |
| `spectra-advanced/archive-gate.sh` | **MUST** leaf-only count（已正確 — semantic fully aggregated from scoped children） |
| 未來新加的 tooling | **MUST** 沿用 leaf-only count；禁止 naive `grep '- \[ \]'` 或同義 awk 計 pending |

## `(claude-analyzed: ...)` annotation 細節

> 自主檔 [[manual-review]] § `(claude-analyzed: ...)` annotation 移入；Schema 與 Claude 可寫條件仍在主檔。典型寫入情境：修法已落地 + 新 evidence 已收集，等 user 重看新截圖決定 OK / Issue。

### Strip semantics

User 在 GUI 對該 item 點 **OK / Issue / Skip** 時，`stripAnnotations`（in `vendor/scripts/review-gui.mts`）會 **同時** 清掉：

- `（issue: ...）` 與 `（skip[: ...]）` / `（note: ...）` / `（finding: ...）` 等 action annotation（既有行為）
- `(claude-analyzed: ...)` annotation（新增 strip 規則）

設計 rationale：claude-analyzed 的語意一旦 user 動了該 item = 評估已完成，annotation 失效；保留會讓下次 GUI re-render 把 item 錯誤地仍歸到 `awaitingUserReEval` bucket。verified-* 與 claude-discussed annotation **不**受此 strip 影響（它們是 archive evidence trail，需要永久保留）。

### 與 `(claude-discussed:)` 的差異

| 維度 | `(claude-discussed:)` | `(claude-analyzed:)` |
| --- | --- | --- |
| 適用 kind | `[discuss]` | `[review:ui]` / `[verify:ui]`（帶 `（issue:）` 的 item） |
| 觸發流程 | `/spectra-archive` Step 2.5 walkthrough | review-gui 「等 Claude 接手」prompt 路由 (E) |
| Checkbox 行為 | 翻 `[x]` | **不翻**（保 `[ ]`） |
| Strip on user action | 不 strip（archive evidence trail） | strip（user 點 OK / Issue / Skip 即清） |
| User 主動性 | user 必須先看 evidence 才允許 Claude 寫 | Claude 自己分析後寫，user 之後重整 GUI 看到 |

### Home page 影響

當 change 的所有 issued items 都已被 Claude 寫 `(claude-analyzed: route=E)`、且 user-actionable / verify pending / evidence missing / readiness hits 都是 0 → change 落入 **「✋ Claude 已分析、等 user 重新評估」** bucket（review-gui home page），不再被 「🤖 等 Claude 接手」群 prompt 抓走重複分析。User 點 card 進 detail，重看 final-state evidence 後在 GUI 點 OK / Issue / Skip 結束流程。

詳見 `vendor/scripts/review-gui.mts` 內 `analyzedIssuedCount` field、`awaitingUserReEval` bucket dispatch、`stripAnnotations` claude-analyzed strip 段。

### 範例

寫入前（user 點 issue 後 Claude 收到「接手分析」prompt、走完分析路由 (E)）：

```markdown
- [ ] #4.1 [verify:ui] /vending/inventory final-state visual review （issue: 整體 UI 設計難以理解 不好看也不好用 改進方案已實作完成 待重拍新版 screenshot 後 user 重新評估）
```

寫入後（Claude 在路由 (E) 結論時加 annotation）：

```markdown
- [ ] #4.1 [verify:ui] /vending/inventory final-state visual review （issue: 整體 UI 設計難以理解 不好看也不好用 改進方案已實作完成 待重拍新版 screenshot 後 user 重新評估） (claude-analyzed: 2026-05-24T13:00:00Z route=E note=Re-Design)
```

User 在 GUI 對 #4.1 點「✓ 通過」後：

```markdown
- [x] #4.1 [verify:ui] /vending/inventory final-state visual review
```

`（issue:）` 與 `(claude-analyzed:)` 兩條 annotation 同時被 strip，change 進入下一輪流轉。

## `(awaiting-user-decision: ...)` annotation 細節

> 自主檔 [[manual-review]] § `(awaiting-user-decision: ...)` annotation 移入；Schema 與 Claude 可寫條件仍在主檔。

### Strip semantics

User 在 GUI 對該 item 點 **OK / Issue / Skip** 時，`stripAnnotations` 一併清掉 `(awaiting-user-decision: ...)`（與 `(claude-analyzed:)` 同 — ball 一旦回到 user 動作即失效）。verified-* / claude-discussed annotation 不受此 strip 影響。

### CLI 寫入入口

除手寫外，可用 helper 一鍵寫入並驗證 re-bucket：

```bash
node vendor/scripts/mark-claude-analyzed.mjs --change <name> [--consumer <id>] --item '#N' \
     --awaiting-user-decision [--packet <path>]
```

helper 寫入後用 `listPendingChanges` 重算 bucket，印 `oldBucket → newBucket`（典型 `feedbackGiven → awaitingUserDecision` 或 `awaitArchiveWalkthrough → awaitingUserDecision`）。同一 helper 預設模式（不帶 `--awaiting-user-decision`）寫 `(claude-analyzed: route=E)`（item MUST 已帶 `（issue:）`）。

### Home page 影響

帶 `(awaiting-user-decision:)` 的 item 從 Claude-ball 計數（`userActionPending` / `issued` / `verifyPendingCount` / `discussPendingCount`）排除，計入 `awaitingUserDecisionCount`。當 Claude-ball 全清（無 readiness / evidence missing / 未分析 issue / verify pending / D-only walkthrough）、`userActionPending=0` 且 `awaitingUserDecisionCount>0` → change 落 **`awaitingUserDecision`** bucket。詳見 `vendor/scripts/review-gui.mts` 內 `awaitingUserDecisionCount` field + `reviewBucketForChange` 的 awaitingUserDecision 分支。

## ADR (2026-05-22) — Default Kind Flip 未採用，勿再提案

> 自主檔 [[manual-review]] § Default Kind Derivation Rule 移入。

曾被提出的修案：「把 user-facing fallback default 從 `[review:ui]` 改成 `[verify:ui]`」（理由：`[review:ui]` 是最 strict 的「真的需要人」白名單，silent fallback 到 strict kind 等於把 agent 該做的工作推給 user）。

**未採用**，理由：

1. **Root cause 已被 explicit marker enforcement 取代**：`MISSING_KIND_MARKER` pattern（`patterns.json` v1.4.0）在 propose / ingest 階段透過 hook fail-fast 強制每條 sub-item 標 explicit marker。Fallback 只剩 legacy in-flight item 在用，新 case 不會再進。
2. **任何 default 都猜不對**：`[review:ui]` / `[verify:ui]` / `[verify:api]` 三種 kind 走不同 review flow，default 選哪個都會在某類內容上錯。改 default 從「猜成 review:ui」變「猜成 verify:ui」，PATCH /api/... 這種 backend roundtrip 還是錯（正解是 `[verify:api]`）。只有 explicit marker 是正解，default 永遠是「猜」。
3. **會 break legacy review-gui flow**：fallback derived item 從「user 在 GUI 點 OK 過」變成「需 final-state screenshot evidence (`verified-ui` annotation) + 點 OK」，可能在 review-gui 觸發 evidence missing red banner、卡住既有 archive flow。
4. **review-gui chip 已視覺化**：`hasExplicitKind: false` 的 item 顯示 `(fallback)` amber chip，user 看得到、知道要跑 `/spectra-ingest` 補。漸進清 legacy 即可，不需大爆改。

**Future agent**：看到 missing marker 問題的反射性建議**不該**是「改 default」，應該是「補 explicit marker（或 hook 已擋）」。本 ADR 防止 default flip 提案反覆出現。

## `@evidence-via-manual-review` Marker 細節

> 自主檔 [[manual-review]] § `@evidence-via-manual-review` Marker 移入；Marker 核心 schema（trailing token / 不計 threshold / phase task line only）仍在主檔。

### 解決什麼問題

某些 phase task 的「驗證」clause 寫法依賴 review-gui evidence（典型：「驗證：review-screenshot evidence 覆蓋 …」、「驗證：screenshots 路徑寫入 design-review evidence」、「驗證：`[verify:ui]` evidence 覆蓋 …」）。這類 task 的 `[ ]`/`[x]` 狀態跟 review-gui 互相依賴形成 deadlock：

- phase task 卡 `[ ]`（等 evidence）
- review-gui 偵測 < 90% threshold → 暫停 manual review
- manual review 暫停 → 沒法蒐 `[verify:ui]` / `[review:ui]` evidence
- phase task 永遠卡 `[ ]`

`@evidence-via-manual-review` marker 切開這個循環：bearing marker 的 phase task **不計入** threshold，author 可放心讓它停 `[ ]`，evidence 由對應 `## 人工檢查` items 在 review-gui 階段蒐集。

### Canonical line format

```text
- [ ] N.M <description>；驗證：<verification clause referencing review-gui evidence> @evidence-via-manual-review
```

範例：

```markdown
- [ ] 4.5 完成 design `Responsive / Spatial Spec` 對帳：admin pages desktop + 390px mobile 無文字重疊；驗證：review-screenshot / verify:ui evidence 覆蓋 `/admin/users`、`/admin/groups` @evidence-via-manual-review
- [ ] 6.6 執行 review-screenshot 視覺 QA，截 admin pages desktop + 390px mobile；驗證：screenshots 路徑寫入 design-review evidence @evidence-via-manual-review
```

### Marker 與 checkbox 狀態語意

- Marker bearing task 的 `[ ]` / `[x]` 由 author 決定，**不**受 review-gui 強制
- 通常 author 在 impl 寫完後可直接勾 `[x]`，因為 marker 已宣告「verification 在 manual review，不擋 phase task 完成」
- 留 `[ ]` 也合法 — 表示「等待 manual review 完成後再回頭勾」
- Archive gate 是另一道閘門，依 `## 人工檢查` items 完成度判斷，不依 phase task `[x]` 狀態

### 何時該用 marker

寫 phase task 時，「驗證」clause 出現以下任一字眼 **SHOULD** 加 marker：

- `review-screenshot`
- `[verify:ui]` evidence / screenshot evidence / `verify:ui` 評估
- `screenshots 路徑寫入 ...`
- `截圖 ... evidence`
- `review-gui` / `pnpm review`
- 任何把 verification responsibility 推到 manual review 階段的 phrasing

### 何時 **不該** 用 marker

- Phase task 驗證可由 `pnpm typecheck` / `pnpm lint` / `rg` static check 完成 → **不要**加 marker（這類 task 本來就 agent-self-verifiable，計入 threshold 才有意義）
- Phase task 是純 implementation work（寫 endpoint / 抽 composable / 加 schema 欄位）且驗證是 grep static check → **不要**加 marker

### Review-gui 行為

- `countImplementationProgress(content)` 掃 phase task line，bearing marker 的 task 進 `excluded` 計數，不計入 `implTotal` / `implDone`
- `implTotal` / `implDone` 計算 threshold ratio，bearing marker 的 task 完全不影響
- Manual review gate 訊息（`Implementation 未完成 ...`）會附帶 `(+ N 項 @evidence-via-manual-review 已排除)` transparency note 讓 user 看到 marker 生效

### Audit trail

Marker bearing task 不寫額外 audit log（與 `@no-manual-review-check` 不同 — 那條因為是 case-by-case bypass 需要 audit）。`@evidence-via-manual-review` 是 design-time decision，author 寫進 tasks.md 時就明說「這條走 manual review」，archive 階段 tasks.md 進 `docs/manual-review-archive.md` 自然保留語意。

### 與其他 marker 共存

`@evidence-via-manual-review` 只用在 **phase task line**（id 是 `N.M` 格式）；不會跟 `## 人工檢查` 用的 `@no-screenshot` / `@no-manual-review-check` / `@followup[TD-NNN]` 撞，因為那些用在 `#N` / `#N.M` items。phase task line 本身不接其他 trailing marker，所以 canonical ordering 簡單：

```text
- [ ] N.M <description>；<驗證 clause> @evidence-via-manual-review
```

## `(claude-analyzed:)` / `(awaiting-user-decision:)` Schema 欄位與可寫條件（hard rule）

> 自主檔 [[manual-review]] 對應 annotation 段移入；annotation 格式一行版與「不勾 checkbox」核心規則仍在主檔。

### `(claude-analyzed: <ISO-8601> route=<code>[ note=<...>])` 欄位

- **Half-width parens**（machine annotation，與 `(claude-discussed:)` / `(verified-*:)` 同類）
- `<ISO-8601>` **required**（UTC，秒級精度，與其他 annotation 共用 timestamp 慣例）
- `route=<code>` **required**：目前只支援 `E`。Schema 預留為自由 `string` 給未來擴展，但 hard rule 限 `E`
- `note=<one-liner>` optional：剝半形括號、上限 240 chars、**single hyphen-joined token**（`sanitizeNote` 把 whitespace 折成 `-`；與 `verified-ui` 的 `dom=<obs>` 同 convention，避免解析端 `findKeyValue` whitespace split 只拿到第一個 word）
- 落點：description 後、所有 trailing markers (`@followup` / `@no-manual-review-check` / `@no-screenshot`) 前
- 與 `（issue: ...）` co-exist：issue **MUST** 已存在（沒 issue 就不該寫 claude-analyzed）；兩者並存表達「Claude 已分析此 issue，路由結論=等 user 重新評估」

### `(claude-analyzed:)` Claude 可寫條件

- **MUST** 在路由 **(E)** 結論時寫
- **MUST** 在 item 已帶 `（issue:）` annotation 時才寫
- **MUST NOT** 翻 checkbox（保留原 `[ ]`，user 在 GUI 點 OK / Issue / Skip 才翻）
- **MUST NOT** strip 既有 `（issue:）` annotation（兩者語意正交：issue 是 user 回饋，claude-analyzed 是 Claude 分析證跡）
- **MUST NOT** 在路由 (A) / (B) / (C) / (D) 結論時寫 — 那些情境 user 仍需要 Claude 動作（改 proposal / 開 TD / 改 code / 切 clade session），不是「等 user 重新評估」

### `(awaiting-user-decision: <ISO-8601>[ packet=<path>])` 欄位

- **Half-width parens**（machine annotation，與 `(claude-analyzed:)` 同類）
- `<ISO-8601>` **required**（UTC，秒級精度）
- `packet=<path>` optional：decision packet（給 user 拍板的證據 / 摘要）相對路徑。**Single hyphen-joined token**（write 時 `sanitizeNote` 後 whitespace 折成 `-`），與 `verified-ui` 的 `screenshot=<path>` 同 convention
- 落點：description 後、所有 trailing markers 前
- **不**要求 item 已帶 `（issue:）`（D-only / review:ui pending 都可標 — 跟 claude-analyzed 的差別）

### `(awaiting-user-decision:)` Claude 可寫條件

- **MUST** 在判定該 item 是純 user 商業決策、且已準備 decision packet 後才寫
- **MUST NOT** 翻 checkbox（保留原 `[ ]`，user 在 GUI 點 OK / Issue / Skip 才翻）
- **MUST NOT** 用此 annotation 規避該 item 其實 actionable 的情況 — 若 issue 可走 (A) UX/copy / (B) behavior / (C) spec gap，**MUST** 走那些路徑，不可標 awaiting-user-decision 推給 user

## `@apply-blocked[<reason>]` marker 細節

> 自主檔 [[manual-review]] § `@apply-blocked[<reason>]` marker 移入；marker 核心定義與「解 blocker 後 MUST 移除」仍在主檔。

- 與 `@evidence-via-manual-review` / `@no-screenshot` 同 marker 詞彙，但用在 tasks.md 檔層級（非 `## 人工檢查` item 行）
- `<reason>` 簡述卡點（如 `等 PM 決策金流串接範圍`）
- impl 未完成（< 90% threshold）**且**含此 marker → change 從 `applyInProgress` 分到 **`applyBlocked`** bucket（review-gui「⏸ applyBlocked（交還 user）」群），master button 排除
- 解 blocker 後 **MUST** 移除 marker → change 自動回 `applyInProgress` 繼續
- 同時**SHOULD** 寫 HANDOFF blocker entry 給 paper trail（marker 是 machine-readable source、HANDOFF 是人讀說明）
