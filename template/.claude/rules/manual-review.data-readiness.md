---
description: Manual Review data-readiness 規約——propose 階段準備驗收資料的 hard rule、[review:ui] 純功能驗證 step actionability、`@no-manual-review-check` marker schema、截圖檔名配對；寫 proposal.md / tasks.md 時 path-scoped 載入
paths: ['openspec/changes/**/proposal.md', 'openspec/changes/**/tasks.md']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/manual-review.data-readiness.md
Edit at: <clade-central-repo>
Local edits will be reverted by the next sync.
-->


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

### `[verify:ui]` ready_signal 契約（分階段強制）

assertion-bearing `[verify:ui]` item（要驗「某具體內容有出現」而非純主觀視覺）**MUST** 能對應到一個**機械可判的 `ready_signal`**——screenshot agent capture 前 poll 它命中才拍、拍後 cross-check 它仍在才算 PASS（執行細節見 screenshot-review agent Verify Mode「必做動作」step 2-4 + `vendor/snippets/verify-channels/ui-final-state-brief*.template.md`）。

`ready_signal` 來源：主線在 `spectra-apply` Step 8a dispatch verify:ui 時，從 item 描述的**具體可斷言短語**建 structured signal（`text` / `text_all` / `text_any` / `selector` / `regex` / `min_rows`）。因此 item 描述本身 **MUST** 含一個具體、唯一、會出現在畫面上的斷言點（例「建議刀位壽命 143 秒」「逾期 badge」「`data-testid=suggested-baseline-row-T990201` 這列」），**NEVER** 只寫「畫面正常」「顯示資料」「狀態正確」這類無法 poll 的模糊語。

**分階段強制**：

- **新寫 / `ingest` 修改的 `[verify:ui]` item** → 描述 **MUST** 含可建 `ready_signal` 的具體斷言點；建不出 signal 的走下方「signal-less 分流」。
- **既有（已 archived 或本輪未 re-touch）item** → grandfather，screenshot agent 走 generic-settle fallback（不阻擋 archive；但 fallback **不能**當 assertion PASS 的充分條件，per brief template）。

**signal-less 分流**（描述無法產出具體斷言點時，二選一，**NEVER** 硬留 `[verify:ui]`）：

- **純主觀視覺**（spacing / 配色 / visual balance /「好不好看」）→ reclassify `[review:ui]`，user 親驗（見 `manual-review.evidence.md` § `[review:ui]` 收斂原則）。
- **需要互動才出現的狀態**（click / submit / multi-role 才能到的畫面）→ 該斷言屬 `[verify:e2e]` / `[verify:api]`，不是 final-state screenshot 能驗。

**為什麼**：<consumer-b> `monitoring-slot-suggested-life-and-cleanup`（2026-05-30）—— `[verify:ui]` item 驗「建議刀位壽命 inline 顯示 143 秒」，但該頁逐列建議值來自 async query，在 `wait_for_load()` **之後**才填；screenshot agent load 後立刻拍 → 拍到只有「0 秒 / 1,000 秒」的空殼，evidence 失真、user 無法作業。根因是「capture 前要等什麼」沒被宣告成機械可判 signal，agent 只能 `wait_for_load()` 後盲拍。把 `ready_signal` 變 item 契約 = agent 有明確 poll 目標、拍到真 final state。

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

1. **明確 URL** — 寫出要打開的具體頁面（含必要 query string / route param），不要只說「kiosk 頁」「dashboard」「設定頁」。**Host 部分 MUST 優先用 consumer 的 Cloudflare tunnel hostname**：
   - 該 consumer 對應 `.env*` 有 `TUNNEL_HOSTNAME=<host>` → 寫 `https://<host>/<path>`（HTTPS / 真實 cookie domain / 跨裝置可開；webauthn / OAuth callback / camera permission 等 HTTPS-only feature 也只能用 tunnel 驗）
   - 沒設 `TUNNEL_HOSTNAME`（如 `<consumer-d>`）→ fallback `http://localhost:<port>/<path>`，`<port>` 取自 `registry/consumers.json` 的 `dev_ports.nuxt`
   - Multi-app consumer（如 <consumer-a>: <client-a> 3040 / shared 3045）→ 依 change 觸碰的 app 反推 `.env.<app>` 找對應 `TUNNEL_HOSTNAME`；找不到 app hint **MUST** 在 propose 階段問清楚，不要靜默挑一個
   - 完整解析 SOP、反向 mapping 演算法、fallback decision table、tunnel lifecycle 規約：見 `~/offline/clade/vendor/snippets/tunnel-url-for-review/README.md`（cookbook 只在 clade home，agent 從絕對 path 讀）
   - **NEVER** 在同一 item 同時列 tunnel URL 跟 localhost URL（「試試這個或那個」），擇一寫即可
2. **逐步動作 sub-items** — 用 `#N.M` scoped 拆，每條 sub-item 一個原子動作（開 X → 輸入 Y / 點 Z → 確認 W）。**禁止**流程式描述（例「刷卡 → 進入毛刺 → 操作完成 → 自動回 standby」整條塞在 parent line）
3. **預期觀察具體化** — 每步寫清楚「應看到什麼 / 不應看到什麼」（具體 toast 文字、badge 狀態、欄位值、route 變化），**禁止**寫「畫面正常」「狀態正確」「操作完成」這類模糊驗收
4. **UI 元素 MUST 用使用者可見文字指代** — 引用 button / tab / card / region / selector / input / link / dialog / toast 等 UI 元素時，**MUST** 用使用者畫面上實際看得到的文字（i18n string、button label、tab 名稱、卡片標題 / region heading、placeholder、aria-label fallback），**NEVER** 用 codebase 內部識別符（component name、檔名、CSS class、test-id、store action、API endpoint name、fixture id、**DB 欄位名 / capability flag（例 `total_quantity` / `has_vending_location` / snake_case schema 欄位）**、**spec template heading（例 `Resolved Questions` / `Open Questions` / `Why` / `Impact` / `Decision <N>`）**、**propose 寫作 process 內部詞（例 `actual <noun>` / `zero-location copy` / `null-state copy` / `verified annotation`）**、**半中半英 mixed term（例「未設 vending 位置」「vending 庫存」「slot 位置」「tool body 規劃」）**）。User 看 UI 找不到 codebase 內部識別符對應的位置，整條 item 失去可執行性。寫作者**MUST** 先打開頁面確認該元素 user 實際看到的文字是什麼，再寫進 item。若需 cross-reference schema-level concept（例強調 boolean flag 對應的業務語義），**MUST** 用 backtick + 中文 gloss 形式（例 「取料機位置 (`vending_location`)」），不要裸寫識別符

### 反例：URL host 走 localhost 而非 tunnel

該 consumer 有設 `TUNNEL_HOSTNAME` 卻在 item 寫 `http://localhost:<port>`：違反通則 § 1，user 開不了（手機 / iPad / 別台電腦無 localhost）、HTTPS-only feature（OAuth / WebAuthn / camera permission / `SameSite=None` cookie）也驗不到。`UI_URL_LOCALHOST_WITH_TUNNEL_AVAILABLE` audit pattern 會命中。

❌ 不夠（<consumer-b> `.env.local` 有 `TUNNEL_HOSTNAME=tdms-dev.<maintainer-domain>` 卻寫 localhost）：

```markdown
- [ ] #2 [verify:ui] 首頁 `http://localhost:3000/?machine=9001` 監控表格 inline 顯示建議壽命與 info icon
  - [ ] #2.1 [verify:ui] 以 admin session 開 `http://localhost:3000/?machine=9001`，normal table 中 `<consumer-b>-SEED-SUGGESTED-LIFE-HEAD-IQM-001` 這列的「壽命狀態」欄位同時顯示既有本輪壽命資訊與建議壽命 `143 秒`。
```

✅ 好（改用 tunnel host，保留原 path + query string）：

```markdown
- [ ] #2 [verify:ui] 首頁 `https://tdms-dev.<maintainer-domain>/?machine=9001` 監控表格 inline 顯示建議壽命與 info icon
  - [ ] #2.1 [verify:ui] 以 admin session 開 `https://tdms-dev.<maintainer-domain>/?machine=9001`，normal table 中 `<consumer-b>-SEED-SUGGESTED-LIFE-HEAD-IQM-001` 這列的「壽命狀態」欄位同時顯示既有本輪壽命資訊與建議壽命 `143 秒`。
```

判斷準則（寫前自問）：

- 「我寫 URL 前有沒有先 grep 該 consumer `.env*` 找 `TUNNEL_HOSTNAME`？」否 → 補做，依結果決定 host
- Multi-app consumer（<consumer-a>: <client-a> 3040 / shared 3045）→ 依 change 觸碰的 app 反推 `.env.<app>`；無 app hint 在 propose 階段就問清楚
- 該 consumer 真的沒設 tunnel（如 `<consumer-d>`）→ fallback `http://localhost:<port>/<path>` 是合法的；hook 會自動 suppress 此 pattern 不 fire
- 完整解析 SOP、反向 mapping、fallback decision table：`~/offline/clade/vendor/snippets/tunnel-url-for-review/README.md`

### 反例：multi-card UI selector

❌ 不夠（用 Vue component 檔名指代區塊，user 看 UI 找不到「`SupplierComparison`」在哪）：

```markdown
- [ ] #3.2 [review:ui] 開 `/reports/costs` 採購價格 tab，在 `SupplierComparison` selector 選 `成本報表測試耗材 A`，點 `匯出 PDF`，開啟下載檔確認至少 2 個 supplier rows、最低價標示與欄位對齊可讀。
```

✅ 好（用 user 在頁面上實際看到的中文卡片標題 + 真實 button 文字 + 具體驗收觀察）：

```markdown
- [ ] #3.2 [review:ui] 開 `/reports/costs`、點頂部「採購價格」tab → 找到頁面中的「供應商比較」卡片 → 在卡片內品項 selector 選「成本報表測試耗材 A」→ 點該卡片下方「匯出 PDF」按鈕 → 開啟下載檔確認：(a) 至少 2 個 supplier rows、(b) 最低價那列有「最低價」badge、(c) 欄位橫向對齊不溢出。
```

判斷準則（寫前自問）：

- 「我寫的這個詞，user 不開 codebase 能在 UI 上看到嗎？」否 → 改成 user 看得到的
- 對動態 / runtime label，引用既有 i18n key 對應的 zh-TW 翻譯，**NEVER** 引用 i18n key 本身（user 看到的是翻譯後的字）
- 無可見文字的純圖示 button（icon-only）— 用「該卡片右上角的 ❌ 關閉圖示」「sidebar 最下面的齒輪圖示」等位置 + 圖示語義描述
- 同時引用 codebase 路徑只在「期望結果是改檔」時可用（極罕見，通常 `[review:ui]` 不該動 codebase）

### 反例：propose-process term 與半中半英 mixed term

❌ 不夠（含 propose-process term `Resolved Questions` + half-Chinese-half-English `vending 位置` + propose-process phrase `zero-location copy`）：

```markdown
- [ ] #4.2 [verify:ui] 確認 row 顯示 `total_quantity = 0` 與「未設 vending 位置」或 Resolved Questions 指定的 zero-location copy
```

✅ 好（純使用者語言 + 直接寫對應 UI 文字）：

```markdown
- [ ] #4.2 [verify:ui] 該列「總庫存」欄位顯示「0」；「位置」欄位顯示「尚未配置販賣機格位」灰色提示文字（不顯示任何位置 chip）
```

❌ 不夠（含 `actual total_quantity` + `Decision <N>` 引用 + `E 機格位` 半英半中）：

```markdown
- [ ] #5.2 [verify:ui] 在「刀具」tab 搜尋 X，確認 E 機格位顯示為「規劃中（未啟用）」徽章、且該品項的 actual total_quantity 顯示 `0`（per Decision 7 不計入庫存）
```

✅ 好（直接寫使用者觀察到的視覺結果）：

```markdown
- [ ] #5.2 [verify:ui] 在「刀具」tab 搜尋框輸入 X，該列「位置」欄位看到「E04（規劃中）」「E05（規劃中）」兩個橘色（warning）chip；「總庫存」欄位顯示「0」（E 機格位不算入總量）
```

判斷準則（寫前自問）：

- 「我有沒有用 spec template 的標題（Resolved Questions / Open Questions / Decision <N> / Why / Impact）？」是 → 刪掉，直接寫具體期望觀察
- 「我有沒有用 `actual <noun>` / `zero-location copy` / `null-state copy` 這類 propose 寫作時生成的形容詞 / phrase？」是 → 替換成具體中文（例 `actual quantity` → 「實際數量」）或直接寫 UI 文字
- 「我有沒有把英文 schema 詞嵌進中文句子？（例「未設 vending 位置」「vending 庫存」「slot 位置」）」是 → 改全中文匹配 UI label（先 grep 找實際 i18n string）

### URL query param 必須對照 page source（hard rule）

verify item 的 URL 含 query param（`?key=value`）時，**MUST** grep 對應 page `.vue` source 確認該 param 有被 `route.query` / `useRoute()` 使用。頁面不支援的 query param 等同 **dead deep-link** — navigate 到 URL 後 param 被靜默忽略，截圖拍到的是列表頁而非預期的 detail view。

寫前 self-check（**MUST**）：

```bash
# 1. 從 URL path 推 page file
PAGE=$(find packages/ -path "*pages/<url-path>.vue" -o -path "*pages/<url-path>/index.vue" 2>/dev/null | head -1)
# 2. 確認 route.query 有使用該 param
grep -c 'route\.query\|useRoute' "$PAGE"
# 0 = 頁面不讀 query → 禁止在 item URL 加 query param
```

**NEVER** 臆想 query param（如 `?approvalCaseId=...`、`?tab=...`）— 即使語意合理，頁面 source 沒寫就不支援。（per [[pitfall-verify-item-fake-url-no-interaction]]）

### Modal-based detail 的互動步驟格式（hard rule）

verify item 的預期觀察是 modal dialog 內容（審核明細、進度詳情等），但頁面的 detail view 是透過**點擊 table row / card button 開啟 modal dialog**、不是 URL 直接載入時，item 描述 **MUST** 寫明完整互動步驟：

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

**NEVER** 只寫「開 `<URL>`；預期 detail 顯示 ...」然後期望 navigate 就能看到 dialog — modal 需要 user/agent 互動才會開。（per [[pitfall-verify-item-fake-url-no-interaction]]）

### /my/ 頁面的 login 切換指示

employee-facing 頁面（`/my/**`）顯示的是**登入者自己的**資料。若 verify item 的 fixture 屬於特定員工（非預設 admin），item **MUST** 寫明 login 切換指示：

```
以 `<email>`（<姓名> <employee_no>，fixture owner）登入後，導航到 `/my/<path>` ...
```

**NEVER** 假設 admin 登入就能看到所有員工的 /my/ 資料 — /my/ 頁面只顯示 session user 的紀錄。

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

`pnpm review:ui` 設計成自動把截圖配到正確的 item，使用者不需要手動挑選。檔名格式見 [[screenshot-strategy]]（canonical SoT）。
