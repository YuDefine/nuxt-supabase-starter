---
description: Manual Review evidence 規約——寫 / 審 tasks.md 的 ## 人工檢查 區塊時 path-scoped 載入
paths: ['tasks/**', 'specs/plans/**']
---
<!-- Clade native rule; source: rules/core/manual-review.evidence.md; edit canonical source -->
<!-- clade-targets: claude,codex -->
<!-- clade-adapters: claude,codex -->

# Manual Review — Evidence & Authoring Schema

> 核心規約見 [[manual-review]]。本檔是 `## 人工檢查` 區塊的 authoring schema。

## 給 propose / spec 寫作者

寫 `## 人工檢查` 項目時，**MUST** 用「動詞 → 結果」格式描述真實使用者操作：

```markdown
✅ 好：
- [ ] #N Admin 在 `/asset-loans` 點品項 → 開 slideover → 點某筆 active loan 旁「手動歸還」→ dialog 開啟 → 選「正常」+ 不填備註 → 送出 → 200 OK，loan 狀態變 returned，列表自動刷新

❌ 不夠：
- [ ] #N 確認手動歸還按鈕能用
```

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

禁止 legacy section ids（`8.1`、`9.3`）或省略 `#N` / `#N.M`。schema 不改變勾選 ownership（見 [[manual-review]] § Checkbox ownership）。

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

### Issue fix 後重拍範圍（hard rule）

當 user 對某個 `[verify:ui]` / `[review:ui]` item 留 `（issue: ...）`、agent fix code 後要交回 user 重驗時：

- **MUST** 重拍受該次 code 改動影響的**所有** `[verify:ui]` / `[review:ui]` item，**NEVER** 只重拍被標 issue 那一張——判別：「這次 fix 改的檔 render 出哪些 item 的畫面？」
- **MUST** 刪掉同 change 截圖目錄內無 `#N` 前綴的 legacy 舊圖（會被 filename-matching 誤補位）
- **MUST** 交回前逐張核對影響範圍內截圖 mtime 晚於最後一次 UI commit（無機械 staleness audit）（[[pitfall-issue-fix-refreshes-only-flagged-screenshot-leaves-batch-stale]]）

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

誤標 `[review:ui]` = 把該由 agent 自驗的工作丟回 user。

### `[verify:ui]` 對 sample-key-bound item 的反例（hard rule，2026-05-24 補強）

`[verify:ui]` 是 no-click scope（open URL → wait load → screenshot → DOM observation）。item 描述要求「找到 / 定位 / 搜尋」某個 business-key（`EMP-\d+` / `contract-…` / UUID），**且**該 key 不會 natively 顯示在頁面載入後的 viewport 內時，agent 無法 truthfully 對應 `sample-key → UI row`，寫出的 `(verified-ui:)` 就是捏造——這類 **MUST** 修正（見下方修正路徑）。

**反例**：

```markdown
❌ - [ ] #2.1 [verify:ui] /admin/attendance/amendments 狀態 filter 選「待審核」，
        找到周怡君 `EMP-009` 補打下班卡；status badge 文字為「待審核」、warning、sm
   理由：(a) 需 click filter（verify:ui 禁 click）；(b) `EMP-009` 不在 UI 任何 column
         直接顯示（員工 column 是 `employee_id → employeeNameMap` lookup，可能因 API 400
         全 fallback「-」）；agent screenshot 無法 unambiguously identify 該 row
         → MUST 標 [review:ui]

```

**正例**：key 本身就顯示在 page-load viewport（例：list 第一欄就是 employee_no `EMP-001`）；或 description 同時寫 display name（「Charles Yu 開發管理員合約」）讓 agent 用畫面文字對 row；或 assertion 是 aggregate（「所有 row 的狀態欄都是 success badge」）不需辨識個別 row。

**修正路徑（命中反例時）**：

- (a) **重寫 description 用 display name + verify page 真的顯示**：grep `.vue` template 確認 column 真的 render employee_no / contract_id / petition_id；若是，重寫 description 用該 column 顯示的字串（display name OR business key），保持 `[verify:ui]`
- (b) **改成 `[review:ui]`**：user 親自在 browser 對 sample（用 domain 知識 + filter / search 互動）
- (c) **拆 multi-marker**：若涉及 mutation + visual，拆 `[verify:api]` 自驗 mutation + `[review:ui]` user 親驗 visual

hook `VERIFY_UI_SAMPLE_KEY_DISPLAY_CHECK` 會在寫入時跑 reverse page-grep，把結果 enrich 進 remediation。

### `[verify:*]` 編輯/狀態變更類動作對 fixture 可編輯性的要求（hard rule）

`[verify:*]` item 描述含**編輯/狀態變更類動作**（編輯 / 修改 / 更新 / 作廢 / 封存 / 送出 / 核准 / 取消 / 刪除）且引用**具體 sample**（business key / UID / 單號）時，該 sample **MUST** 處於可執行該動作的狀態（editable / not-completed / not-readonly / 未結案）。

引用 completed / readonly 的 sample 做編輯類動作，agent 無法 truthfully 完成 round-trip。**MUST** 二擇一修正：

- **改引用可編輯狀態的 sample**（同 fixture 集合內挑一筆 draft / pending / 進行中的單），保持原 channel；或
- 若該動作**本質需真人親自操作**（白名單情境）→ 改 `[review:ui]`。

**反例**：

```markdown
❌ - [ ] #3.1 [verify:ui] /purchase 編輯 PO `991510` 的數量 → 存 → 顯示更新後數量
   理由：PO 991510 是 completed（唯讀）採購單，編輯按鈕 disabled / 路徑唯讀；
         (a) 「編輯 → 存」本就是互動 round-trip（verify:ui 禁 mutation）；
         (b) fixture 狀態（completed）與動作（編輯）不相容
         → 改引用一筆 draft/pending 狀態的 PO sample 並標 [verify:e2e]/[verify:api]（persistence/round-trip），
           或若必須真人操作 → [review:ui]
```

**無機械 gate**（fixture runtime 狀態無法從文字判斷），寫作當下自己對照。

## `@no-screenshot` Marker（hard rule）

> **本節的 marker 語法由 `vendor/scripts/manual-review-check.sh` 解析**（trailing token 判定，回歸測試
> `test/manual-review-check.test.ts`）。沒有測試抽本節範例——改語法時 MUST 同步改 checker 與它的測試。

純 functional round-trip、screenshot 無法提供視覺證據的 item，行尾加 `@no-screenshot`：使用者親自操作後直接勾 OK，不需截圖。

Marker 語法：

- `@no-screenshot` **MUST** 是單一 trailing token，位於整行最後。
- `@no-screenshot` 前方 **MUST** 只有一個空白。
- 同一行 **MUST NOT** 出現多個 `@no-screenshot` marker。
- Parent item（`#N`）與 scoped sub-item（`#N.M`）都支援此 marker。
- `@no-screenshot` 出現在 description 中間時只是 plain text，**MUST NOT** 被解析成 marker。

與 `@followup[TD-NNN]` 共存時 `@no-screenshot` 永遠最後：

```markdown
- [ ] #7 送出時觸發樂觀鎖 409 → 顯示 conflict copy 並保留輸入 @followup[TD-001] @no-screenshot
```

## Evidence 收集與狀態判讀的硬規則

> 自 `review-gui-surface.md`（隨 review-gui 退役刪除）移入：與面板無關、仍適用每一個 consumer 的部分。

1. **Compound item evidence**：一個 `[verify:ui]` / `[review:ui]` item 含多個 visual state（hover / focus / before-after / step1→step2）→ **MUST** 拆成 scoped sub-items（`#N.M` 各帶獨立 evidence），或對同一 `(itemId, kind)` 多次 `evidence-store.ts --write`（sidecar append-only）。**NEVER** 用一張截圖代表多個 state——evidence 在不在只看有沒有記錄，其餘 state 會靜默漏驗；**NEVER** 寫複數 key `screenshots=`（parser 不認）。
2. **Performance 實測自動檢測**：review / verify **每一個** web UI change 時，**MUST** 先對改動檔機械 grep perf keyword：

   ```bash
   git diff --name-only <base>..<head> -- '*.vue' '*.tsx' '*.jsx' '*.css' '*.scss' '*.html' \
     | xargs -r grep -lE 'fetchpriority|content-visibility|scheduler\.(yield|postTask)|requestIdleCallback|speculationrules|web-vitals|onLCP|onINP|onCLS'
   ```

   命中 → **MUST** 用 target adapter 的 performance inspection surface 實測，把 LCP / INP / CLS 與關鍵 insight inline 寫進 review report，改善前後各跑一次。adapter 不可用時明確標「待測」，**NEVER** 假裝已有數字。沒命中但改動觸及 hero image / above-the-fold layout / 字體載入時 **SHOULD** 照樣實測（keyword 偵測是下界）。
3. **annotation MUST 與 item marker 同一行**：`(verified-*:)` / `(issue:)` / `(claude-discussed:)` 等 **MUST** 寫在 `- [ ] #N ...` 那一行的末尾，**NEVER** 寫在下一行（即使縮排正確）——parser 只解析 marker 行內的 token，獨立行 annotation 是 silent miss（[[pitfall-scan-non-ready-passive-report-instead-of-self-fix]]）。
4. **寫完 evidence 後的收斂迴圈**：寫完 **MUST** 重跑 `flow gates --repo-only --require-empty` 與 `manual-review-check.sh`。缺 evidence／格式錯是 agent 的球，**MUST** 自行 root-cause 修正再重跑，直到剩下的只有真的要人判的項目。**NEVER** 把「evidence 還缺」「格式不對」回報給人。
5. **陳述狀態前，本 turn 內 MUST 重新讀一次**：回答「還剩幾項」「ready 了沒」「這條過了嗎」「現在輪到誰」之前，本 turn 尚未跑過就 **MUST** 先跑 `flow gates`（tasks.md 項另讀該 carrier 當下的 checkbox），再答。上一則訊息跑過不算。人說「我已經回答／勾了 X」而讀不到時，**MUST** 當場依他的原話補寫（`flow receipt … --actor <人>`、`flow answer … --via '<原話>'`，或照 [[manual-review]] § 核心規則寫回 tasks.md），**NEVER** 回「你還沒做」或要人再做一次。

## Parent State Derivation — 真相層責任分工

> parent AND-derive hard rule 與禁止項在 [[manual-review]] § Parent State Derivation。

| 真相層 | 責任 |
| --- | --- |
| 寫回 leaf 的 agent（[[proactive-skills.manual-review-entry]] 第 4 步） | 沒有獨立的 rollup 寫入器：寫回 child line 的**同一次編輯**依 [[manual-review]] § Parent State Derivation 重 derive 並寫回 parent line（rollup／un-rollup） |
| commit Step 0-MR awk gate | **MUST** leaf-only count — parent-with-scoped-children 不計 pending |
| 任何計 pending 的 gate / tooling | **MUST** leaf-only count（semantic fully aggregated from scoped children） |
| 未來新加的 tooling | **MUST** 沿用 leaf-only count；禁止 naive `grep '- \[ \]'` 或同義 awk 計 pending |

## Legacy annotation 退役對照

> 下列四種寫法的寫入器已退役。**既有行內記錄不必清**（讀取端略過或照舊解析），**NEVER** 新寫。

| 舊寫法 | 當時的語意 | 現在要人接手時 |
| --- | --- | --- |
| `(claude-analyzed: <ISO> route=E)` | triage 結論為 (E)，球在人 | `flow ask --question ... --option ... --recommended ... --why ... --work-id <W> --carrier <tasks 檔>` → `ruling` 卡 |
| `(awaiting-user-decision: <ISO>)`（含其 CLI helper） | 純商業決策，packet 已備妥 | 同上；packet 的路徑放進 `--carrier` → `ruling` 卡 |
| `@apply-blocked[<reason>]` | implementation 卡外部 blocker | `flow ask --category human-action --human-only <理由> --step '<要人做的動作>' ...`（dispatched child 走 `--complete blocked`）→ `external-action` 卡 |
| `@evidence-via-manual-review` | 把 phase task 排除在 90% implementation threshold 外 | 無後繼（threshold 已退役） |

四者共通的可寫條件在新寫法下照舊成立：**MUST NOT** 翻 checkbox、**MUST NOT** strip 既有 `（issue:）`、**MUST NOT** 用開卡規避其實 actionable 的 item。判「現在有什麼等人」一律跑 `flow gates`。

## ADR (2026-05-22) — Default Kind Flip 未採用，勿再提案

不把 fallback default 從 `[review:ui]` 改成 `[verify:ui]`：任何 default 都會在某類內容上猜錯，explicit marker 已由 `MISSING_KIND_MARKER` fail-fast 強制，改 default 還會讓 legacy item 突然缺 evidence。看到 missing marker，正解是補 marker。
