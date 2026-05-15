<!--
🔒 LOCKED — managed by clade
Source: rules/core/manual-review.evidence.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->

---
description: Manual Review evidence 規約——寫 / 審 tasks.md 的 ## 人工檢查 區塊時 path-scoped 載入
paths: ['openspec/changes/**/tasks.md', 'docs/manual-review-archive.md']
---

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
