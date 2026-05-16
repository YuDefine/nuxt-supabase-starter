<!--
🔒 LOCKED — managed by clade
Source: rules/core/manual-review.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->

# 人工檢查（Manual Review）

繁體中文 | [English](./manual-review.en.md)

> 本檔是 manual-review 核心規約（無 frontmatter，每個 session 必載入）。詳細場景規約拆到 path-scoped reference：
>
> - 寫 / 審 `openspec/changes/**/tasks.md` 與 `docs/manual-review-archive.md`：[`manual-review.evidence.md`](./manual-review.evidence.md)
> - 寫 `openspec/changes/**/proposal.md` 與 `openspec/changes/**/tasks.md`：[`manual-review.data-readiness.md`](./manual-review.data-readiness.md)
> - 動 backend (`server/`, `test/`, `e2e/`, `supabase/`)：[`manual-review.backend.md`](./manual-review.backend.md)

## 核心規則

**NEVER** 自行標記 `## 人工檢查` 區塊中**屬於 `[review:ui]` kind** 的 `- [ ]` 為 `- [x]`。

`[review:ui]` items 的 checkbox 只能在以下流程中勾選：

1. 先派遣 screenshot review 流程截圖
2. 向使用者展示每個檢查項的實際畫面或證據
3. 使用者回覆 OK → 標記該項 `[x]`
4. 使用者回覆有問題 → 不標記，記錄問題
5. 使用者回覆 skip → 標記 `[x]` 並加註 `（skip）`
6. 使用者回覆 skip all → 全部標記 `[x]` 並註記

**`[discuss]` items 例外**：spectra-archive Step 2.5「Discuss Items Walkthrough」流程中，主線 Claude 主動準備 evidence、向使用者展示後取得明確 OK，可由 Claude 勾選 `[x]` 並插入 `(claude-discussed: <ISO-8601-timestamp>)` annotation 作為 evidence trail。詳見 `manual-review.evidence.md` 的「Item Kind Marker」與「標準流程」章節。

**`[verify:e2e]` / `[verify:api]` automatic channel 例外**：spectra-apply Step 8a 寫入對應 `(verified-e2e: ...)` / `(verified-api: ...)` annotation 後，review-gui auto-check helper 可自動勾 `[x]`；這些 channel 不需要使用者在 GUI 再確認。`[verify:ui]` 仍需使用者在 GUI 確認 visual evidence。

## 人工檢查與靜態 QA 的差別

| 類型 | 目的 | 能否直接勾選人工檢查 |
| --- | --- | --- |
| screenshot review / 靜態截圖 QA | 確認畫面、文案、佈局、狀態 | **不能直接代勾** |
| 使用者確認 | 確認功能與結果符合期待 | **可以** |

截圖是證據，不是使用者確認本身。

## Screenshot Review ≠ Functional Verification（Hard Rule）

Screenshot review **只覆蓋視覺層**，**不**覆蓋功能 round-trip。下列工作 screenshot review **不能**算驗收完成：

| 類型 | Screenshot 能驗 | Screenshot 不能驗 |
| --- | --- | --- |
| 按鈕 / 控件**存在** | ✅ | — |
| Layout / 字級 / 色彩 / a11y attribute | ✅ | — |
| Empty / Loading / Error state 的**視覺呈現** | ✅ | — |
| **Form submit 真的送到 server** | — | ❌ 必須使用者實作 |
| **Server 真的回 200 + DB 真的變更** | — | ❌ 必須使用者實作 |
| **Dialog 提交後 list refetch + 顯示新狀態** | — | ❌ 必須使用者實作 |
| **Edge case payload（null / 空 / 邊界）** | — | ❌ 必須使用者實作 |
| **權限拒絕 path** | — | ❌ 必須使用者實作 |

### 真實案例（為什麼這條 rule 存在）

> 2026-05-08，`loan-conflict-prompt-and-manual-return` change 的 phase 7 screenshot review 報告 Fidelity 8/8、0 DRIFT、0 Critical，包含「Manual return dialog 結構正確」「Submit loading state OK」。Phase 6 quality gates 全綠（焦點 test 23 個）。
>
> 使用者人工檢查 #39 實際送出 dialog → 立刻收到 400 ZodError：「`return_notes`: expected string, received null」。Schema 用 `.optional()` 而非 `.nullish()`，client 送 `null`，phase 2 codex 寫的 test 沒含 `null` boundary case。
>
> Screenshot review 全綠 + test 全綠 + design fidelity 8/8 都沒擋住這個 bug — 因為**沒有任何環節真實送出 form**。

### 規約

- **MUST** 把 functional round-trip（form submit / mutation / API call → response → state update）列為**使用者人工檢查項目**，不依賴 screenshot review
- **MUST** 在 tasks.md 的 `## 人工檢查` 區塊明寫「送出 → 確認 server response → 確認 DB / list refetch」流程，不要只寫「看到按鈕」
- **MUST** 對不需要截圖、只能由使用者親自操作驗收的 round-trip-only item，加上可選的 `@no-screenshot` marker；使用者完成 round-trip 後可在 `pnpm review:ui` 直接勾 OK。Marked item 的 viewer **MUST** 顯示 round-trip-only UI，且 **MUST NOT** 顯示「複製 handoff prompt」。完整 marker schema 見 `manual-review.evidence.md` 的「`@no-screenshot` Marker（hard rule）」段；截圖策略配套見 `screenshot-strategy.md` 的「round-trip-only manual-review item」。
- **NEVER** 把 screenshot review 「按鈕存在 + dialog 結構正確」當成 round-trip 已驗證
- **NEVER** 在使用者尚未真實互動驗收前 archive UI change

## Item Kind Marker（hard rule）

每條 `## 人工檢查` checkbox 行 **MUST** 在 `#N` / `#N.M` 後緊接一個 leading kind marker。合法 marker：

- `[review:ui]` — 需要使用者親自確認的 UI / UX 驗收。例：收 email / 收 webhook / 實體裝置 / 視覺主觀美感 / 真機跨機器。**MUST** 由使用者完成，agent 禁止代勾。
- `[discuss]` — Claude 主導的 evidence-based 討論項目。例：production 授權、商業判斷、production 觀察、後端 evidence 查驗。spectra-archive Step 2.5 walkthrough 流程下，Claude 主動準備證據與使用者討論、取得 OK 後可代勾並寫入 `(claude-discussed: <ISO-8601-timestamp>)` annotation。
- `[verify:e2e]` — Playwright spec-based automated round-trip。主線在 `e2e/verify/<change>/<topic>.spec.ts` 寫 spec、跑 `pnpm test:e2e:verify <change>`，通過後寫 `(verified-e2e: <ISO> spec=<path> trace=<path>)` annotation。
- `[verify:api]` — 純 HTTP round-trip（curl / ofetch / fetch）。主線跑 request，通過後寫 `(verified-api: <ISO> <METHOD> <URL> <STATUS>[ body=<hash>])` annotation。
- `[verify:ui]` — final-state screenshot + DOM observation。主線派 screenshot-review agent `mode: verify` 只開已知 URL、等待載入、截 final-state screenshot、記錄 DOM 觀察，回來後寫 `(verified-ui: <ISO> screenshot=<path>[ dom=<obs>])` annotation；使用者仍需在 review GUI 點 OK 才勾 `[x]`。
- `[verify:<a>+<b>]` / `[verify:<a>+<b>+<c>]` — multi-marker，僅允許組合 `e2e` / `api` / `ui` verify channels，例如 `[verify:api+ui]` 或 `[verify:e2e+ui]`。
- `[verify:auto]` — **DEPRECATED alias**，僅為既有 consumer tasks.md 相容保留；解析時視為 synthetic `[verify:api+ui]` 並 emit deprecation warning。新項目 **NEVER** 使用 `[verify:auto]`。

### Canonical line format

```
- [ ] #N [<kind>] <description> [(verified-<channel>: ...)]... [@followup[TD-NNN]] [@no-screenshot]
```

- Marker **MUST** 是 `#N` / `#N.M` 後第一個 token，與 id 之間僅一個空白。
- Marker 出現在 description 中間（例：`Click the [discuss] button`）視為 plain text，**MUST NOT** 被解析成 marker。
- `[review:ui]` / `[discuss]` 不得與 verify multi-marker 混用。`[verify:api+review:ui]`、`[verify:api+discuss]` 都是非法 marker。
- Verify multi-marker 的 channel canonical order 是 `e2e → api → ui`；annotation 寫回也 **MUST** 依此順序。

### Default Kind Derivation Rule（fallback）

當 item 行無 leading marker（典型情境：legacy in-flight change），parser 依 `proposal.md` 推導 default kind：

- proposal 含 `**No user-facing journey (backend-only)**` → default kind = `discuss`
- 其餘 → default kind = `review:ui`

**Fallback 不涵蓋任何 `verify:*`** — verify channels 代表 apply 階段會收集自動 evidence，不能由 proposal default silent derive。新寫 verify items **MUST** 顯式標 marker。

**Fallback ≠ 允許省略**：所有**新寫**或**ingest 修改**的 `## 人工檢查` items **MUST** 顯式標 marker。Default 只給既有 in-flight change 過渡用。spectra-propose / spectra-ingest 的 Manual Review Marker Hygiene Check 會擋下未標 marker 的新內容。

### 與 `@no-screenshot` / `@followup[TD-NNN]` 共存 ordering

```
- [ ] #N [<kind>] <description> [(verified-<channel>: ...)]... [@followup[TD-NNN]] [@no-screenshot]
```

`[<kind>]` 永遠在最前（緊接 `#N`），`@no-screenshot` 永遠在最後；`@followup[TD-NNN]` 若存在須夾在 description 與 `@no-screenshot` 之間。寫回 annotation（`（issue: ...）` / `（skip）` / `（note: ...）` / `（finding: ...）` / `(claude-discussed: <ISO>)` / `(verified-e2e: ...)` / `(verified-api: ...)` / `(verified-ui: ...)`）**MUST** 插在 description 後、所有 trailing markers (`@followup` / `@no-screenshot`) 前。`（finding: ...）` 與 `（issue: ...）` / `（skip）` / `（note: ...）` 正交（可共存於同一行），其餘 action annotation 之間仍互斥。

<<<<<<< Updated upstream
詳細 Kind 分類指引、反面範例、收斂原則、可解析格式 schema、`@no-screenshot` / `@no-manual-review-check` marker schema 與標準流程見 reference 檔（路徑見頂部 pointer）。
=======
### Kind 分類指引（給 propose / spec 寫作者）

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

**反面範例**：

```markdown
❌ - [ ] #1 [review:ui] admin /settings 改排程到 09:00 → reload 仍 09:00
   理由：persistence journey 可由 Playwright spec 重現；應該標 [verify:e2e]

❌ - [ ] #4 [review:ui] /work-reports 對某張 voided 單嘗試 Archive（按鈕應隱藏；若仍有路徑進入則 422 友善訊息），對某張 archived 單嘗試 Void（對稱驗收）
   理由：「按鈕應隱藏」是 final-state DOM observation（agent 自驗 → [verify:ui]）；
         「422 contract」是 HTTP round-trip（curl 自驗 → [verify:api]）；
         整條沒有真的需要 user 親自做的部分，且還犯「某張」模糊指代（見 Pre-Review Data Readiness）。
         **MUST** 拆成 [verify:ui] + [verify:api] 兩條，sample 引用具體 ID

✅ - [ ] #1 [verify:e2e] admin /settings 改排程到 09:00 → 200 toast → reload 仍 09:00
✅ - [ ] #1 [verify:api+ui] admin /settings 改排程到 09:00 → PATCH 200 + 畫面顯示新值
✅ - [ ] #4a [verify:ui] /work-reports 互斥狀態 detail slideover — voided 樣本 `WR-9001` 操作區不含「封存」按鈕；archived 樣本 `WR-9002` 操作區不含「作廢」按鈕
✅ - [ ] #4b [verify:api] 對 `WR-9001` (voided) 打 `POST /api/v1/work-reports/:id/archive` → 422 + 中文 message「已作廢的工單無法封存」；對 `WR-9002` (archived) 打 `POST /api/v1/work-reports/:id/void` → 422 對稱
✅ - [ ] #2 [review:ui] cron 觸發 → 借用人實體 inbox 收到逾期通知 email（agent inbox 不可達）
✅ - [ ] #3 [discuss] production seed 授權與 cron 監控確認
```

**`[review:ui]` 收斂原則（hard rule）**：

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

## `@no-manual-review-check` Marker（hard rule）

針對 hook regex 誤判（false positive）或合法例外（如真機掃 SMS 驗證碼、實體鎖匙、印表機調整等真的無 dev replay endpoint 的場景），可在該 checkbox line 行尾加上 `@no-manual-review-check[<reason>]` marker，跳過 Pre-Review Data Readiness regex 檢查（post-propose-manual-review-check.sh hook + review-gui pre-flight banner 都 skip）。

Bypass marker **MUST NOT** 用來掩蓋其他 hygiene 問題：

- 不影響 Item Kind Marker（`[review:ui]` / `[verify:*]`）分類正確性
- 不影響 `@no-screenshot` semantic
- 不影響 archive-gate 對 evidence trail 的檢查（`(verified-e2e: ...)` / `(claude-discussed: ...)` 仍 enforce）
- 只 scope 在 Pre-Review Data Readiness regex 這一層

### Schema

```text
@no-manual-review-check[<reason>]
```

- **MUST** 是 trailing token（位於行尾，可後接 `@no-screenshot`）
- `<reason>` **MUST** 非空（empty `@no-manual-review-check[]` 或無 brackets 的 bare `@no-manual-review-check` 均視為 invalid marker，hook / review-gui 不啟用 bypass）
- 同一行 **MUST NOT** 出現多個 `@no-manual-review-check` marker
- Marker 出現在 description 中間（例：documenting the marker syntax inside backticks）視為 plain text，**MUST NOT** 被解析成 marker

### Canonical line format（與 `@followup` / `@no-screenshot` 共存）

```text
- [ ] #N [<kind>] <description> [(verified-<channel>: ...)]... [@followup[TD-NNN]] [@no-manual-review-check[<reason>]] [@no-screenshot]
```

Canonical ordering（從前到後）：description → annotation → `@followup` → `@no-manual-review-check` → `@no-screenshot`。

範例（與其他 marker 共存）：

```markdown
- [ ] #5 [review:ui] 真機掃 SMS 驗證碼確認 @followup[TD-042] @no-manual-review-check[SMS gateway 無 dev replay endpoint] @no-screenshot
```

### Audit trail

當 hook / review-gui skip 一個 bypassed item 時 **MUST** emit info-level log：

```
[info] tasks.md:<lineno> bypass: <reason>
```

GUI 端在診斷 console 寫同樣訊息。archive 後保留在 `docs/manual-review-archive.md`（與其他 marker 一致）可重跑分析 bypass 頻率 — 若某類 reason 出現 ≥ 5 次跨 consumer，應該調整 pattern regex 而非繼續累積 bypass。

### 與 hook regex 的關係

完整 pattern 定義見 `vendor/snippets/manual-review-enforcement/patterns.json`。Hook 與 review-gui 共用同一份 patterns.json（single source-of-truth），改 pattern 時兩端同步生效（per `Shared Regex Pattern Source` design decision）。Hook 與 review-gui 共用同一份 bypass parser，behavior 保持一致。

## 截圖檔名與 item id 配對（hard rule）

`pnpm review:ui` 設計成自動把截圖配到正確的 item，使用者不需要手動挑選。為此截圖檔名
**MUST** 以 item id 開頭：

```text
#<item-id>[<variant>]-<descriptor>.<ext>
```

例：item `#1` 的截圖命名為 `#1-clock-light.png`、`#1a-clock-dark.png`；scoped item
`#3.1` 命名為 `#3.1-mobile.png`。

完整命名規範（含變體、legacy fallback、違反處理）見 `screenshot-strategy.md`。

## 標準流程

依 item 的 kind marker 走不同 flow。**MUST** 覆蓋 verify channels、`[review:ui]`、`[discuss]` — 一個 change 的 `## 人工檢查` 區塊可同時包含多種 kind 的 items。

### `[verify:*]` flow（spectra-apply Step 8a Verify Channel Pass）

tasks.md 有未勾 `[verify:e2e]` / `[verify:api]` / `[verify:ui]` / multi-marker items 時，spectra-apply Step 8a **MUST** 依 channel 分流處理。Cookbook 與範本見 `vendor/snippets/verify-channels/README.md`。

#### `[verify:e2e]` channel

**Dispatch**：主線 Claude **自己寫** Playwright spec 到 `e2e/verify/<change>/<topic>.spec.ts`（參考 `vendor/snippets/verify-channels/e2e-spec.template.ts`），跑：

```bash
pnpm test:e2e:verify <change>
```

**Evidence trail**：spec pass 後，主線在 item line 寫：

```text
(verified-e2e: <ISO-8601> spec=<repo-relative-path> trace=<repo-relative-path>)
```

**Archive-gate 結果**：`verify:e2e` 是 automatic channel；annotation present 即通過，可由 `autoCheckCompletedAutomaticItems(...)` 自動 flip `[x]`。缺 annotation 時 archive-gate **MUST** block。

#### `[verify:api]` channel

**Dispatch**：主線 Claude **自己跑** curl / ofetch HTTP round-trip（參考 `vendor/snippets/verify-channels/api-roundtrip.template.sh`），不得派 screenshot-review agent 代跑 API mutation。

**Evidence trail**：request 通過後，主線在 item line 寫：

```text
(verified-api: <ISO-8601> <METHOD> <URL> <STATUS>[ body=<sha256-12chars>])
```

**Archive-gate 結果**：`verify:api` 是 automatic channel；annotation present 即通過，可由 `autoCheckCompletedAutomaticItems(...)` 自動 flip `[x]`。缺 annotation 時 archive-gate **MUST** block。

#### `[verify:ui]` channel

**Dispatch**：主線 Claude 派 screenshot-review agent `mode: verify`，但 scope **只限** open known URL + wait for load + capture final-state screenshot + DOM observation（參考 `vendor/snippets/verify-channels/ui-final-state-brief.template.md`）。agent **NEVER** 負責 mutation / form fill / multi-role login；那些屬於 `verify:api` 或 `verify:e2e` channel。

**Evidence trail**：agent 回報 final-state screenshot 與 DOM 觀察後，主線在 item line 寫：

```text
(verified-ui: <ISO-8601> screenshot=<repo-relative-path>[ dom=<short-observation>])
```

**Archive-gate 結果**：`verify:ui` 是 semi-automatic channel；annotation present 只是 visual evidence，使用者仍 **MUST** 在 review GUI 點 OK 才能 flip `[x]`。缺 annotation 時 GUI 顯示 evidence missing；未勾 `[x]` 時 archive-gate **MUST** block。

#### Multi-marker items

Multi-marker item **MUST** 由主線依 channel order `e2e → api → ui` 逐一執行，每完成一個 channel 就寫對應 annotation。例：

```markdown
- [ ] #1 [verify:api+ui] admin 改 offset → 200 + grid 顯示更新 (verified-api: 2026-05-11T08:00:00Z PATCH /api/v1/machines/4/slots/403 200) (verified-ui: 2026-05-11T08:00:30Z screenshot=screenshots/local/<change>/#1-final.png dom=grid-updated)
```

- 若 item 只含 automatic channels（`verify:e2e` / `verify:api`），最後一個 channel annotation 寫入後 `autoCheckCompletedAutomaticItems(...)` 可自動 flip `[x]`。
- 若 item 含 `verify:ui` 或 `review:ui`，automatic channel 只完成 evidence；checkbox **MUST** 保持 `[ ]`，等使用者在 GUI 確認。
- Archive-gate **MUST** 對每個 kind 獨立驗證並取 worst-case（block > warn > pass）。

#### `[verify:auto]` deprecated alias

`[verify:auto]` 僅為 backward compatibility。解析時 **SHALL** 視為 synthetic `[verify:api+ui]`：

1. 主線先跑 `verify:api` channel，寫 `(verified-api: ...)`
2. 再跑 `verify:ui` channel，寫 `(verified-ui: ...)`
3. 使用者仍需在 review GUI 對 UI evidence 點 OK 才能勾 `[x]`

Archive-gate / parser **MUST** emit deprecation warning。新 authoring **NEVER** 使用 `[verify:auto]`；新項目必須使用 explicit `[verify:e2e]` / `[verify:api]` / `[verify:ui]` 或 multi-marker。

#### Pre-verify baseline 假設（hard rule）

Verify channel baseline 是 consumer 端**已預先 ready** 的 codebase 層長期狀態。主線 **MUST** 在 dispatch 前 grep / read 檢查 baseline；缺任何必要項即 stop + 回報 user 補齊，**NEVER** 派出去讓 agent / spec / curl 撞到再升 UNCERTAIN。

| Channel | Baseline |
| --- | --- |
| all `verify:*` | env-gated dev-login route 已就緒：`server/routes/auth/_dev-login.get.ts` 或 `server/routes/auth/__test-login.get.ts`（含 packages equivalent） |
| `verify:e2e` | Playwright config + `e2e/fixtures/index.ts` style three-role fixture（`adminPage` / `managerPage` / `staffPage`） |
| `verify:api` | `__test-login` 或等價 session bypass route，可讓 curl / ofetch 建立 role session |
| `verify:ui` | canonical seed data（`supabase/seed.sql` 或專案等價 seed 檔）覆蓋 final-state URL 所需 entity |

**Why**：baseline 維護不是任何單一 spectra change 的臨時工作。每次 verify dispatch 才問 user 或讓 agent 補 seed，會把長期 codebase baseline 拖進錯誤時機，且會製造 seed.sql source-of-truth 漂移。

**Agent 端對應行為**：`screenshot-review` verify mode 撞 baseline 缺（dev-login route 不存在 / seed 缺 entity / known URL 只能呈現空資料）屬 Fail-Fast UNCERTAIN；agent **NEVER** 補 seed、patch auth、或升級成 mutation runner。

**主線端對應行為**：

- Dispatch `verify:e2e` 前 **MUST** 確認 Playwright config、dev-login / `__test-login`、three-role fixture 存在。
- Dispatch `verify:api` 前 **MUST** 確認可用 session bypass route。
- Dispatch `verify:ui` 前 **MUST** 確認 dev-login route + seed file 存在。
- Baseline 不完整時，將缺口登記到 consumer 的 `ROADMAP.md` / `docs/tech-debt.md` / dedicated infra change，而不是降低 verification channel。

### `[review:ui]` flow（真的需要人）

tasks.md 仍有未勾 `[review:ui]` 項時，第一動作 **MUST** 是引導使用者跑 `pnpm review:ui` — 本地 GUI 自動依 `#N` / `#N.M` schema 配對截圖、可鍵盤完成 OK / Issue / SKIP、conflict-aware 寫回 tasks.md，不在 chat 內燒 token。完整工具行為見 `vendor/scripts/review-gui.mts`。

**NEVER** 預設用 `AskUserQuestion` 在 chat 內逐項彈對話框 — 那是 fallback，不是 default path。

**Fallback**（`pnpm review:ui` 不可用時 — consumer 沒有該 script、使用者明確拒絕 GUI、或 pure backend 完全無 UI 證據需求）：

1. 依 task 清單逐項準備截圖或證據
2. 說明截圖中看到的狀態
3. 問使用者這一項是否通過
4. 依使用者答覆決定勾選、保留未勾、或註記 skip

#### review-gui pre-flight warning

`pnpm review:ui` 渲染 `[review:ui]` / `[verify:ui]` item 前會 client-side 偵測 Pre-Review Data Readiness hard rule 違反（模糊指代 / 缺 UID / 缺 URL / multi-step 未拆）。Patterns 來自 `vendor/snippets/manual-review-enforcement/patterns.json`（與 `scripts/spectra-advanced/post-propose-manual-review-check.sh` 共用 single source-of-truth）。

- 看到 amber warning banner → 該 item 在 propose 階段沒被 hook 攔到（hook 漏網或被 bypass），建議跑 `/spectra-ingest` 補上 inline sample / scoped sub-items
- Banner 列出 hit pattern 與 manual-review.md sub-section anchor，並提示「建議跑 /spectra-ingest 補上」
- Banner **non-blocking**：user 仍可 OK / Issue / SKIP（warning 不擋住操作）
- Banner 用 amber 色，跟 verify channel evidence missing 的 red banner 區分

##### Bypass

對 hook regex 誤判（false positive）或刻意例外的 item，可加 `@no-manual-review-check[<reason>]` marker（見下方「`@no-manual-review-check` Marker」段）跳過 banner + hook 檢查。Banner 不顯示，但 GUI 診斷 console 仍寫 `[info] #N bypass: <reason>` 留 audit trail。

#### `（finding: ...）` annotation（額外發現）

每個 `[review:ui]` / `[verify:ui]` item 在 review GUI 上除了 `✓ 通過` / `⚠ 有問題` / `⤵ 跳過` 三個主要按鈕外，還有一個預設收合的「+ 額外發現」disclosure。它與三擇一主要結論**正交**：可單獨存在、可與任一主要 action 共存，內容沒填就不會寫入。

語義：是「在審 #N 這條 item 的過程中順手看到的旁支觀察」，通常是 TD 候選或設計改善建議，本身**不**影響該 item 的 ok/issue/skip 結論。例：item #3 hero 區塊整體 ok，但 user 注意到 CTA 的 hover state 沒有 transition — 可在 #3 標 OK 的同時把這個觀察記在 finding 欄。

寫回格式：

```text
- [x] #3 [review:ui] hero 區塊 final-state（note: 通過）（finding: CTA hover state 沒 transition，疑 TD 候選）
```

Schema：

- 與 `（issue: ...）` / `（skip）` / `（note: ...）` 一樣是 CJK 全形括號的 action annotation
- 落點與其他 action annotation 同：description 後、所有 trailing markers (`@followup` / `@no-screenshot`) 前
- 內容 sanitize 規則與 note 共用（whitespace 折成單一 space、剝半形括號、上限 240 chars）
- 每行至多 1 個 `（finding: ...）`；下次寫入會先 strip 舊的再加新的
- 未填內容（空字串 / 純空白）不會產生 annotation

下游處理：

- archive 階段一併保留在 tasks.md 與 `docs/manual-review-archive.md`，方便事後 grep 找 TD 候選
- 是否真要登成 `docs/tech-debt.md` 的 TD-NNN 由 user 自行判斷 — finding 只是「先記下來」的紀錄機制，不自動 promote

**NEVER** 把 finding 當成 issue 的替代品。「有問題」（issue）= 該 item 本身驗收不過、會擋 archive；「額外發現」（finding）= 跟該 item 不直接相關的旁支觀察、不擋 archive。混用會讓 archive-gate 與 `/spectra-archive` 分流邏輯誤判。

### `[discuss]` flow（spectra-archive Step 2.5 Walkthrough）

tasks.md 有未勾 `[discuss]` 項時，**MUST** 走 spectra-archive Step 2.5 「Discuss Items Walkthrough」：

1. archive 階段主線 Claude **主動** Read tasks.md `## 人工檢查` 區塊，識別未勾 `[discuss]` items
2. 對每條 item，主線 Claude 主動準備 evidence（grep 結果、diff、command output、data summary、合理性分析）— **不要**等使用者開口
3. 向使用者展示 evidence + item description，請使用者明確 OK / Issue / Skip
4. **OK 路徑**：勾 `[x]` + 在 description 後、trailing markers 前插入 `(claude-discussed: <ISO-8601-timestamp>)` annotation
5. **Issue 路徑**：保持 `[ ]`、附 issue 註記、不擋 archive（使用者保留主導權）
6. **Skip 路徑**：勾 `[x]` + `（skip）` annotation

archive-gate.sh Check 4 會驗 `[discuss]` items 必須勾選或含 `(claude-discussed: ...)` evidence trail。

### 混合 kind change

一個 change 同時含未勾 `[verify:*]` + `[discuss]` + `[review:ui]` items 時，**MUST** 依以下順序執行（早→晚，讓 user 拿到的 review GUI 內容最完整）：

1. **apply 階段** — Step 8a Verify Channel Pass：主線依 `e2e → api → ui` 跑 verify channels，寫 `(verified-e2e:)` / `(verified-api:)` / `(verified-ui:)` annotations；automatic-only items 由 helper 自動勾 `[x]`
2. **archive 階段 Step 2.5** — Discuss Items Walkthrough：Claude 主動準備 `[discuss]` evidence、與 user 討論
3. **archive 階段 review GUI** — `pnpm review:ui` 一次處理所有未勾 `[review:ui]` + `[verify:ui]` items（user 在 GUI 看 evidence/screenshot 點 OK / Issue / Skip）

spectra orchestrator Archive Flow Step 1 已內建這個分流邏輯。
>>>>>>> Stashed changes

## 禁止事項

- **NEVER** 問「要不要我直接幫你勾完」
- **NEVER** 在未展示證據的情況下代勾任何 item（含 `[discuss]` items — Step 2.5 walkthrough 的 evidence 展示是強制前提）
- **NEVER** 對 `[review:ui]` items 在使用者尚未親自 round-trip 的情況下代勾，即使 Claude 已分析過程式碼
- **NEVER** 對 `[verify:e2e]` / `[verify:api]` items 在 annotation 寫入後仍要求 user 在 GUI 確認 — automatic channel 完成後由 `autoCheckCompletedAutomaticItems(...)` 自動 done
- **NEVER** 對 `[verify:ui]` items 在使用者尚未於 review GUI 確認 visual evidence 前代勾 `[x]`
- **NEVER** 新增 `[verify:auto]` marker 給新 item — 使用 explicit `[verify:e2e]` / `[verify:api]` / `[verify:ui]` 或 multi-marker
- **NEVER** 在 `verify:ui` agent dispatch 時讓 agent 同時負責 mutation / form fill / multi-role login — 那些屬 `verify:api` / `verify:e2e` channel
- **NEVER** 對任何 `verify:*` channel 在 evidence 沒成功產出時寫 `(verified-<channel>:)` annotation
- **NEVER** 把 screenshot review 當成等同於人工功能驗證
- **NEVER** 為了通過 gate 而批次勾選未確認的項目
- **NEVER** 對 `[discuss]` items 寫入 `(claude-discussed: ...)` annotation 而沒有實際與使用者討論並取得 OK
- **NEVER** dispatch verify channels 前不檢查 per-channel baseline — 撞 baseline 缺後升 UNCERTAIN 是浪費 budget；主線預先 grep / read 確認，缺則停下回報 user 補齊
- **NEVER** 在 verify dispatch 當下才問 user「dev-login / seed 準備好了嗎」— baseline 是 codebase 層長期狀態，不該每次派工都驚動 user
