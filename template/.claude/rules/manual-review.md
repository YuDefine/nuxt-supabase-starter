<!--
🔒 LOCKED — managed by clade
Source: rules/core/manual-review.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->

---
description: 人工檢查規則——`## 人工檢查` 只能在截圖驗證並取得使用者確認後勾選，不得由 agent 自行代勾
globs: ['openspec/changes/**/tasks.md', 'docs/manual-review-archive.md']
---

# 人工檢查（Manual Review）

繁體中文 | [English](./manual-review.en.md)

## 核心規則

**NEVER** 自行標記 `## 人工檢查` 區塊中**屬於 `[review:ui]` kind** 的 `- [ ]` 為 `- [x]`。

`[review:ui]` items 的 checkbox 只能在以下流程中勾選：

1. 先派遣 screenshot review 流程截圖
2. 向使用者展示每個檢查項的實際畫面或證據
3. 使用者回覆 OK → 標記該項 `[x]`
4. 使用者回覆有問題 → 不標記，記錄問題
5. 使用者回覆 skip → 標記 `[x]` 並加註 `（skip）`
6. 使用者回覆 skip all → 全部標記 `[x]` 並註記

**`[discuss]` items 例外**：spectra-archive Step 2.5「Discuss Items Walkthrough」流程中，主線 Claude 主動準備 evidence、向使用者展示後取得明確 OK，可由 Claude 勾選 `[x]` 並插入 `(claude-discussed: <ISO-8601-timestamp>)` annotation 作為 evidence trail。詳見下方「Item Kind Marker」與「標準流程」章節。

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
- **MUST** 對不需要截圖、只能由使用者親自操作驗收的 round-trip-only item，加上可選的 `@no-screenshot` marker；使用者完成 round-trip 後可在 `pnpm review:ui` 直接勾 OK。Marked item 的 viewer **MUST** 顯示 round-trip-only UI，且 **MUST NOT** 顯示「複製 handoff prompt」。完整 marker schema 見下方「`@no-screenshot` Marker（hard rule）」；截圖策略配套見 `screenshot-strategy.md` 的「round-trip-only manual-review item」。
- **NEVER** 把 screenshot review 「按鈕存在 + dialog 結構正確」當成 round-trip 已驗證
- **NEVER** 在使用者尚未真實互動驗收前 archive UI change

### 給 propose / spec 寫作者

寫 `## 人工檢查` 項目時，**MUST** 用「動詞 → 結果」格式描述真實使用者操作：

```markdown
✅ 好：
- [ ] #N Admin 在 `/asset-loans` 點品項 → 開 slideover → 點某筆 active loan 旁「手動歸還」→ dialog 開啟 → 選「正常」+ 不填備註 → 送出 → 200 OK，loan 狀態變 returned，列表自動刷新

❌ 不夠：
- [ ] #N 確認手動歸還按鈕能用
```

「能用」是模糊驗收，落到實作會被解讀為「能點到 / 看到 dialog」，漏掉真實送出 + DB 變更。

### Backend-only change 的特別規約

當 `proposal.md` 宣告 `**No user-facing journey (backend-only)**` 時，`## 人工檢查` 區塊適用更嚴的規約 — **只**允許三類項目（production 授權 / 商業判斷 / production 觀察），其餘 SSH / psql / curl / schema 驗證等 evidence collection **MUST** 寫進新的 `## N. Backend Verification Evidence` section 由 apply 階段 Claude 自跑自貼，**禁止**塞進 `## 人工檢查` 讓使用者扛。

完整規約（含三類定義、`## N. Backend Verification Evidence` 模板、例外宣告固定文字、反面範例）見 `ux-completeness.md` 的「必填 Backend-only Manual Review 規約」。本檔的「動詞 → 結果」格式只適用於有 user-facing journey 的 change。

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

禁止在 `## 人工檢查` checkbox line 使用 legacy section ids，例如 `8.1`、`9.3`，也禁止省略 `#N` / `#N.M`。這個 schema 只讓 tooling 能定位與寫回項目，不改變人工檢查 ownership：agent 仍然 **NEVER** 在未取得使用者明確 OK、Issue handling、skip 或 skip all 前自行勾選 `[review:ui]` items；`[discuss]` items 的勾選規則見下方「Item Kind Marker」章節。

## Item Kind Marker（hard rule）

每條 `## 人工檢查` checkbox 行 **MUST** 在 `#N` / `#N.M` 後緊接一個 leading kind marker，三擇一：

- `[review:ui]` — **真的需要人**親自完成的驗收（agent 用 browser-harness 也跑不了）。例：收 email / 收 webhook / 實體裝置 / 視覺主觀美感 / 真機跨機器。**MUST** 由使用者親自完成，agent 禁止代勾。
- `[verify:auto]` — agent 用 browser-harness **完整 round-trip** 即可驗證的 UI 操作（純 UI 點按、表單送出、看 toast / 排序 / 徽章 / 數值 / 權限拒絕 / edge payload）。spectra-apply Step 8a Verify-Auto Pass 由 screenshot-review agent (verify mode) 自跑、寫入 `(verified-auto: <ISO> network=<status>[ dom=<obs>][ ...])` annotation 證明 round-trip 真實發生；user 仍需在 review GUI 點 OK 才勾 `[x]`（雙層保險）。
- `[discuss]` — Claude 主導的後端 evidence-based 討論項目（例：production 授權、商業判斷、production 觀察、後端 evidence 查驗）。spectra-archive Step 2.5 walkthrough 流程下，Claude 主動準備證據與使用者討論、取得 OK 後可代勾並寫入 `(claude-discussed: <ISO-8601-timestamp>)` annotation。

### Canonical line format

```
- [ ] #N [<kind>] <description> [@followup[TD-NNN]] [@no-screenshot]
```

- Marker **MUST** 是 `#N` / `#N.M` 後第一個 token，與 id 之間僅一個空白。
- Marker 出現在 description 中間（例：`Click the [discuss] button`）視為 plain text，**MUST NOT** 被解析成 marker。
- 三 kind 互斥，同一行只能擇一。

### Default Kind Derivation Rule（fallback）

當 item 行無 leading marker（典型情境：legacy in-flight change），parser 依 `proposal.md` 推導 default kind：

- proposal 含 `**No user-facing journey (backend-only)**` → default kind = `discuss`
- 其餘 → default kind = `review:ui`

**Fallback 不涵蓋 `[verify:auto]`** — 因為 verify:auto 需要 spectra-apply Step 8a 主動跑 round-trip，不適合 silent fallback。新寫 verify:auto items **MUST** 顯式標 marker。

**Fallback ≠ 允許省略**：所有**新寫**或**ingest 修改**的 `## 人工檢查` items **MUST** 顯式標 marker。Default 只給既有 in-flight change 過渡用。spectra-propose / spectra-ingest 的 Manual Review Marker Hygiene Check 會擋下未標 marker 的新內容。

### 與 `@no-screenshot` / `@followup[TD-NNN]` 共存 ordering

```
- [ ] #N [<kind>] <description> [@followup[TD-NNN]] [@no-screenshot]
```

`[<kind>]` 永遠在最前（緊接 `#N`），`@no-screenshot` 永遠在最後；`@followup[TD-NNN]` 若存在須夾在 description 與 `@no-screenshot` 之間。寫回 annotation（`（issue: ...）` / `（skip）` / `（note: ...）` / `(claude-discussed: <ISO>)` / `(verified-auto: <ISO> ...)`）**MUST** 插在 description 後、所有 trailing markers (`@followup` / `@no-screenshot`) 前。

### Kind 分類指引（給 propose / spec 寫作者）

寫 `## 人工檢查` 時依以下指引判斷 marker：

**`[discuss]`（後端 evidence collection）**

- SSH、`docker exec`、`psql`、`\d <table>`、`SELECT ... FROM`、`curl` 觸發 endpoint 或 cron、受控 drift 製造、migration 存在性驗證、合理性檢查
- production 授權 / 商業判斷 / production 觀察項目

**`[verify:auto]`（agent 用 browser-harness 完整 round-trip 即可驗）**

- 純 UI 點按、填表、送出 form
- 觀察 toast / banner / 列表刷新 / 徽章 / 排序 / 計數
- 權限拒絕 path（送 403 / 401 行為）
- Edge case payload（空、null、邊界值）— agent 可送任意 payload
- agent 應主動補 fixtures / seed（依 screenshot-strategy.md 空資料解決流程），不要 punt 給 user

**`[review:ui]`（真的需要人）白名單**

- 收 email / 收 webhook（agent inbox 不可達）
- 視覺主觀判斷（美感、a11y 第三方主觀）
- 實體裝置（kiosk QR scan、印表機、條碼槍）
- 跨 session / 跨機器（手機真機、平板真機、生產環境授權後操作）
- 規格外的非 UI 環境（電話、SMS）

混淆時的判定原則：

- agent 能用 SSH / psql / curl 自跑並貼後端 evidence？→ `[discuss]`
- agent 能用 browser-harness 完整 round-trip + 觀察 network/DOM？→ `[verify:auto]`
- 都不能（必須人親自操作）→ `[review:ui]`

**反面範例**：

```markdown
❌ - [ ] #1 [review:ui] admin /settings 改排程到 09:00 → reload 仍 09:00
   理由：純 UI round-trip，agent 用 browser-harness 完全能跑；應該標 [verify:auto]

✅ - [ ] #1 [verify:auto] admin /settings 改排程到 09:00 → 200 toast → reload 仍 09:00
✅ - [ ] #2 [review:ui] cron 觸發 → 借用人 inbox 收到逾期通知 email
✅ - [ ] #3 [discuss] production seed 授權與 cron 監控確認
```

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

依 item 的 kind marker 走不同 flow。**MUST** 三種 flow 都覆蓋 — 一個 change 的 `## 人工檢查` 區塊可同時包含三種 kind 的 items。

### `[verify:auto]` flow（spectra-apply Step 8a Verify-Auto Pass）

tasks.md 有未勾 `[verify:auto]` items 時，spectra-apply Step 8a 主動處理：

1. apply 階段主線 Claude 派遣 screenshot-review agent 用 `mode: verify`
2. agent 對每條 item 用 browser-harness 完整 round-trip：
   - 依 description「動詞 → 結果」執行 UI 動作
   - 觀察 mutation network response status（assert 對應 expected）
   - 觀察 DOM 預期變化（list refetch / toast / banner / 狀態轉換）
   - 撞 emptiness preflight → 主動補 seed / fixtures（依 screenshot-strategy.md 空資料解決流程）
   - 截 final-state screenshot
3. agent 回報每 item PASS / FAIL / UNCERTAIN：
   - **PASS** → 主線 Edit tasks.md 寫入 `(verified-auto: <ISO> network=<status>[ dom=<obs>][ ...])` annotation；保留 `[ ]`（user 仍要在 GUI 點 OK 才勾）
   - **FAIL** → 保留 `[ ]` + 寫 `（issue: ...）` annotation，主線報告 user
   - **UNCERTAIN**（fixtures 缺、撞登入頁、agent 解不開）→ 不寫 annotation；主線回報 user 升級成 `[review:ui]` 或補 fixtures plan
4. agent 跑完後 user 在 review GUI 看 evidence + final-state screenshot 點 OK，才真的勾 `[x]`

archive-gate.sh Check 4 會驗 `[verify:auto]` items：勾選 `[x]` 或含 `(verified-auto: ...)` annotation（後者 warn 不 block，視為 issue path）；都沒則 block。

#### Pre-verify baseline 假設（hard rule）

`[verify:auto]` 派工的 baseline 假設是 consumer 端**已預先 ready** 以下兩條，agent / 主線 **NEVER** 在派工當下才問 user：

1. **多角色 dev-login route 已就緒** — `server/routes/auth/_dev-login.get.ts`（或等價 `__test-login`）涵蓋實際 app 用到的所有角色（admin / manager / staff / unauthorized 等），env-gated 開放（如 `NUXT_E2E_TESTING=true`）
2. **Canonical seed data 已就緒** — `supabase/seed.sql`（或專案慣例 seed 檔）覆蓋已 archive verify:auto items 涉及到的 entity，含 happy path + 已知 edge case（如 overdue loan / pending recapture / 多狀態 fixture）

**Why**：每次 verify-auto 派工才當下問 user「你 dev-login 跟 seed 準備好了嗎」會破壞流程連續性、把 baseline 維護責任推給 user 在錯誤時機處理。多角色 dev-login + canonical seed 是**長期 codebase baseline**（不是 runtime process），一旦設好就持續存在，跟「禁止自動啟 dev server」這類 runtime 規則不衝突。

**Agent 端對應行為**：撞 baseline 缺（dev-login route 不存在 / seed 缺 entity）屬 `screenshot-review.md` § Fail-Fast 條件 #1 / #2 — 標 UNCERTAIN 跳下一條，主線回報 user「baseline 缺 X，建議補齊後重派；不要當下幫 user 補 seed / 加 dev-login route」。

**主線端對應行為**：派 verify-auto agent 前**MUST**先 grep / read 確認以下兩條，缺則先停下回報 user 補齊再派，**NEVER** 派出去讓 agent 撞到再升 UNCERTAIN：

- `server/routes/auth/_dev-login.get.ts` 或 `__test-login.get.ts` 存在
- `supabase/seed.sql` 或同等 seed 檔存在（不檢查內容完整度，那是 fixtures plan 的責任）

baseline 維護不屬於任何單一 spectra change 的 scope — 應由 consumer 自家 `ROADMAP.md` / dedicated infra change 處理。

### `[review:ui]` flow（真的需要人）

tasks.md 仍有未勾 `[review:ui]` 項時，第一動作 **MUST** 是引導使用者跑 `pnpm review:ui` — 本地 GUI 自動依 `#N` / `#N.M` schema 配對截圖、可鍵盤完成 OK / Issue / SKIP、conflict-aware 寫回 tasks.md，不在 chat 內燒 token。完整工具行為見 `vendor/scripts/review-gui.mts`。

**NEVER** 預設用 `AskUserQuestion` 在 chat 內逐項彈對話框 — 那是 fallback，不是 default path。

**Fallback**（`pnpm review:ui` 不可用時 — consumer 沒有該 script、使用者明確拒絕 GUI、或 pure backend 完全無 UI 證據需求）：

1. 依 task 清單逐項準備截圖或證據
2. 說明截圖中看到的狀態
3. 問使用者這一項是否通過
4. 依使用者答覆決定勾選、保留未勾、或註記 skip

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

一個 change 同時含未勾 `[verify:auto]` + `[discuss]` + `[review:ui]` items 時，**MUST** 依以下順序執行（早→晚，讓 user 拿到的 review GUI 內容最完整）：

1. **apply 階段** — Step 8a Verify-Auto Pass：agent 自跑 `[verify:auto]` items 並寫 `(verified-auto:)` annotation
2. **archive 階段 Step 2.5** — Discuss Items Walkthrough：Claude 主動準備 `[discuss]` evidence、與 user 討論
3. **archive 階段 review GUI** — `pnpm review:ui` 一次處理所有未勾 `[review:ui]` + `[verify:auto]` items（user 在 GUI 看 evidence/screenshot 點 OK / Issue / Skip）

spectra orchestrator Archive Flow Step 1 已內建這個分流邏輯。

## 禁止事項

- **NEVER** 問「要不要我直接幫你勾完」
- **NEVER** 在未展示證據的情況下代勾任何 item（含 `[discuss]` items — Step 2.5 walkthrough 的 evidence 展示是強制前提）
- **NEVER** 對 `[review:ui]` items 在使用者尚未親自 round-trip 的情況下代勾，即使 Claude 已分析過程式碼
- **NEVER** 對 `[verify:auto]` items 代勾 `[x]` — agent 寫 `(verified-auto:)` annotation 是 evidence trail，user 在 GUI 點 OK 才能勾
- **NEVER** 對 `[verify:auto]` items 在 agent round-trip 沒成功（沒 final-state screenshot / 沒 network 觀察）的情況下寫 `(verified-auto:)` annotation
- **NEVER** 把 screenshot review 當成等同於人工功能驗證
- **NEVER** 為了通過 gate 而批次勾選未確認的項目
- **NEVER** 對 `[discuss]` items 寫入 `(claude-discussed: ...)` annotation 而沒有實際與使用者討論並取得 OK
- **NEVER** 派 `[verify:auto]` agent 前不檢查 dev-login route + seed.sql baseline — 撞 baseline 缺後升 UNCERTAIN 是浪費 budget；主線預先 grep 確認，缺則停下回報 user 補齊再派
- **NEVER** 在 verify-auto 派工當下才問 user「dev-login / seed 準備好了嗎」— baseline 是 codebase 層長期狀態，不該每次派工都驚動 user
