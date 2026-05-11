---
name: spectra-propose
description: "Create a change proposal with all required artifacts"
effort: xhigh
license: MIT
compatibility: Requires spectra CLI.
metadata:
  author: spectra
  version: "1.0"
  generatedBy: "Spectra"
---
<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/spectra-propose/
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->


Create a complete Spectra change proposal — from requirement to validated artifacts — in a single workflow.

**Input**: The argument after `/spectra-propose` is the requirement description. Examples:

- `/spectra-propose add dark mode`
- `/spectra-propose fix the login page crash`
- `/spectra-propose improve search performance`

If no argument is provided, the workflow will extract requirements from conversation context or ask.

**Prerequisites**: This skill requires the `spectra` CLI. If any `spectra` command fails with "command not found" or similar, report the error and STOP.

**Steps**

0. **Dispatch Codex draft + 主線 cross-check**（預設流程，無 A/B 詢問）

   **預設行為**：本 skill 一律走「Codex GPT-5.5 xhigh draft + 主線 Claude Opus xhigh cross-check」流程。**禁止** AskUserQuestion 問 A/B。

   **唯一例外**：使用者**明確**說「不要派 codex」「我要純 Claude propose」「直接你做」等指令 → 跳過 Step 0，直接走 Step 1~11（純 Claude 路徑，但 Step 8 必須補 7 步 Design Review check）。**否則一律走以下流程**。

   ### Phase 0a：派 Codex 在背景跑

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

      **Artifact 語言遵循**：
      開工前先 `grep -lE "繁體|繁中|不要使用簡體" CLAUDE.md .claude/rules/*.md 2>/dev/null`。若命中（consumer 規定繁體中文），**全部** artifact（proposal.md / design.md / tasks.md / spec.md）**MUST** 用繁體中文撰寫，**禁止**英文 artifact。code 識別字、技術名詞（如 `audit_signed_chain`、`business_keys_drift`）、SQL/code block 不譯。若 grep 未命中視為無語言規定。

      完成標準：`spectra park <change-name>` 執行成功。
      不要呼叫 /spectra-apply。產出後在 stdout 摘要 artifacts 列表 + `spectra validate` 結果。
      ```
   3. **背景啟動 codex exec**（**Bash** tool 加 `run_in_background=true`）：

      ```bash
      cd <consumer-repo-root> && codex exec \
        --model gpt-5.5 \
        --dangerously-bypass-approvals-and-sandbox \
        --skip-git-repo-check \
        -c model_reasoning_effort=xhigh \
        < /tmp/codex-spectra-propose-<change-name>-prompt.md 2>&1
      ```

   4. **立刻**簡短回報給使用者：「已派 Codex GPT-5.5 xhigh 在背景 draft `/spectra-propose <change-name>`（bash job `<id>`），完成後主線會 cross-check 並補 Design Review template」
   5. 啟動 **Codex Watch Protocol**（見 `agent-routing.md`）— `ScheduleWakeup(180, "...")` 監看進度

   ### Phase 0b：主線 Cross-Check（codex 完成後**立刻**執行）

   收到 `<task-notification> status=completed` 時**立刻**依序執行：

   1. **Read codex stdout** 摘要：BashOutput 讀完整 stdout，回報 artifacts list / `spectra validate` 結果

   2. **若 codex 已 `spectra park <change-name>`**：先 `spectra unpark <change-name>` 才能繼續 cross-check

   3. **跑 post-propose-check.sh**（檢查 User Journeys / Affected Entity Matrix / Implementation Risk Plan / Design Review 7 步）：

      ```bash
      bash scripts/spectra-advanced/post-propose-check.sh <change-name>
      ```

      若有 FINDINGS → 主線**自己**直接 Edit proposal.md / tasks.md 補齊（**不要**回 codex 修，太慢）

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

      `[review:ui]` 只給「agent 用 browser-harness 也跑不了」的項目。description 含下列任一關鍵字才 `[review:ui]`：

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

      完整規約見 `.claude/rules/manual-review.md`「Item Kind Marker」+「Kind 分類指引」+ `.claude/rules/ux-completeness.md`「必填 Backend-only Manual Review 規約」。

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

   9. **`spectra park <change-name>`** 結束流程

   10. 回報使用者：artifacts list + cross-check 結果（補了什麼、Design Review 7 步 OK 與否、analyze/validate 結果）+ `/spectra-apply <change-name>` 提示

   **禁止事項**（重點重申）：

   - **NEVER** 在 Step 0 用 AskUserQuestion 問 A/B（已預設 codex draft）— 除非使用者**明確**要求純 Claude propose
   - **NEVER** 派 codex 後不跑 cross-check（post-propose-check + design-inject + 主線補 Design Review 7 步 + spectra analyze）
   - **NEVER** 把 cross-check 的修補工作丟回 codex（太慢、來回成本高）— 主線**自己** Edit 修
   - **NEVER** 沉默等使用者來問進度；通知一到自己讀檔 + cross-check 完整流程
   - **NEVER** 派 codex draft 而 prompt 漏掉 Plan-first 段落 — codex 必須在動筆前先輸出 `## Plan`（要動哪些檔 / 每檔寫什麼 / phase 切分），主線 cross-check 才有對齊基準

   **本 session 不再執行任何 Step 1 ~ 11**（避免雙重生產）— Step 0 結束本 skill。

   ### 純 Claude 路徑（使用者明確要求時）

   continue to Step 1 below.

1. **Determine the requirement source**

   a. **Argument provided** (e.g., "add dark mode") → use it as the requirement description, skip to deriving the change name below.

   b. **Plan file available**:
   - Check if the conversation context mentions a plan file path (plan mode system messages include the path like `~/.claude/plans/<name>.md`)
   - If found, check if the file exists at `~/.claude/plans/`
   - If a plan file is found, use the **AskUserQuestion tool** to ask:
     - Option 1: Use the plan file
     - Option 2: Use conversation context
   - If conversation context has no relevant discussion, mention this when presenting the choice
   - If the user picks the plan file → read it and extract:
     - `plan_title` (H1 heading) → use as requirement description
     - `plan_context` (Context section) → use as proposal Why/Motivation content
     - `plan_stages` (numbered implementation stages) → use for artifact creation
     - `plan_files` (all file paths mentioned) → use for Impact section
   - If the user picks conversation context → fall through to (c)

   c. **Conversation context** → attempt to extract requirements from conversation history
   - If context is insufficient, use the **AskUserQuestion tool** to ask what they want to build

   From the resolved description, derive a kebab-case change name (e.g., "add dark mode" → `add-dark-mode`).

   **IMPORTANT**: Do NOT proceed without understanding what the user wants to build.

2. **Classify the change type**

   Based on the requirement, classify the change into one of three types:

   | Type     | When to use                                                         |
   | -------- | ------------------------------------------------------------------- |
   | Feature  | New functionality, new capabilities                                 |
   | Bug Fix  | Fixing existing behavior, resolving errors                          |
   | Refactor | Architecture improvements, performance optimization, UI adjustments |

   This determines the proposal template format in step 5.

3. **Scan existing specs for relevance**

   Before creating the change, check if any existing specs overlap:
   1. Use the **Glob tool** to list all files matching `openspec/specs/*/spec.md`
   2. Extract directory names as the spec identifier list
   3. Compare against the user's description to identify related specs (max 5 candidates)
   4. For each candidate (max 3), read the first 10 lines to retrieve the Purpose section
   5. If related specs are found, display them as an informational summary

   **IMPORTANT**:
   - If related specs are found, display them but do NOT stop or ask for confirmation — continue to the next step
   - If no related specs are found, silently proceed without mentioning the scan

4. **Create the change directory**

   ```bash
   spectra new change "<name>" --agent claude
   ```

   If a change with that name already exists, suggest continuing the existing change instead of creating a new one.

5. **Write the proposal**

   **IMPORTANT — file path rules for the `## Impact` section:**
   - All file paths SHALL be written relative to the project root (e.g., `src/lib/foo.ts`, `src-tauri/crates/core/src/bar.rs`, `docs/specs/specs/auth/spec.md`).
   - Do NOT use relative fragments (e.g., `parser/mod.rs`, `core/mod.rs`) — preflight rejects them as non-anchored paths.
   - Do NOT wrap shell commands in backticks inside artifact text (e.g., `` `git mv a.rs b.rs` ``) — preflight's backtick extractor will otherwise mis-parse the command as a file reference.
   - When referring to a file without naming its concrete path, use descriptive prose (e.g., "Parser 入口檔") rather than a backticked path fragment.

   Get instructions:

   ```bash
   spectra instructions proposal --change "<name>" --json
   ```

   Generate the proposal content based on change type (see formats below), then write it via CLI:

   ```bash
   spectra new artifact proposal --change "<name>" --stdin <<'ARTIFACT_EOF'
   <proposal content>
   ARTIFACT_EOF
   ```

   If the command fails with a validation error, fix the content and retry.

   Use the following format based on change type:

   ### Feature

   ```markdown
   ## Why

   <!-- Why this functionality is needed -->

   ## What Changes

   <!-- What will be different -->

   ## Non-Goals (optional)

   <!-- Scope exclusions and rejected approaches. Required when design.md is skipped. -->

   ## Capabilities

   ### New Capabilities

   - `<capability-name>`: <brief description>

   ### Modified Capabilities

   (none)

   ## Impact

   - Affected specs: <new or modified capabilities>
   - Affected code:
     - New: <paths to be created, relative to project root>
     - Modified: <paths that already exist>
     - Removed: <paths to be deleted>
   ```

   ### Bug Fix

   ```markdown
   ## Problem

   <!-- Current broken behavior -->

   ## Root Cause

   <!-- Why it happens -->

   ## Proposed Solution

   <!-- How to fix -->

   ## Non-Goals (optional)

   <!-- Scope exclusions and rejected approaches. Required when design.md is skipped. -->

   ## Success Criteria

   <!-- Expected behavior after fix, verifiable conditions -->

   ## Impact

   - Affected code:
     - Modified: <paths that already exist>
     - New: <paths to be created, relative to project root>
     - Removed: <paths to be deleted>
   ```

   ### Refactor / Enhancement

   ```markdown
   ## Summary

   <!-- One sentence description -->

   ## Motivation

   <!-- Why this is needed -->

   ## Proposed Solution

   <!-- How to do it -->

   ## Non-Goals (optional)

   <!-- Scope exclusions and rejected approaches. Required when design.md is skipped. -->

   ## Alternatives Considered (optional)

   <!-- Other approaches considered and why not -->

   ## Impact

   - Affected specs: <affected capabilities>
   - Affected code:
     - Modified: <paths that already exist>
     - New: <paths to be created, relative to project root>
     - Removed: <paths to be deleted>
   ```

6. **Get the artifact build order**

   ```bash
   spectra status --change "<name>" --json
   ```

   Parse the JSON to get:
   - `applyRequires`: array of artifact IDs needed before implementation
   - `artifacts`: list of all artifacts with their status and dependencies

7. **Create remaining artifacts in sequence**

   Loop through artifacts in dependency order (skip proposal since it's already done):

   a. **For each artifact that is `ready` (dependencies satisfied)**:
   - **Check if the artifact is optional**: If the artifact is NOT in the dependency chain of any `applyRequires` artifact (i.e., removing it would not block reaching apply), it is optional. Get its instructions and read the `instruction` field. If the instruction contains conditional criteria (e.g., "create only if any apply"), evaluate whether any criteria apply to this change based on the proposal content. If none apply, skip the artifact and show: "⊘ Skipped <artifact-id> (not needed for this change)". Then continue to the next artifact.
   - Get instructions:
     ```bash
     spectra instructions <artifact-id> --change "<name>" --json
     ```
   - The instructions JSON includes:
     - `context`: Project background (constraints for you - do NOT include in output)
     - `rules`: Artifact-specific rules (constraints for you - do NOT include in output)
     - `template`: The structure to use for your output file
     - `instruction`: Schema-specific guidance
     - `outputPath`: Where to write the artifact
     - `dependencies`: Completed artifacts to read for context
     - `locale`: The language to write the artifact in (e.g., "Japanese (日本語)"). If present, you MUST write the artifact content in this language. Exception: spec files (specs/\*_/_.md) MUST always be written in English regardless of locale, because they use normative language (SHALL/MUST).
   - Read any completed dependency files for context
   - Generate the artifact content using `template` as the structure
   - Apply `context` and `rules` as constraints - but do NOT copy them into the file
   - Write the artifact via CLI (the CLI handles directory creation and format validation):

     For **design** or **tasks**:

     ```bash
     spectra new artifact <artifact-id> --change "<name>" --stdin <<'ARTIFACT_EOF'
     <content>
     ARTIFACT_EOF
     ```

     For **specs** (one command per capability):

     ```bash
     spectra new artifact spec <capability-name> --change "<name>" --stdin <<'ARTIFACT_EOF'
     <delta spec content>
     ARTIFACT_EOF
     ```

     If the command fails with a validation error, fix the content and retry.

   - Show brief progress: "✓ Created <artifact-id>"

   b. **Continue until all `applyRequires` artifacts are complete**
   - After creating each artifact, re-run `spectra status --change "<name>" --json`
   - Check if every artifact ID in `applyRequires` has `status: "done"`
   - Stop when all `applyRequires` artifacts are done

   c. **If an artifact requires user input** (unclear context):
   - Use **AskUserQuestion tool** to clarify
   - Then continue with creation

8. **Inline Self-Review** (before CLI analysis)

   After creating all artifacts, scan them manually. Fix issues inline, then proceed to the CLI analyzer.

   **Check 1: No Placeholders**

   These patterns are artifact failures — fix each one before proceeding:
   - "TBD", "TODO", "FIXME", "implement later", "details to follow"
   - Vague instructions: "Add appropriate error handling", "Handle edge cases", "Write tests for the above"
   - Delegation by reference: "Similar to Task N" without repeating specifics
   - Steps describing WHAT without HOW: "Implement the authentication flow" (what flow? what steps?)
   - Empty template sections left unfilled
   - Weasel quantities: "some", "various", "several" when a specific number or list is needed

   **Check 2: Internal Consistency**
   - Does every capability in the proposal have a corresponding spec?
   - Does the design reference only capabilities from the proposal?
   - Do tasks cover all design decisions, and nothing outside proposal scope?
   - Are file paths consistent across proposal Impact, design, and tasks?

   **Check 3: Scope Check**
   - More than 15 pending tasks → consider decomposing into multiple changes
   - Any single task would take more than 1 hour → split it
   - Touches more than 3 unrelated subsystems → consider splitting

   **Check 4: Ambiguity Check**
   - Are success/failure conditions testable and specific?
   - Are boundary conditions defined (empty input, max limits, error cases)?
   - Could "the system" refer to multiple components? Be explicit.

   **Check 5: Design Review 7-step template (UI scope only)**

   If `tasks.md` references any `.vue` / `pages/` / `components/` / `layouts/` files:
   - tasks.md **MUST** contain a `## N. Design Review` section before `## 人工檢查` (with N = last functional section number + 1)
   - The section **MUST** have all 7 checkboxes (N.1 through N.7) covering: PRODUCT.md/DESIGN.md check, /design improve + Fidelity Report, DRIFT fix loop, canonical-order targeted impeccable skills, /impeccable audit Critical = 0, review-screenshot, Fidelity confirmation
   - Verify by running `bash scripts/spectra-advanced/post-propose-check.sh <change-name>` and acting on its FINDINGS
   - If anything is missing, fix tasks.md inline now — do NOT let an incomplete Design Review section through. Archive gate will block it later anyway.

   **Check 6: Fixtures / Seed Plan (UI scope + Affected Entity Matrix)**

   If `tasks.md` has UI scope **AND** `proposal.md` contains `## Affected Entity Matrix` (= entity-level changes that surface in UI):
   - tasks.md **MUST** contain a `## N. Fixtures / Seed Plan` section before `## Design Review` (with N = last functional section number + 1)
   - Either include at least one `- [ ]` task line per entity-with-Surfaces (entity name, minimum row count, target seed file path) **OR** an explicit `**Existing seed sufficient**` declaration with one-line justification
   - Detected seed-file conventions (in order): `supabase/seed.sql` / `db/seed.sql` / `prisma/seed.ts` / `drizzle/seed.ts`
   - Reason: UI pages displaying empty data on dev/staging make `review-screenshot` worthless. Fixtures are part of feature completeness, not a review-time afterthought.
   - Verify by running `bash scripts/spectra-advanced/post-propose-check.sh <change-name>` and acting on Check 6 FINDINGS
   - Full template + exemption rules see `ux-completeness.md` 「必填 Fixtures / Seed Plan」section

   **Check 7: Phase Purity (UI view vs 非 view 必須切成獨立 phase)**

   If `tasks.md` includes UI view scope (any task references `.vue` / `.tsx` / `.jsx` / `app/pages/` / `app/components/` / `pages/` / `components/` / `views/` / `layouts/` / `.css` / `.scss`):
   - For each functional `## N. <title>` phase in tasks.md (excluding `## N. Design Review` and `## N. Fixtures / Seed Plan`):
     - **MUST NOT** mix view-layer file references with non-view work (schema / migration / API server / store / hook / API client / type / util / 純 backend)
     - 一個 phase 要嘛純 view 工作（component / page / view / layout / styling），要嘛純非 view 工作；混雜 phase 違規
   - Verify by running `bash scripts/spectra-advanced/post-propose-check.sh <change-name>` and acting on Check 4c FINDINGS
   - If a mixed phase is detected, **MUST** split inline now into independent phases — do NOT defer to ingest. spectra-apply Phase Dispatch 規則仰賴 phase purity；混雜 phase 在 apply 時會被擋下要求重 ingest，propose 階段就修掉成本最低
   - Reason: spectra-apply 把 UI view phase 由主線 Claude Code 自己做、其他 phase 派給 codex GPT-5.5 high；phase 混雜會破壞 dispatch 邊界，要嘛讓 codex 碰 view 層、要嘛讓主線吞下原本可以 offload 的 mechanical 工作

   **Check 8: Manual Review Marker Hygiene** (applies to **every** change, not only backend-only)

   Verify all four rules from Step 5.5 Manual Review Marker Hygiene Check:

   1. **Every `## 人工檢查` item line MUST carry a legal leading marker** (right after `#N` / `#N.M`, before the description): `[review:ui]` / `[discuss]` / `[verify:e2e]` / `[verify:api]` / `[verify:ui]` / verify multi-marker `[verify:<a>+<b>]` or `[verify:<a>+<b>+<c>]`. Default Kind Derivation Rule is a fallback for legacy in-flight items only — newly authored content **MUST** be explicit. Default fallback does NOT cover any `verify:*` channel.
   2. **New `[verify:auto]` is forbidden**. If codex draft contains `[verify:auto]`, main thread **MUST** inline replace it: pure API → `[verify:api]`; mutation + visual → `[verify:api+ui]`; persistence / full journey → `[verify:e2e]`.
   3. **Evidence-collection items MUST be marked `[discuss]` or `[verify:api]`**. SSH / `docker exec` / `psql` / `\d <table>` / `SELECT FROM` / controlled drift fabrication / migration existence verification / 商業判斷類「分布是否符合預期」→ `[discuss]`; reproducible HTTP / `curl` round-trip → `[verify:api]`.
   4. **Real user round-trip items MUST use the strongest explicit channel**: persistence / reload / full journey → `[verify:e2e]`; HTTP status / backend contract → `[verify:api]`; final-state visual only → `[verify:ui]`; mutation + visual → `[verify:api+ui]`; human-only allowlist → `[review:ui]`.
   5. **Multi-marker cannot mix verify channels with human/discuss kinds**. `[verify:api+ui]` is valid; `[verify:api+review:ui]` and `[verify:api+discuss]` are invalid.

   When a violation is detected, the main thread Edit tasks.md inline (do NOT round-trip back to codex). For backend-only changes specifically:

   - Pure technical evidence items (SSH / psql / `\d` / `SELECT` / drift fabrication / migration existence verify) **MUST** be moved out of `## 人工檢查` into `## N. Backend Verification Evidence` section (位置：最後一個功能區塊之後、`## 人工檢查` 之前；N = 上一個功能區塊序號 + 1) — apply Claude self-runs them and pastes evidence under each task.
   - `## 人工檢查` retains only `[discuss]` items in three categories plus reproducible `[verify:api]` HTTP round-trips:
     1. **Production 授權型** — deploy 前 final go/no-go ack、production-only 破壞性操作授權
     2. **商業判斷型** — Claude 無法自動判斷「結果是否合理」的觀察項
     3. **Production 觀察型** — deploy 後 N 小時 / N 天的 production-only soak window 觀察
   - 若三類都沒有，`## 人工檢查` **MUST** 寫成固定文字（archive gate 視為合法）：
     ```
     _本 change 為 backend-only，所有驗證由 apply 階段 Claude 自跑（見 `## N. Backend Verification Evidence`）；deploy 前無使用者人工檢查項目。_
     ```

   For **user-facing** changes: evidence-collection items can stay in `## 人工檢查` but **MUST** be marked `[discuss]` or `[verify:api]` — Claude proactively prepares `[discuss]` evidence during spectra-archive Step 2.5, and main thread runs `[verify:api]` during spectra-apply Step 8a.

   Reason: forcing users to SSH + psql + curl is not "manual review" — it's evidence collection Claude can automate or discuss. Forcing users to manually round-trip automatable flows is also wasted attention — apply Step 8a runs explicit verify channels. Real `[review:ui]` items are reserved for things genuinely requiring a human (email inbox, physical devices, subjective judgment). Mixing dilutes the user's attention.

   Full 規約 (含 Item Kind Marker schema、verify channel cookbook、Backend Verification Evidence 模板、反面範例、違反回報格式) 見 `manual-review.md` 「Item Kind Marker」+ `vendor/snippets/verify-channels/README.md` + `ux-completeness.md` 「必填 Backend-only Manual Review 規約」

   **Check 9: Artifact language convention**

   ```bash
   grep -lE "繁體|繁中|不要使用簡體" CLAUDE.md .claude/rules/*.md 2>/dev/null
   ```

   If the grep matches (consumer enforces 繁體中文):
   - All artifacts (`proposal.md` / `design.md` / `tasks.md` / `specs/**/*.md`) **MUST** be written in 繁體中文.
   - Code identifiers, file paths, technical names (e.g., `audit_signed_chain`, `business_keys_drift`, `PostgREST`), SQL blocks, shell commands, and inline `code` remain untranslated.
   - OpenSpec / Spectra 制式英文標題（如 `## Why`、`## What Changes`、`## Non-Goals`、`## Affected Entity Matrix`、`## User Journeys`、`## Implementation Risk Plan`）保留英文，body 內容必須繁中。
   - If codex draft produced English artifacts despite the convention, fix inline now — main thread Edit 翻譯，**不要**回 codex 重 draft.
   - Reason: codex GPT-5.5 在 prompt 已有繁中指示時仍可能默認輸出英文；主線 cross-check 是最後一道翻譯把關。違反語言慣例會讓使用者在 review/manual-check 階段卡關。

---

## Rationalization Table

| What You're Thinking                                          | What You Should Do                                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| "The requirements are clear enough, no need for discuss"      | Fine if true — but check you're not skipping because you're lazy                      |
| "This artifact isn't needed for this change"                  | Check `applyRequires` — if it's in the dependency chain, create it                    |
| "The spec doesn't need scenarios, the requirement is obvious" | Obvious to you now. Write scenarios for the implementer who doesn't have your context |
| "I'll keep the design brief, code will be self-explanatory"   | Design exists so implementers don't reverse-engineer intent. Be specific              |
| "This is a small change, skip the scope check"                | Small changes touching 5 subsystems aren't small. Check                               |
| "The placeholder is fine for now, I'll fill it in later"      | There is no "later" — implementation is next. Fill it in now                          |

---

9. **Analyze-Fix Loop** (max 2 iterations)
   1. Run `spectra analyze <change-name> --json`
   2. Filter findings to **Critical and Warning only** (ignore Suggestion)
   3. If no Critical/Warning findings → show "Artifacts look consistent ✓" and proceed
   4. If Critical/Warning findings exist:
      a. Show: "Found N issue(s), fixing... (attempt M/2)"
      b. Fix each finding in the affected artifact
      c. Re-run `spectra analyze <change-name> --json`
      d. Repeat up to 2 total iterations
   5. After 2 attempts, if findings remain:
      - Show remaining findings as a summary
      - Proceed normally (do NOT block)

10. **Validation**

    ```bash
    spectra validate "<name>"
    ```

    If validation fails, fix errors and re-validate.

11. **Park the change and end the workflow**

    Show summary:
    - Change name and location
    - List of artifacts created
    - Validation result

    Then unconditionally execute:

    ```bash
    spectra park "<name>"
    ```

    Inform the user that the change is parked and that running `/spectra-apply <change-name>` when ready will auto-unpark the change and start implementation.

    The propose workflow ENDS here. Do NOT invoke `/spectra-apply`. Do NOT call **AskUserQuestion** to ask whether to park or apply. This behavior is identical across Auto Mode, interactive mode, and any other agent mode — parking is unconditional and does not depend on `AskUserQuestion` availability or UI auto-accept settings.

**Artifact Creation Guidelines**

- Follow the `instruction` field from `spectra instructions` for each artifact type
- Read dependency artifacts for context before creating new ones
- Use `template` as the structure for your output file - fill in its sections
- **IMPORTANT**: `context` and `rules` are constraints for YOU, not content for the file
  - Do NOT copy `<context>`, `<rules>`, `<project_context>` blocks into the artifact
  - These guide what you write, but should never appear in the output
- **Parallel task markers (`[P]`)**: When creating the **tasks** artifact, first read `.spectra.yaml`. If `parallel_tasks: true` is set, add `[P]` markers to tasks that can be executed in parallel. Format: `- [ ] [P] Task description`. A task qualifies for `[P]` if it targets different files from other pending tasks AND has no dependency on incomplete tasks in the same group. When `parallel_tasks` is not enabled, do NOT add `[P]` markers.

**Guardrails**

- Create all artifacts needed for implementation. Optional artifacts (those not in the `applyRequires` dependency chain) may be skipped if their inclusion criteria don't apply.
- Always read dependency artifacts before creating a new one
- If context is critically unclear, ask the user - but prefer making reasonable decisions to keep momentum
- If a change with that name already exists, suggest continuing that change instead
- Verify each artifact file exists after writing before proceeding to next
- **NEVER** write application code or implement features during this workflow
- **NEVER** skip the artifact workflow to write code directly
- **NEVER** reinterpret requirements by ignoring the proposal file
- **NEVER** invoke `/spectra-apply` — this workflow ends after artifact creation. The user decides when to start implementation
- If **AskUserQuestion tool** is not available, ask the same questions as plain text and wait for the user's response
