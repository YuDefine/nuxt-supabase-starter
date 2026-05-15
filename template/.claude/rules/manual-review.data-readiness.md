<!--
🔒 LOCKED — managed by clade
Source: rules/core/manual-review.data-readiness.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->

---
description: Manual Review data-readiness 規約——propose 階段準備驗收資料的 hard rule、[review:ui] 純功能驗證 step actionability、`@no-manual-review-check` marker schema、截圖檔名配對；寫 proposal.md / tasks.md 時 path-scoped 載入
paths: ['openspec/changes/**/proposal.md', 'openspec/changes/**/tasks.md']
---

# Manual Review — Data Readiness & Actionability

> Reference 檔。核心規約見 [`manual-review.md`](./manual-review.md)。本檔聚焦 `[review:ui]` / `[verify:ui]` 在 propose 階段就必須準備好驗收資料（sample identifier + 拆步驟 + seed），以及 `[review:ui]` step actionability、`@no-manual-review-check` bypass marker、截圖檔名 ↔ item id 配對。

## Pre-Review Data Readiness（hard rule）

寫 `## 人工檢查` 項目時，**MUST** 把驗收所需資料當成 item 的一部分**在 propose 階段就準備好**，不可叫使用者「找一張 X」「挑一筆 Y」。Review GUI 開頁的瞬間 = 使用者已能照 step 直接跑。

**前置假設**：本節規範的對象是「真正需要 user 親自跑」的 `[review:ui]` / `[verify:ui]` items。若 marker 本身誤標（例：把該由 agent 自驗的「按鈕應隱藏」標成 `[review:ui]`），先依 `manual-review.evidence.md` 的「`[review:ui]` 收斂原則」改 marker，再依本節準備資料。把該由 agent 做的事推給 user 是更嚴重的錯誤。

### 禁止的模糊指代

`[review:ui]` / `[verify:ui]` item 描述中 **NEVER** 出現下列模糊指代詞：

- 中：「某張」「某筆」「某個」「任一張」「任一筆」「隨便一張」「找一張」「挑一筆」「找某筆」「現有的一筆」「適合的一筆」
- En: `any X` / `some X` / `a record` / `pick one` / `find a X` / `an existing one`（後接無具體 ID 時）

propose / ingest 階段命中即視為違反，**MUST** 改寫。

### 必填三件事

每條 `[review:ui]` / `[verify:ui]` item **MUST** 在 propose 階段同時做到：

1. **Sample inline 引用** — item 描述內**直接寫具體 sample identifier**（PK `WR-9001` / UUID / business key `card_uid=04A1B2C3` / `staff email=admin@example.com` 等），讓 user 一眼看出該操作哪一筆
2. **多步驟驗收條列 Step** — 含 1+ 個分支、互斥狀態、對稱驗證、多角色切換時，**MUST** 拆 `#N.M` scoped sub-items；每個 sub-item = 單一可執行 step（打開哪頁 → 點哪裡 → 應看到什麼）
3. **Sample 持久化寫進 seed** — 對應 sample **MUST** 由 propose 階段對應的 `## N. Fixtures / Seed Plan` task 寫進專案 seed 檔（`supabase/seed.sql` 或 fallback path，見 `ux-completeness.md` 的「必填 Fixtures / Seed Plan」）。**禁止**只靠 dev DB 既有資料碰運氣、靠 ad-hoc INSERT 或 review 當下手動建 — 那些下次 reset DB 就消失，下個接手者重踩坑

### 範例：互斥 / 對稱驗收

❌ 不夠（模糊指代 + 未拆步驟 + 資料碰運氣）：

```markdown
- [ ] #4 [review:ui] Admin 在 /work-reports 對某張 voided 單嘗試 Archive（按鈕應隱藏；若仍有路徑進入則 dialog 送出後得到 422 友善訊息），對某張 archived 單嘗試 Void（同上對稱驗收）
```

✅ 好（具體 sample + scoped sub-items + seed 保證資料 ready）：

```markdown
- [ ] #4 [review:ui] /work-reports 互斥狀態驗收（voided ↔ archived 不可互轉，design Decision 7）
  - [ ] #4.1 開 /work-reports，狀態 filter 選「已作廢」→ 點 voided 樣本 `WR-9001` 開 detail slideover → 確認操作區**看不到**「封存」按鈕
  - [ ] #4.2 狀態 filter 改「已封存」→ 點 archived 樣本 `WR-9002` 開 detail slideover → 確認操作區**看不到**「作廢」按鈕
```

對應的 `## N. Fixtures / Seed Plan`（負責把 sample 落到 seed）：

```markdown
- [ ] N.M `work_reports` — voided 樣本 `WR-9001`（`void_reason='測試誤輸入'`）+ archived 樣本 `WR-9002`（`archive_reason='系統結構修正'`）→ 寫進 `supabase/seed.sql`
```

### 適用範圍

- **適用**：所有 `[review:ui]` / `[verify:ui]` items
- **不適用**：
  - `[discuss]` items（屬 Claude evidence-based 討論，sample 由 Claude 在 walkthrough 時準備）
  - `[verify:e2e]` items（Playwright spec 內自帶 fixture / factory，不靠 review GUI 互動）
  - `[verify:api]` items（curl / ofetch 自帶 request body，主線跑完寫 annotation）

### 為什麼這條 hard rule 存在

「某張 voided 單」這種模糊指代讓 review 階段 user 同時面臨三條全壞的路徑：

1. dev DB 沒對應狀態的資料 → review 卡住，回頭叫人補 seed
2. dev DB 有但 ID 跟 review writer 預期不同 → user 不確定哪一筆才是「對的那筆」
3. 資料是上次某 session ad-hoc INSERT 的 → 下次 reset DB 就消失，下個接手者從零踩坑

這條 rule 把「資料準備」的責任從 review 階段往前推到 propose / apply，review GUI 開頁 = 立刻能跑、不需要使用者偵查。

## `[review:ui]` 純功能驗證 step actionability（hard rule）

`[review:ui]` items 屬「真的需要人」白名單（email / webhook / 實體裝置 / 視覺主觀 / 真機 / SMS），但「需要人」≠「user 該自己摸索」。review GUI 開頁瞬間 user **MUST** 能照 step 逐步操作，不需要回頭問 Claude「要刷哪張卡」「URL 是什麼」「該看到什麼」。

### 通則

每條 `[review:ui]` item **MUST** 滿足「自帶導覽」標準：

1. **明確 URL** — 寫出要打開的具體頁面（含必要 query string / route param），不要只說「kiosk 頁」「dashboard」「設定頁」
2. **逐步動作 sub-items** — 用 `#N.M` scoped 拆，每條 sub-item 一個原子動作（開 X → 輸入 Y / 點 Z → 確認 W）。**禁止**流程式描述（例「刷卡 → 進入毛刺 → 操作完成 → 自動回 standby」整條塞在 parent line）
3. **預期觀察具體化** — 每步寫清楚「應看到什麼 / 不應看到什麼」（具體 toast 文字、badge 狀態、欄位值、route 變化），**禁止**寫「畫面正常」「狀態正確」「操作完成」這類模糊驗收

### 實體裝置 / 規格外輸入的替代路徑

涉及實體裝置交互（刷卡 / 掃 QR / 條碼槍 / 印表機 / 真機 / 規格外環境）的 item **MUST** 在 step 中寫明「dev 替代輸入路徑」，讓 user 不需要實體裝置也能跑 round-trip：

- 刷卡 → dev card UID input box / `/__dev/scan?uid=...` simulate endpoint
- 掃 QR → dev paste QR payload input
- 條碼槍 → 手動 type 條碼字串
- 真機 → desktop responsive emulation / dev role override
- SMS / 電話 → dev inbound webhook stub

替代輸入路徑屬 codebase 層 baseline（與 `verify:*` baseline 同性質）；若 dev override 尚未實作，**MUST** 登記到 consumer ROADMAP / tech-debt（TD-NNN），**NEVER** 在 propose 階段才現補、也 **NEVER** 在 step 中假裝它已存在然後叫 user 自己想辦法。

### 範例：kiosk 刷卡

❌ 不夠（流程式描述，user 看完不知道從哪開始 + 不知道用哪張卡 + 不知道沒實體 reader 怎麼模擬刷卡）：

```markdown
- [ ] #7 [review:ui] kiosk 平板實機驗證：刷卡 → 進入毛刺 → 操作完成 → 自動回 standby，且 token 已 consume
```

✅ 好（明確 URL + dev 替代輸入 + sample UID + 拆 scoped sub-items + 預期觀察具體化）：

```markdown
- [ ] #7 [review:ui] kiosk 刷卡 round-trip（standby → 操作頁 → 完成 → 自動回 standby + token consume）
  - [ ] #7.1 桌機開 `/kiosk`（dev mode 自帶右下角 card UID input），確認畫面為 standby（時鐘 + 「請刷卡」提示）
  - [ ] #7.2 右下 `Dev: card UID` input 輸入 `04A1B2C3`（admin 樣本卡，seed 已建）→ Enter
  - [ ] #7.3 畫面切到操作頁，header 顯示卡主姓名「測試 Admin」+ 操作選單可見
  - [ ] #7.4 點「完成操作」→ 看到 200 toast「操作已記錄」→ 2 秒內畫面自動切回 standby（時鐘畫面）
  - [ ] #7.5 另開 `/admin/kiosk-tokens?card_uid=04A1B2C3`，確認該 row `status=consumed` 且 `consumed_at` 為剛剛時間（±10s）
```

對應的 `## N. Fixtures / Seed Plan`：

```markdown
- [ ] N.M `kiosk_cards` — admin 樣本 `card_uid='04A1B2C3'`、`holder_name='測試 Admin'`、`role='admin'` → 寫進 `supabase/seed.sql`
```

對應 baseline（缺則登記，不在 propose 階段現補）：

```markdown
- TD-NNN：`/kiosk` 頁 dev card UID input（env-gated，僅 DEV 顯示）— 屬 kiosk verify baseline
```

### 為什麼這條 hard rule 存在

`[review:ui]` 已經是「真的需要人」白名單裡剩下的少數項目，每條都會直接燒 user 桌上的時間 + 思考成本。寫成「刷卡 → 進入毛刺 → 操作完成 → 自動回 standby」對 user 的 actionability = 0：

- 不知道開哪個 URL
- 不知道沒實體 reader 怎麼模擬「刷卡」
- 不知道 seed 裡有幾張卡、UID 是什麼
- 不知道「毛刺」是哪個畫面、看到什麼才算對

把「user 已經坐在桌機前、請逐步告訴他怎麼按」當成寫 propose 時的心智模型。寫不出來 = item 本身還沒 ready：(a) URL 還沒定、(b) dev 替代輸入 baseline 還沒、或 (c) 預期觀察還沒拍定。先補齊再上 review。

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

`pnpm review:ui` 設計成自動把截圖配到正確的 item，使用者不需要手動挑選。為此截圖檔名 **MUST** 以 item id 開頭：

```text
#<item-id>[<variant>]-<descriptor>.<ext>
```

例：item `#1` 的截圖命名為 `#1-clock-light.png`、`#1a-clock-dark.png`；scoped item `#3.1` 命名為 `#3.1-mobile.png`。

完整命名規範（含變體、legacy fallback、違反處理）見 `screenshot-strategy.md`。
