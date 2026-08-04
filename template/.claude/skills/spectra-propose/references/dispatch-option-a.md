<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/spectra-propose/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# spectra-propose — Step 0 選項 A Codex flow

> 本檔是 `spectra-propose/SKILL.md` 的執行細節分冊（clade fork 加料，2026-08-02 自 SKILL.md 抽出以縮 invoke 成本）。
> SKILL.md 對應 step 的 inline pointer 指到本檔；**MUST 依 pointer 指示完整讀對應 § 再執行**。
> 行為 gate（NEVER / MUST 判定）留在 SKILL.md inline；本檔是操作 recipe / 範本 / 查表。

---

## 選項 A 全流程（Phase 0a draft prompt 範本 + dispatch + watch；Phase 0b cross-check step 1–10）

   ### 選項 A：Codex flow（Codex draft + 主線 cross-check）

   #### Phase 0a：派 Codex 在背景跑

   依以下順序執行（每一步都是主線 Claude 自己做，不需使用者介入）：

   1. **解析 change name + requirement**：從 argument / discuss artifacts / 對話脈絡萃取，導出 kebab-case `<change-name>` 與一句話 requirement
   2. **Write prompt 檔到 `/tmp/codex-spectra-propose-<change-name>-prompt.md`**，內容固定包含：

      ```
      請以本 repo 的 spectra-propose 流程建立 change `<change-name>`。
      Requirement：<一句話需求>

      Plan-first（**MUST**，per `.claude/rules/agent-routing.md` Plan-first 條目）：
      在動任何 Edit / Write / Bash 寫入動作之前，先在 stdout 最開頭輸出一段 `## Plan` section，包含：
      - **要動的具體檔案**（每條一行的相對路徑，例如 `openspec/changes/<change-name>/proposal.md`、`openspec/changes/<change-name>/design.md`、`openspec/changes/<change-name>/tasks.md`、`openspec/changes/<change-name>/specs/<capability>/spec.md`）
      - **每個檔案打算寫什麼**（一句話 — 例如 proposal.md 的章節列表、design.md 的決策骨架、tasks.md 預期 phase 數量與分層、specs 的 ADDED/MODIFIED/REMOVED 走向）
      - **預期 phase 切分**（特別是 UI view phase vs 非 view phase 的邊界，呼應下方 Phase Purity 規則）
      Plan 寫完後**立刻**繼續執行，**不要**停下來等確認。Plan 是事前公開思路給主線 Claude cross-check，不是 review gate。

      讀取以下檔案理解流程後執行：
      - .claude/skills/spectra-propose/SKILL.md（**只執行 Step 1 ~ 11**，**跳過** Step 0 — 已決定由你執行）
      - .claude/rules/ux-completeness.md（必填區塊：Affected Entity Matrix / User Journeys / Implementation Risk Plan + Fixtures / Seed Plan + Design Review 7 步 template）
      - .claude/rules/agent-routing.md
      - 任何 discuss 階段已捕獲的 design.md / spec.md（位置：openspec/changes/<change-name>/，若已存在）

      若 change 包含 UI scope 且 proposal 有 ## Affected Entity Matrix（= entity 動且有 UI 展示），tasks.md **必須**包含 `## N. Fixtures / Seed Plan` section（每個有 Surfaces 的 entity 一條 task，或 `**Existing seed sufficient**` 宣告 + 一行理由）。

      **Phase Purity（UI view vs 非 view 必須切成獨立 phase）**：
      若 change 同時涉及 UI view 層（`.vue` / `.tsx` / `.jsx` / `app/pages/` / `app/components/` / `pages/` / `components/` / `views/` / `layouts/` / `.css` / `.scss`）與**非 view 工作**（schema / migration / API server / store / hook / API client / type / util / 純 backend），tasks.md **必須**把這兩類切成不同的 `## N.` phase：
      - 例：`## 1. Database Schema` + `## 2. API Endpoints` + `## 3. Pinia Store + Composables` + `## 4. UI View Implementation` + `## 5. Fixtures / Seed Plan` + `## 6. Design Review`
      - **禁止**把 view 層改動（`.vue` / `app/pages/` 等）與非 view 工作混進同一 phase
      - 理由：spectra-apply 會把 UI view phase 由主線 Claude Code 自己做、其他 phase 派給 codex；混雜 phase 會破壞 dispatch 規則
      - frontend 但非 view 的（store / hook / API client / type / util / unit test）算非 view，可以與 backend 工作放同 phase 或自己一個 phase 都可

      若 change 包含 UI scope（tasks 涉及 .vue / pages/ / components/ / layouts/），tasks.md **必須**包含完整 7 步 Design Review section（N.1~N.7）：
        - N.1 檢查 PRODUCT.md / DESIGN.md
        - N.2 /design improve + Fidelity Report
        - N.3 修復 DRIFT loop
        - N.4 按 canonical order 跑 targeted impeccable skills
        - N.5 /impeccable audit Critical = 0
        - N.6 review-screenshot 視覺 QA
        - N.7 Fidelity 確認

      **Manual Review Item Kind Marker（hard rule，所有 change）**：
      `## 人工檢查` 區塊每條 checkbox 行 **MUST** 在 `#N` / `#N.M` 後緊接 leading kind marker：`[review:ui]` / `[discuss]` / `[verify:e2e]` / `[verify:api]` / `[verify:ui]`，或 verify multi-marker `[verify:<a>+<b>]` / `[verify:<a>+<b>+<c>]`（channels 僅限 `e2e` / `api` / `ui`）。

      - `[review:ui]` — 需要使用者親自確認的 UI / UX 驗收。Claude 禁止代勾。
      - `[discuss]` — Claude 主導的 evidence-based 討論（production 授權 / 商業判斷 / production 觀察 / 後端 evidence 查驗 / 合理性檢查）。spectra-archive Step 2.5 walkthrough 由 Claude 主動準備證據與使用者討論。
      - `[verify:e2e]` — Playwright spec-based automated journey / persistence evidence。
      - `[verify:api]` — curl / ofetch / fetch HTTP round-trip evidence。
      - `[verify:ui]` — screenshot-review `mode: verify` final-state screenshot + DOM observation；使用者仍需 review GUI 確認。
      - `[verify:api+ui]` / `[verify:e2e+ui]` 等 multi-marker — 同一 business assertion 需要多個 evidence channels。

      **NEVER** author new `[verify:auto]` markers。若 draft 產生 `[verify:auto]`，主線 cross-check 必須 inline 替換成 explicit marker：pure API → `[verify:api]`；mutation + visual → `[verify:api+ui]`；persistence / full journey → `[verify:e2e]`。

      **分類指引**：描述含 SSH / `docker exec` / `psql` / `\d <table>` / `SELECT ... FROM` / 受控 drift 製造 / migration 存在性驗證 / 合理性檢查等 evidence-collection pattern → `[discuss]`；若 `curl` / HTTP round-trip 可重現 → `[verify:api]`；mutation persistence / reload journey → `[verify:e2e]`；純 final-state 視覺 → `[verify:ui]`；mutation + visual → `[verify:api+ui]`；真的需要人 → `[review:ui]`。

      **Backend-only Manual Review 規約**（適用 `## User Journeys` 為 `**No user-facing journey (backend-only)**` 的 change）：
      tasks.md 的 `## 人工檢查` **只**允許 `[discuss]` kind 的代表性 use cases：(1) production 授權 (2) 商業判斷 (3) production 觀察，以及可由 HTTP 重現的 `[verify:api]` round-trip。**禁止**把 SSH / psql / `\d <table>` / `SELECT FROM` / `SET session_replication_role` / 受控 drift 製造 / migration 存在性驗證等 evidence collection 寫進 `## 人工檢查` — 這些 **MUST** 寫進新的 `## N. Backend Verification Evidence` section 由 apply 階段 Claude 自跑自貼。若三類與 `[verify:api]` 都沒有，`## 人工檢查` 寫成固定文字 `_本 change 為 backend-only，所有驗證由 apply 階段 Claude 自跑（見 `## N. Backend Verification Evidence`）；deploy 前無使用者人工檢查項目。_`。完整規約見 `.claude/rules/ux-completeness.md` 「必填 Backend-only Manual Review 規約」與 `.claude/rules/manual-review.md` 「Item Kind Marker」。

      **Manual Review Items 強制段（user-facing change 適用）**：
      凡 `## 人工檢查` items 涉及以下情境時，**MUST** 拆 `#N.M` scoped sub-items 並 inline 具體 sample identifier：

      - NFC / 刷卡 / 員工卡 / 員工 UID / 卡片 UID
      - staff login / user role / 多角色 authz
      - 業務 entity 操作（具體 work_report id / equipment id / loan id / business key）
      - 多步驟流程（流程含「→」「然後」「接著」「完成後」等過渡詞 ≥ 2 個串接）
      - 實體裝置（kiosk / 平板 / 真機 / 印表機 / 條碼槍）

      **MUST** 從 `docs/FIXTURES.md`（或 `supabase/seed.sql` / 對應 seed file）抓 stable sample identifier，並在 `## N. Fixtures / Seed Plan` task 確認該 sample 寫進 seed。

      **反面範例（禁止）**：
      - ❌ `刷卡 → 進入毛刺 → 操作完成 → 自動回 standby`（無 URL、無 UID、無 step）
      - ❌ `使用者輸入某個 staff 卡號`（模糊指代）
      - ❌ `進入報工頁面送出`（無具體 report id、無 button selector）

      **正面範例（要求）**：
      ```
      - [ ] #N [review:ui] kiosk 毛刺流程 round-trip 驗證
        - [ ] #N.1 開 http://localhost:8787/kiosk/workstation → 確認 standby 頁面
        - [ ] #N.2 點「手動輸入」按鈕 → 輸入 flat_burr UID `047D6201CC2A81` → 點確認
        - [ ] #N.3 點「手動輸入」→ 輸入 staff UID `04469C0FCB2A81` → 自動 navigate /kiosk/workstation/deburring?...
        - [ ] #N.4 DevTools Application → Session Storage → 確認 key `kiosk:scan-token` 存在
        - [ ] #N.5 選系列 HGH15C → 輸數量 1 → 送出 → 完成回饋畫面
        - [ ] #N.6 等 3 秒 auto-return → URL = /kiosk/workstation → sessionStorage key 已消失
      ```

      **寫完 tasks.md 後 MUST 自查**：
      ```bash
      grep -nE '(刷卡|某張|某筆|任一|挑一筆|隨便|→.*→)' openspec/changes/<change-name>/tasks.md
      ```
      若有 hit 在 `## 人工檢查` 區塊 → 改寫成 scoped sub-items + inline sample。完整規約見 `.claude/rules/manual-review.md` 「`[review:ui]` 純功能驗證 step actionability」+「Pre-Review Data Readiness」。

      **Artifact 語言遵循**：
      開工前先 `grep -lE "繁體|繁中|不要使用簡體" CLAUDE.md .claude/rules/*.md 2>/dev/null`。若命中（consumer 規定繁體中文），**全部** artifact（proposal.md / design.md / tasks.md / spec.md）**MUST** 用繁體中文撰寫，**禁止**英文 artifact。code 識別字、技術名詞（如 `audit_signed_chain`、`business_keys_drift`）、SQL/code block 不譯。若 grep 未命中視為無語言規定。

      完成標準：`spectra validate <change-name>` 通過。**NEVER 執行 `spectra park`** —— change 維持
      active，artifacts 留在 disk（決策見 `docs/decisions/2026-07-31-propose-does-not-park.md`）。
      不要呼叫 /spectra-apply。產出後在 stdout 摘要 artifacts 列表 + `spectra validate` 結果。
      ```
   3. **背景啟動 codex exec**（**Bash** tool 加 `run_in_background=true`）：

      ```bash
      cd <consumer-repo-root> && codex exec \
        --model gpt-5.6-sol \
        --dangerously-bypass-approvals-and-sandbox \
        --skip-git-repo-check \
        -c model_reasoning_effort=max \
        < /tmp/codex-spectra-propose-<change-name>-prompt.md 2>&1
      ```

   4. **立刻**簡短回報給使用者：「已派 Codex GPT-5.6-sol max 在背景 draft `/spectra-propose <change-name>`（bash job `<id>`），完成後主線會 cross-check 並補 Design Review template」
   5. 啟動 **Codex Watch Protocol**（見 `.claude/rules/agent-routing.codex-watch-protocol.md` § 監看排程 A. 主線直接 Bash 派）— **notification-only**：派出後**不**下短輪詢，主線 idle 等 `<task-notification>`；只下**一個**安全網 fallback `ScheduleWakeup(1500, "codex spectra-propose <change-name> 安全網檢查 — 預期靠 task-notification 收尾")`（~25 分，防 hang-type 失敗；`fetch failed` / auth 等 exit-type 失敗 codex 會直接 exit → background bash 完成 → 通知**立刻**觸發，不需輪詢）。**NEVER** 用 `ScheduleWakeup(180)` 短輪詢 — 每 3 分鐘醒來重讀整段 context 正是 notification-only 要消除的負擔

   #### Phase 0b：主線 Cross-Check（codex 完成後**立刻**執行）

   收到 `<task-notification> status=completed` 時**立刻**依序執行：

   1. **Read codex stdout** 摘要：BashOutput 讀完整 stdout，回報 artifacts list / `spectra validate` 結果

   2. **若 codex 仍 `spectra park` 了**（不該發生，draft prompt 已明令禁止）：先
      `spectra unpark <change-name>` 把 artifacts 還原到 disk 才能繼續 cross-check

   3. **跑 post-propose-check.sh**（檢查 User Journeys / Affected Entity Matrix / Implementation Risk Plan / Design Review 7 步）：

      ```bash
      bash scripts/spectra-advanced/post-propose-check.sh <change-name>
      ```

      若有 FINDINGS → 主線**自己**直接 Edit proposal.md / tasks.md 補齊（**不要**回 codex 修，太慢）

   3a. **跑 post-propose-manual-review-check.sh**（檢查 ## 人工檢查 item step actionability，per Layer B of `manual-review.md` mechanical enforcement）：

      ```bash
      bash scripts/spectra-advanced/post-propose-manual-review-check.sh <change-name>
      ```

      Exit 2 = 有 findings（ABSTRACT_REFERENCE / CARD_WITHOUT_UID / UI_ITEM_NO_URL / MULTI_STEP_NOT_SCOPED 任一）→ 主線**自己**直接 Edit tasks.md 改寫 ## 人工檢查 items：拆 `#N.M` scoped sub-items、inline 具體 sample UID（從 `docs/FIXTURES.md` 抓）、加具體 URL、模糊驗收動詞改為 falsifiable observation。完整修正指引見 hook stdout + `.claude/rules/manual-review.md`「`[review:ui]` 純功能驗證 step actionability」。

      Legitimate false positive（e.g., 真機掃 SMS 無 dev replay endpoint）→ 在該 item 加 `@no-manual-review-check[<reason>]` trailing marker。

   3b. **Check 7 hard gate — `## 人工檢查` canonical `#N` / `#N.M` 格式驗證**（per TD-242）：

      ```bash
      bash scripts/spectra-advanced/post-propose-check.sh --check7-only <change-name>
      ```

      Exit 1 = `## 人工檢查` items 不符合 canonical `#N` parent / `#N.M` scoped item 格式（缺 `#` ID、用 section 編號如 `6.1`、或完全沒 ID）→ 主線**自己**直接 Edit tasks.md 修正為 canonical 格式（`- [ ] #1 ...`、`  - [ ] #1.1 ...`），重跑直到 exit 0。

      **MUST** exit 0 才能繼續 step 4。Exit 1 時 **NEVER** 跳過 — malformed items 會讓 review-gui 無法寫回 checkbox state，整個人工檢查 workflow 卡死。

   4. **跑 design-inject.sh**（若 UI scope，提醒 7 步 template）：

      ```bash
      bash scripts/spectra-advanced/design-inject.sh <change-name>
      ```

   5. **若 Design Review section 缺或不完整 7 步 → 主線自己 Edit tasks.md 補齊**：

      位置：tasks.md 最後一個功能區塊之後、`## 人工檢查` 之前。N = 上一個功能區塊的序號 + 1。

      ```markdown
      ## N. Design Review

      - [ ] N.1 檢查 PRODUCT.md（必要）+ DESIGN.md（建議）；缺 PRODUCT.md 跑 /impeccable teach、缺 DESIGN.md 跑 /impeccable document
      - [ ] N.2 執行 /design improve [affected pages/components]，產出 Design Fidelity Report
      - [ ] N.3 修復所有 DRIFT 項目（Fidelity Score < 8/8 時必做，loop 直到 DRIFT = 0，max 2 輪）
      - [ ] N.4 依 /design improve 計劃按 canonical order 執行 targeted impeccable skills（layout / typeset / clarify / harden / colorize 等實際所需項目）
      - [ ] N.5 執行 /impeccable audit，確認 Critical = 0
      - [ ] N.6 執行 review-screenshot，補 design-review.md / 視覺 QA 證據
      - [ ] N.7 Fidelity 確認 — design-review.md 中無 DRIFT 項
      ```

      `[affected pages/components]` 替換為此 change 實際涉及的 UI 檔案/頁面。

   5.5 **Manual Review Marker Hygiene Check**（所有 change，不限 backend-only）：

      Read tasks.md `## 人工檢查` 區塊全部 checkbox，依以下 hygiene rules 檢查並修正。違規 → 主線**自己**直接 Edit tasks.md（**不**回 codex 修，太慢）。

      **Rule 1：每條 item line MUST 有 leading marker**

      - 每條 `- [ ] #N ...` / `- [ ] #N.M ...` line **MUST** 在 id 後緊接合法 marker：`[review:ui]` / `[discuss]` / `[verify:e2e]` / `[verify:api]` / `[verify:ui]` / verify multi-marker `[verify:<a>+<b>]` 或 `[verify:<a>+<b>+<c>]`
      - Verify multi-marker channels 僅限 `e2e` / `api` / `ui`，canonical order 是 `e2e → api → ui`
      - Multi-marker **MUST NOT** 與 `[review:ui]` / `[discuss]` 混用；`[verify:api+review:ui]` / `[verify:api+discuss]` 非法
      - 缺 marker → 依下方 Rule 2 / Rule 3 / Rule 4 的內容分類補上正確 marker；**禁止**仰賴 Default Kind Derivation Rule（fallback 只給既有 in-flight legacy item 用，且 fallback 不涵蓋任何 `verify:*`）
      - 新 item **MUST NOT** 使用 `[verify:auto]`；若 codex draft 含 `[verify:auto]`，主線 inline 替換成 explicit marker（pure API → `[verify:api]`；mutation + visual → `[verify:api+ui]`；persistence / full journey → `[verify:e2e]`）

      **Rule 2：Evidence-collection items MUST 標 `[discuss]` 或 `[verify:api]`**

      若 item description 含下列 evidence-collection 動詞 / 模式：

      - `Apply ... migration`、`verify ... exists`
      - `SSH`、`docker exec`、`psql`
      - `\d <table>`、`SELECT ... FROM`
      - `curl`、`Trigger ... cron`、`Run /_cron/`
      - `SET session_replication_role`、`UPDATE ... WHERE`、受控 drift 製造
      - 「合理性檢查」、「分布是否符合預期」等商業判斷類

      行為：

      - SSH / psql / `\d` / `SELECT` / 受控 drift / migration existence / 商業判斷 → `[discuss]`
      - `curl` / HTTP endpoint round-trip 若可由 apply 主線重現 → `[verify:api]`
      - 若該 item 標了 `[review:ui]`、`[verify:ui]`、或 deprecated `[verify:auto]` → flag misclassified，主線改為 `[discuss]` 或 `[verify:api]`（依是否可由 HTTP 重現）
      - **若該 change 為 backend-only**（proposal 含 `**No user-facing journey (backend-only)**`）：
        - SSH / psql / `\d` / `SELECT` / 受控 drift 製造 / migration 存在性驗證等**純技術 evidence**項目 **MUST** 從 `## 人工檢查` 搬到 `## N. Backend Verification Evidence` section（N = 最後一個功能區塊序號 + 1，位於最後功能區塊之後、`## 人工檢查` 之前）由 apply Claude 自跑自貼。`## 人工檢查` 只保留 production 授權 / 商業判斷 / production 觀察三類 `[discuss]` items，以及可由 HTTP 重現的 `[verify:api]` items
        - 若 Backend Verification Evidence 已存在，append 而非新增
        - 若移完後 `## 人工檢查` 為空 → 替換成固定文字：`_本 change 為 backend-only，所有驗證由 apply 階段 Claude 自跑（見 `## N. Backend Verification Evidence`）；deploy 前無使用者人工檢查項目。_`
      - **若該 change 為 user-facing**：evidence-collection items 可留在 `## 人工檢查`，但**MUST** 標 `[discuss]` 或 `[verify:api]`；Claude 在 archive Step 2.5 walkthrough 主動準備 `[discuss]` evidence，apply Step 8a 主線自跑 `[verify:api]`

      **Rule 3：Real user round-trip items 依 channel 分流**

      若 item 描述含真實使用者 round-trip（具體 URL + 使用者動作 + 預期 server/UI 結果），依 evidence shape 標記：

      - persistence / reload / full journey → `[verify:e2e]`
      - HTTP status / backend contract → `[verify:api]`
      - final-state visual only → `[verify:ui]`
      - mutation response + visual state → `[verify:api+ui]`
      - journey + extra screenshot evidence → `[verify:e2e+ui]`
      - 真的需要人（見 Rule 4）→ `[review:ui]`

      誤標 `[discuss]` → 主線改為適當 `verify:*` 或 `[review:ui]`。

      **Rule 4：「真的需要人」白名單 — 落單者改 explicit verify channel**

      `[review:ui]` 只給「agent 用 agent-browser 也跑不了」的項目。description 含下列任一關鍵字才 `[review:ui]`：

      - 收 email / 收 webhook（agent inbox 不可達）
      - 「視覺主觀」/「美感」/「a11y 主觀判斷」
      - 「實體裝置」/「真機」/「手機」/「平板」/ 「kiosk QR」/「印表機」/「條碼槍」
      - 「跨機器」/「跨 session」/ 生產環境授權後操作
      - 「電話」/「SMS」等規格外的非 UI 環境

      其餘真實使用者 round-trip → **MUST** 標 explicit verify channel：

      - 純 final-state 視覺：`[verify:ui]`
      - 權限拒絕 path / HTTP status：`[verify:api]`
      - mutation + toast / banner / list refetch / badge / sort / count：`[verify:api+ui]`
      - reload persistence / edge payload journey：`[verify:e2e]`

      行為：

      - 若 item 標了 `[review:ui]` 但描述符合 verify channel 條件（不在白名單） → flag misclassified，主線改為 explicit `verify:*`
      - 若 item 標了 `verify:*` 但描述需收 email / 實體裝置 / 視覺主觀（在白名單）→ flag misclassified，主線改為 `[review:ui]`

      反面範例：

      ```markdown
      ❌ - [ ] #1 [review:ui] admin /settings 改排程 09:00 → reload 仍 09:00
         理由：reload persistence 應由 Playwright spec 驗；應該 [verify:e2e]

      ✅ - [ ] #1 [verify:e2e] admin /settings 改排程 09:00 → 200 toast → reload 仍 09:00
      ✅ - [ ] #1 [verify:api+ui] admin /settings 改排程 09:00 → PATCH 200 + 畫面顯示新值
      ✅ - [ ] #2 [review:ui] cron 觸發 → 借用人 inbox 收到逾期通知 email
      ✅ - [ ] #3 [discuss] production seed 授權與 cron 監控確認
      ```

      **Rule 5：`[review:ui]` step actionability — 流程式描述要拆**

      對標 `[review:ui]` 的 line，檢查描述是否屬「流程式描述」（user 看完仍不知道從哪開始）。命中下列任一條件 → flag 為非 actionable，**MUST** 由主線直接 Edit tasks.md 改寫：

      - **流程式串接**：parent line 含 ≥ 2 個串接動詞（「刷卡 → 進入 → 完成 → 回 standby」「掃 QR → 進入 → 提交」「掃條碼 → 入庫 → 列印標籤」等）但**未拆 `#N.M` sub-items**
      - **缺具體 URL**：item 描述未出現任何 `/xxx` 路徑或具體頁面 anchor（只說「kiosk 頁」「dashboard」「設定頁」不算）
      - **實體裝置動詞但缺替代輸入線索**：描述含「刷卡」「掃 QR」「掃條碼」「印表機」「真機」「平板」「kiosk」等實體裝置動詞，但未提及 dev override（UID input / simulate endpoint / paste payload / desktop responsive emulation 等）也未引用具體 sample（UID / payload / 條碼字串）
      - **模糊驗收動詞**：描述含「正常」「正確」「能用」「順利」「OK」這類無 falsifiable observation 的字眼（無「200 toast `X`」「badge 變 Y」「URL 變 /Z」這類具體觀察）

      行為：

      - 主線直接 Edit tasks.md，依 `manual-review.md` 的「`[review:ui]` 純功能驗證 step actionability」拆 `#N.M` scoped sub-items：每條一個原子動作（開 URL → 輸入 Y / 點 Z → 確認具體觀察 W）
      - 若改寫需要的 dev override / baseline 未就緒（grep consumer codebase 找不到 dev input route / simulate endpoint / seed sample），**MUST** 在 design.md「Open Questions」或 tasks.md TD-NNN 段登記 baseline 缺口，並在 item 行尾加 `@followup[TD-NNN]` marker
      - 若 sample 在 seed 中尚未建，**MUST** 在 `## N. Fixtures / Seed Plan` 補對應 task；引用的 stable identifier（UID / business key）與 item 描述一字不差
      - 完整規約見 `manual-review.md` 的「`[review:ui]` 純功能驗證 step actionability」

      反面範例：

      ```markdown
      ❌ - [ ] #7 [review:ui] kiosk 平板實機驗證：刷卡 → 進入毛刺 → 操作完成 → 自動回 standby，且 token 已 consume
         理由：流程式串接、無具體 URL、無 sample UID、無 dev 替代輸入路徑、模糊驗收（「操作完成」「token 已 consume」未指明在哪查、看到什麼）

      ✅ - [ ] #7 [review:ui] kiosk 刷卡 round-trip（standby → 操作頁 → 完成 → 自動回 standby + token consume）
           - [ ] #7.1 桌機開 /kiosk，確認 standby（時鐘 + 「請刷卡」提示）
           - [ ] #7.2 右下 `Dev: card UID` input 輸入 `04A1B2C3`（admin 樣本卡）→ Enter
           - [ ] #7.3 切到操作頁，header 顯示「測試 Admin」+ 操作選單
           - [ ] #7.4 點「完成操作」→ 200 toast「操作已記錄」→ 2 秒內回 standby
           - [ ] #7.5 開 /admin/kiosk-tokens?card_uid=04A1B2C3，row `status=consumed` 且 `consumed_at` 為剛剛時間
      ```

      **Rule 6：需要身分 / 特定 URL 才看得到的 item MUST 落盤結構化 entry**

      **每一個**需要特定身分或特定 URL 才看得到的 item（`[review:ui]` / `[verify:ui]` / `[verify:e2e]`，以及任何描述裡出現登入身分的項），**MUST** 在 propose 當下就把入口寫成結構化 entry，**NEVER** 只留在中文散文裡等 review GUI 用 regex 考古 —— 寫法變體（`E2E-TRAC-PAYROLL` vs `E2E-TRAC_PAYROLL`、具名員工 vs role fixture）永遠追不完，每個追不到的變體都是一次使用者卡在畫面前面。

      ```bash
      node ~/offline/clade/scripts/manual-entry.ts --repo <repo> --change <change> \
        --item '#4' --url '<要驗收那一頁的絕對 URL>' --login-as <role> [--login-email <email>] [--viewport 390]
      node ~/offline/clade/scripts/manual-entry.ts --repo <repo> --change <change> --list   # 寫完 MUST 對帳
      ```

      - `--url` 填**要驗收的那一頁**，**NEVER** 填 dev-login URL（那是入口不是目的地，登入由 `--login-*` 承載）
      - `--migrate` 是**既有 change** 的遷移路徑，**NEVER** 當新 change 的正規路徑 —— 它產出的 `source: 'derived'` 標記本身就代表「這筆是考古來的、可能不準」
      - 落盤後 `audit-manual-executability.ts` 對該 item 不再報 `PROSE-ONLY-ENTRY`

      欄位語義、四種形狀的範本（帶 role / 具名 email / 窄螢幕 viewport / 公開頁 `login: null`）、三條 NEVER 見 cookbook `~/offline/clade/vendor/snippets/manual-review-entry/`。

      完整規約見 `.claude/rules/manual-review.md`「Item Kind Marker」+「Kind 分類指引」+「`[review:ui]` 純功能驗證 step actionability」+ `.claude/rules/ux-completeness.md`「必填 Backend-only Manual Review 規約」。

   5.6 **Artifact 語言遵循 check**：

      ```bash
      grep -lE "繁體|繁中|不要使用簡體" CLAUDE.md .claude/rules/*.md 2>/dev/null
      ```

      - **若 grep 命中**（consumer 規定繁體中文）：
        1. Read proposal.md / design.md / tasks.md，heuristic 偵測：連續 3+ 行純 ASCII 句子且不在 ` ``` ` code block / table / inline code 內 → 視為英文段落
        2. 主線**自己** Edit 翻成繁體中文，保留：
           - SQL / code / shell command（` ``` ` block 內）
           - Code 識別字、檔案路徑、技術名詞（如 `audit_signed_chain`、`business_keys_drift`、`PostgREST`）
           - inline code（單 backtick 內的字串）
        3. 標題用語對齊既有繁中規則檔（例如 `## Why` / `## What Changes` / `## Non-Goals` / `## Affected Entity Matrix` 等 OpenSpec / Spectra 制式英文標題**保留不譯**，body 內容才翻）
      - **若無命中**：跳過此 step

   6. **掃 design.md 的 Open Questions**（不論前面摘要多漂亮，這步**不能省略**）：
      - Read `openspec/changes/<change-name>/design.md`
      - grep 找 `## Open Questions`（或同義變體：`## Open Question`、`## 待決問題`、`## Unresolved Questions`）
      - 若標題存在且區塊內容非空（不是 `(none)` / `N/A` / `無` / 只剩空 bullet / 只剩註解）：
        - **立刻**用 **AskUserQuestion** 把每一題列給使用者（一次最多 5 題，超過分批問）
        - **NEVER** 把「要不要回答 open questions」包成 A/B/C/D 選單裡的一個選項
        - **NEVER** 自行假設答案、自行標 wontfix、或推給未來
        - 拿到答案後 Edit design.md 把 `## Open Questions` 改為 `## Resolved Questions`，每題下補 `**Answer:** <使用者回答>`

   7. **跑 `spectra analyze <change-name> --json`** 確認無 Critical/Warning（max 2 輪 fix loop，與 Step 9 邏輯相同）

   8. **`spectra validate <change-name>`** 確認 artifacts 結構合法

   9. **commit artifacts 進 git** 後結束流程（**不 park**，見 Step 11）

   10. 回報使用者：artifacts list + cross-check 結果（補了什麼、Design Review 7 步 OK 與否、analyze/validate 結果）+ `/spectra-apply <change-name>` 提示
