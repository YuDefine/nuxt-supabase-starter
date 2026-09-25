---
description: Manual Review data-readiness 規約——propose 階段準備驗收資料的 hard rule、[review:ui] 純功能驗證 step actionability、`@no-manual-review-check` marker schema、截圖檔名配對；寫 proposal.md / tasks.md 時 path-scoped 載入
paths: ['tasks/**', 'specs/plans/**', 'screenshots/**']
---
<!-- Clade native rule; source: rules/core/manual-review.data-readiness.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->
<!-- clade-adapters: claude,codex,cursor -->

## Runtime adapter boundary

The obligations, predicates, evidence schema, failure handling, and review timing in this source are shared. Concrete browser, dispatch, question, filesystem, and command mechanics are target-native and MUST come from the selected runtime fragment at the matching adapter path. A fragment declares only the capability it can prove; an absent or unverified capability remains blocked and MUST NOT be silently replaced by a neighbouring runtime.



# Manual Review — Data Readiness & Actionability

> 核心規約見 [[manual-review]]。本檔管驗收資料、step actionability 與 `@no-manual-review-check`。

## Pre-Review Data Readiness（hard rule）

寫 `## 人工檢查` 項目時，**MUST** 把驗收所需資料當成 item 的一部分**在 propose 階段就準備好**：review GUI 開頁的瞬間，使用者已能照 step 直接跑。marker 誤標時先依 [[manual-review.evidence]] § `[review:ui]` 收斂原則改 marker。

### 禁止的模糊指代

`[review:ui]` / `[verify:ui]` item 描述中 **NEVER** 出現下列模糊指代詞：

- 中：「某張」「某筆」「某個」「任一張」「任一筆」「隨便一張」「找一張」「挑一筆」「找某筆」「現有的一筆」「適合的一筆」
- En: `any X` / `some X` / `a record` / `pick one` / `find a X` / `an existing one`（後接無具體 ID 時）

propose / ingest 階段命中即視為違反，**MUST** 改寫。

### 必填三件事

每條 `[review:ui]` / `[verify:ui]` item **MUST** 在 propose 階段同時做到：

1. **Sample inline 引用** — item 描述內**直接寫具體 sample identifier**（PK `WR-9001` / UUID / business key `card_uid=04A1B2C3` / `staff email=admin@example.com` 等），讓 user 一眼看出該操作哪一筆
2. **多步驟驗收條列 Step** — 含 1+ 個分支、互斥狀態、對稱驗證、多角色切換時，**MUST** 拆 `#N.M` scoped sub-items；每個 sub-item = 單一可執行 step（打開哪頁 → 點哪裡 → 應看到什麼）
3. **Sample 持久化寫進 seed** — 對應 sample **MUST** 由 `## N. Fixtures / Seed Plan` task 寫進 seed 檔（[[ux-completeness]] § 必填 Fixtures / Seed Plan）。**禁止**靠 dev DB 既有資料、ad-hoc INSERT 或 review 當下手動建

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

### `[verify:ui]` ready_signal 契約（分階段強制）

assertion-bearing `[verify:ui]` item **MUST** 能對應到一個**機械可判的 `ready_signal`**（`text` / `text_all` / `text_any` / `selector` / `regex` / `min_rows`）：agent capture 前 poll 命中才拍、拍後 cross-check 仍在才算 PASS（`vendor/snippets/verify-channels/ui-final-state-brief*.template.md`）。所以 item 描述 **MUST** 含一個具體、唯一、會出現在畫面上的斷言點（「建議刀位壽命 143 秒」「逾期 badge」），**NEVER** 只寫「畫面正常」「顯示資料」。頁面內容常在 load 之後才由 async query 填，沒有 signal 只能盲拍空殼。

**分階段強制**：

- **新寫 / `ingest` 修改的 `[verify:ui]` item** → 描述 **MUST** 含可建 `ready_signal` 的具體斷言點；建不出 signal 的走下方「signal-less 分流」。
- **既有（已 archived 或本輪未 re-touch）item** → grandfather，screenshot agent 走 generic-settle fallback（不阻擋 archive；但 fallback **不能**當 assertion PASS 的充分條件，per brief template）。

**signal-less 分流**（描述無法產出具體斷言點時，二選一，**NEVER** 硬留 `[verify:ui]`）：

- **純主觀視覺**（spacing / 配色 / visual balance）→ reclassify `[review:ui]`
- **需要互動才出現的狀態**（click / submit / multi-role）→ `[verify:e2e]` / `[verify:api]`

### 適用範圍

適用所有 `[review:ui]` / `[verify:ui]` items；不適用 `[discuss]`（walkthrough 時準備）、`[verify:e2e]`（spec 自帶 fixture）、`[verify:api]`（request 自帶 body）。

## `[review:ui]` 純功能驗證 step actionability（hard rule）

「需要人」≠「user 該自己摸索」。review GUI 開頁瞬間 user **MUST** 能照 step 逐步操作，不需要回頭問「要刷哪張卡」「URL 是什麼」「該看到什麼」。寫不出來 = item 還沒 ready。

### 通則

每條 `[review:ui]` item **MUST** 滿足「自帶導覽」標準：

1. **明確 URL** — 具體頁面含必要 query string / route param（頁面用 `?tab=` 定 tab 就要寫進去），不要只說「kiosk 頁」「設定頁」。這條 URL 就是 review-gui「開啟畫面」的 `redirect=`；子項寫「同一 URL」時沿用父層或上一則 sibling 已補齊的那條。**Host MUST 依階梯擇一**（與 [[proactive-skills.manual-review-entry]] § 同一條 Iron Law 是同一道，不得分岔）：
   1. consumer `.env*` 有 `TUNNEL_HOSTNAME=<host>` → `https://<host>/<path>`（HTTPS-only feature 也只能用 tunnel 驗）
   2. 沒設 → review-gui preview proxy `https://review-gui.<maintainer-domain>/__preview/<devPort>/<path>`（`<devPort>` 取自 `registry/consumers.json` 的 `dev_ports.nuxt`）
   3. `http://localhost:<port>/<path>` **只給 agent 自己探測**，**NEVER** 出現在 `[review:ui]` item 裡（使用者手機上的 localhost 指向裝置自己）

   Multi-app consumer 依 change 觸碰的 app 反推 `.env.<app>`，找不到 app hint **MUST** 在 propose 階段問清楚。**NEVER** 在同一 item 同時列兩層 URL。解析 SOP 見 `~/offline/clade/vendor/snippets/tunnel-url-for-review/README.md`；`UI_URL_LOCALHOST_WITH_TUNNEL_AVAILABLE` pattern 會攔 localhost。
2. **逐步動作 sub-items** — 用 `#N.M` scoped 拆，每條 sub-item 一個原子動作（開 X → 輸入 Y / 點 Z → 確認 W）。**禁止**流程式描述（例「刷卡 → 進入毛刺 → 操作完成 → 自動回 standby」整條塞在 parent line）
3. **預期觀察具體化** — 每步寫清楚「應看到什麼 / 不應看到什麼」（具體 toast 文字、badge 狀態、欄位值、route 變化），**禁止**寫「畫面正常」「狀態正確」「操作完成」這類模糊驗收
4. **UI 元素 MUST 用使用者可見文字指代** — 用畫面上實際看得到的文字（button label、tab 名稱、卡片標題、placeholder；動態 label 用 zh-TW 翻譯而非 i18n key；icon-only 用位置 + 圖示語義），**NEVER** 用 codebase 內部識別符（component name、CSS class、test-id、API endpoint、DB 欄位名如 `total_quantity`）、spec template heading（`Resolved Questions` / `Decision <N>`）、propose 寫作內部詞（`zero-location copy`）、或半中半英詞（「未設 vending 位置」）。寫之前先打開頁面確認；要 cross-reference schema 概念時用中文 gloss（「取料機位置 (`vending_location`)」）

### 反例

```markdown
❌ - [ ] #6.1 [review:ui] 開 `https://<consumer-b>-dev.<maintainer-domain>/parts` →「刀片」→ 搜尋 `WDHT063006-G-ECP330`
   （`/parts` 預設不是刀片 tab，檢驗起點沒寫完）
✅ - [ ] #6.1 [review:ui] 開 `https://<consumer-b>-dev.<maintainer-domain>/parts?tab=tool_inserts` →「刀片」→ 搜尋 `WDHT063006-G-ECP330`

❌ - [ ] #3.2 [review:ui] 開 `/reports/costs` 採購價格 tab，在 `SupplierComparison` selector 選 `成本報表測試耗材 A`，點 `匯出 PDF`
✅ - [ ] #3.2 [review:ui] 開 `/reports/costs`、點頂部「採購價格」tab → 找到「供應商比較」卡片 → 品項 selector 選「成本報表測試耗材 A」→ 點「匯出 PDF」→ 下載檔至少 2 個 supplier rows、最低價那列有「最低價」badge

❌ - [ ] #4.2 [verify:ui] 確認 row 顯示 `total_quantity = 0` 與「未設 vending 位置」或 Resolved Questions 指定的 zero-location copy
✅ - [ ] #4.2 [verify:ui] 該列「總庫存」欄位顯示「0」；「位置」欄位顯示「尚未配置販賣機格位」灰色提示文字
```

### URL query param 必須對照 page source（hard rule）

verify item 的 URL 含 query param 時，**MUST** grep 對應 page `.vue` source 確認有被 `route.query` / `useRoute()` 使用——不支援的 param 會被靜默忽略。寫前 self-check：

```bash
# 1. 從 URL path 推 page file
PAGE=$(find packages/ -path "*pages/<url-path>.vue" -o -path "*pages/<url-path>/index.vue" 2>/dev/null | head -1)
# 2. 確認 route.query 有使用該 param
grep -c 'route\.query\|useRoute' "$PAGE"
# 0 = 頁面不讀 query → 禁止在 item URL 加 query param
```

**NEVER** 臆想 query param（[[pitfall-verify-item-fake-url-no-interaction]]）。

### Modal-based detail 的互動步驟格式（hard rule）

預期觀察是**點擊 row / card 才開的 modal dialog** 內容時，item 描述 **MUST** 寫明完整互動步驟：

```
導航到 `<列表頁 URL>`（<頁面名稱>）[，切到「<tab 名>」tab]，
找到 <識別欄位> 含「<fixture identifier>」的 row/card，
點擊該 row/card 開啟 <dialog 名>；
預期 dialog 顯示 <具體內容>。
```

寫前 self-check（**MUST**）：

```bash
# 確認 page 是否用 modal dialog 顯示 detail
grep -cE 'openDetail|openReview|openProgress|reviewOpen|modalOpen|EhrApprovalReviewModal' "$PAGE"
# > 0 = detail 走 modal，MUST 寫互動步驟；URL navigate 拍不到 dialog
```

**NEVER** 只寫「開 `<URL>`；預期 detail 顯示 ...」——navigate 開不了 modal。

### 要求特定身分的 item MUST 寫可點的 dev-login URL

只寫「以 `E2E-ADMIN`（`e2e-admin@dev.local`）登入」是**不可執行的指示**：fixture 帳號沒有密碼、沒有登入表單，唯一的路是 dev-login route。任何要求以特定身分驗收的 item（不分 `[review:ui]` / `[verify:ui]` / `[verify:e2e]`），**MUST** 把登入寫成可直接點的 URL：

```
開 `<base><dev-login-path>?as=<role>&redirect=<要驗收的 path>` 以 <role> 身分登入，落在 <頁面> → ...
```

真實員工 fixture（`/my/**` 這類只顯示 session user 資料的頁面）改用 `?email=`：

```
開 `<base><dev-login-path>?email=<email>&redirect=/my/<path>`（<姓名> <employee_no>，fixture owner）→ ...
```

`<dev-login-path>` **MUST** 照該 consumer 實際的 route 檔寫，**NEVER** 假設是 canonical `/auth/_dev-login`——legacy consumer 是 `/auth/__test-login`、better-auth 是 `/api/_dev/login`。SoT 是 `resolveDevLoginContract()`（`vendor/snippets/dev-auth/lib/detect-dev-login-route.ts`）算出的 `urlPath`，查法：

```bash
node -e "import('~/offline/clade/vendor/snippets/dev-auth/lib/detect-dev-login-route.ts').then(m => console.log(m.resolveDevLoginContract(process.cwd())))"
```

`<base>` 的選擇分兩條路：

- **本機契約 route**（screenshot agent、E2E、`/__preview`）：contract 的 `loopbackOnly` 為 true 時，`<base>` MUST 是 `http://127.0.0.1:<port>`。這類 route 的 gate 看 request IP，tunnel 來源會 404。
- **review-gui PWA「開啟畫面」**：每個 consumer 都走公開 `-dev.` origin 的 GET `/auth/_dev-login?as=<role>&email=e2e-<role>@dev.local&redirect=<inspect-path>`。`<inspect-path>` **MUST** 是該 item 的完整檢驗起點（path + 指定的 query／route param），不是父層 route。那條路 **MUST NOT** 做 loopback gate。**NEVER** 叫手機開 `http://127.0.0.1:<port>`，也 **NEVER** 讓開啟畫面落到 Google／人類登入頁。GUI 組連結時從 item 全文（含相對 path、bare query、同一組「同一 URL」／父層已補齊的 path）取最完整的那一條；**NEVER** 從中文標籤臆造 consumer 專屬參數，也 **NEVER** 用 `/` 充數。item 散文仍要寫得出身分與檢驗起點。

**NEVER** 只寫帳號 email / employee_no 就當作交代完登入方式。**NEVER** 假設 admin 登入就能看到所有員工的 /my/ 資料 — /my/ 頁面只顯示 session user 的紀錄。

review-gui 會從 item 文字渲染「🔑 以 &lt;role&gt; 登入並開啟」按鈕，但只在 consumer 有 dev-login route 時才掛——**寫出 URL 仍是 item 的責任**。

**身分字面 MUST 與 fixture canonical 命名逐字相同**：`E2E-<ROLE 全大寫>` / `e2e-<role>@dev.local`，`<role>` 一律 snake_case（`trac_payroll`，**不是** `trac-payroll`），且 MUST 是該 consumer dev-login route 認得的 role（不存在的 role 回 400）。合法 role 來源：route 檔頂端 `@dev-login-roles: a, b, c` 宣告與同檔 `DEV_LOGIN_FIXTURE_UUIDS` 的 key；**兩條都在則 MUST 一致**（不一致時 GUI 報 `role-list-unreadable` 並停用驗證）；role SoT 不在 route 檔內的 consumer **MUST** 寫宣告。

沒有機械稽核擋 dangling reference：寫 item 的人 **MUST** 當場跑一次 `resolveDevLoginContract` 與 route 檔 grep，確認 role 與檢驗起點存在。身分與完整檢驗起點 **MUST** 逐字寫在 item 散文內（它是面板組「開啟畫面」連結的唯一來源），**NEVER** 另建 sidecar entry 當事實來源。

### 實體裝置 / 規格外輸入的替代路徑

涉及實體裝置交互（刷卡 / 掃 QR / 條碼槍 / 印表機 / 真機 / 規格外環境）的 item **MUST** 在 step 中寫明「dev 替代輸入路徑」，讓 user 不需要實體裝置也能跑 round-trip：

- 刷卡 → dev card UID input box / `/__dev/scan?uid=...` simulate endpoint
- 掃 QR → dev paste QR payload input
- 條碼槍 → 手動 type 條碼字串
- 真機 → desktop responsive emulation / dev role override
- SMS / 電話 → dev inbound webhook stub

替代輸入路徑屬 codebase 層 baseline；尚未實作就 **MUST** 登記到 consumer ROADMAP / tech-debt，**NEVER** 在 step 中假裝它已存在。

### 範例：kiosk 刷卡

❌ 不夠（流程式描述，不知道 URL、用哪張卡、沒 reader 怎麼刷）：

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

## `@no-manual-review-check` Marker（hard rule）

hook regex 誤判或合法例外（真機掃 SMS 驗證碼等無 dev replay endpoint 的場景），在行尾加 `@no-manual-review-check[<reason>]` 跳過 Pre-Review Data Readiness regex 檢查（manual-review-check.sh 與 review-gui banner 都 skip）。它**只** scope 在這一層，**MUST NOT** 用來掩蓋 kind 分類、`@no-screenshot` 或 evidence trail 的問題。

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

skip 時 **MUST** emit `[info] tasks.md:<lineno> bypass: <reason>`。某類 reason 跨 consumer 出現 ≥ 5 次時應調整 pattern，而非繼續累積 bypass。Hook 與 review-gui 共用 `vendor/snippets/manual-review-enforcement/patterns.json` 與同一份 bypass parser。

## 截圖檔名與 item id 配對（hard rule）

截圖檔名首段 token MUST 等於 item id，人才不需要手動挑選。檔名格式見 [[screenshot-strategy]]（canonical SoT）。
