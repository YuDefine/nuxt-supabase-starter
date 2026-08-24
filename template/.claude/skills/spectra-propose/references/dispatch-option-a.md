<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/spectra-propose/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# spectra-propose — Step 0 選項 A Pi flow

> 本檔是 `spectra-propose/SKILL.md` 的執行細節分冊（clade fork 加料，2026-08-02 自 SKILL.md 抽出以縮 invoke 成本）。
> SKILL.md 對應 step 的 inline pointer 指到本檔；**MUST 依 pointer 指示完整讀對應 § 再執行**。
> 行為 gate（NEVER / MUST 判定）留在 SKILL.md inline；本檔是操作 recipe / 範本 / 查表。

---

## 選項 A 全流程（Phase 0a draft prompt 範本 + dispatch + watch；Phase 0b cross-check step 1–10）

   ### 選項 A：Pi flow（Pi draft + 主線 cross-check）

   #### Phase 0a：派 Pi 在背景跑

   依以下順序執行（每一步都是主線 Claude 自己做，不需使用者介入）：

   1. **解析 change name + requirement**：從 argument / discuss artifacts / 對話脈絡萃取，導出 kebab-case `<change-name>` 與一句話 requirement
   2. **組裝 context pack + thin draft prompt**

      主線先組裝一份 per-change context pack，再寫 thin draft prompt。兩步分開：

      **Step 2a：Write context pack 到 `/tmp/spectra-propose-<change-name>-context.md`**

      ```markdown
      # Context Pack: <change-name>

      ## Change
      - name: <change-name>
      - type: feature | bugfix | refactor
      - locale: <跑 `spectra instructions proposal --change <name> --json` 取 locale，或 grep consumer CLAUDE.md 判定>
      - ui_scope: <true if requirement 涉及 .vue / pages/ / components/ / layouts/ / .css / .scss>
      - backend_only: <true if User Journeys 為 No user-facing journey>

      ## Requirement
      <一句話需求 + discuss 階段已捕獲的完整 context>

      ## Applicable Contract Sections
      §1, §2, §3, §5, §6, §7, §9
      （動態：§2/§5/§7 只在 ui_scope=true 時列入；§4 只在 backend_only=true 時列入）

      ## Existing Artifacts
      <若 openspec/changes/<name>/ 已存在，列出路徑；否則標「無」>
      ```

      **Step 2b：Write thin draft prompt 到 `/tmp/pi-spectra-propose-<change-name>-prompt.md`**

      ```
      請以本 repo 的 spectra-propose 流程建立 change `<change-name>`。

      讀取以下檔案後執行：
      1. Context pack（change 元資料 + requirement + 適用 § 清單）：
         /tmp/spectra-propose-<change-name>-context.md
      2. Artifact draft contract（共用規約彙編，只讀 context pack 列出的 §）：
         .claude/skills/spectra-propose/references/artifact-draft-contract.md
      3. Flow（只執行 Step 1~11，跳過 Step 0 — 已決定由你執行）：
         .claude/skills/spectra-propose/SKILL.md
      4. 任何 discuss 階段已捕獲的 design.md / spec.md：
         openspec/changes/<change-name>/（若已存在）

      完成標準：`spectra validate <change-name>` 通過。
      **NEVER 執行 `spectra park`** — change 維持 active，artifacts 留在 disk。
      不要呼叫 /spectra-apply。產出後在 stdout 摘要 artifacts 列表 + `spectra validate` 結果。
      ```

      > **Why context pack + contract 取代 inline 規約**：原 prompt 把 Phase Purity / Manual Review
      > Rules 1-6 / Backend-only / Fixtures / Language / Design Review 7 步全部 inline（~200 行），
      > draft runtime 讀完後又被要求讀 ux-completeness.md / manual-review.md / agent-routing.md 全文
      > — 同一批規則載入兩次。context pack + contract 讓 draft runtime 只讀一份共用 contract
      > 的命中 §，不再需要分別讀三份完整 rules 檔。cross-check 同理。
      > 完整規約內容見 `artifact-draft-contract.md` §1-§10。
   3. **背景啟動 Pi dispatcher**（**Bash** tool 加 `run_in_background=true`）：

      ```bash
      node ~/offline/clade/vendor/scripts/pi-dispatch.ts \
        --brief /tmp/pi-spectra-propose-<change-name>-prompt.md \
        --cwd <consumer-repo-root> \
        --label spectra-propose-<change-name> \
        --model sol --effort max \
        --route routing-table --tier-basis table-row --table-row spectra-artifact-draft
      ```

   4. **立刻**簡短回報給使用者：「已派 Pi GPT-5.6-sol max 在背景 draft `/spectra-propose <change-name>`（bash job `<id>`），完成後主線會 cross-check 並補 Design Review template」
   5. 啟動 **Pi Watch Protocol**（見 `.claude/rules/agent-routing.pi-watch-protocol.md` § 監看排程 A）：background Bash 回傳 `<task-id>` 後，立刻記錄 owner / deadline（deadline 取值依 [[agent-routing]] § deadline 怎麼取），並排 1500s canonical `ASYNC_KEEPALIVE_CONTROL task=<task-id> owner=pi:spectra-propose:<change-name> deadline=<ISO>...` inert control message。控制 turn 只准 `TaskOutput(block=false)`、重排同一 inert prompt、停止 wakeup或排 lifecycle intervention；**NEVER** 放原 propose prompt、讀 output tail、執行 artifact mutation或用 180s 短輪詢。完成通知到達後才 claim task id、讀 stdout並進 Phase 0b。

   #### Phase 0b：主線 Cross-Check（pi 完成後**立刻**執行）

   **exit code 分流（收到 terminal notification 後先做，per `pi-phase-dispatch.md` § 4）**：

   - `0`：讀 `result`，往下走。
   - `2`：業務 fail；讀 `result` 的原因，主線決定修補或重派。
   - `3`：機械故障；讀 receipt 指向的 stderr log，依 watch protocol fallback。
   - `4`：配額擋；本列是 sol，依 [[agent-routing]] § 配額耗盡時的 fallback 紀律先走 `--model sol-cursor`
     同 effort 重派一次，**NEVER** 當成可立即重試的機械故障，**也 NEVER** 改派 Claude subagent。

   收到 `<task-notification> status=completed` 時**立刻**依序執行：

   1. **Read pi stdout** 摘要：BashOutput 讀完整 stdout，回報 artifacts list / `spectra validate` 結果

   2. **若 pi 仍 `spectra park` 了**（不該發生，draft prompt 已明令禁止）：先
      `spectra unpark <change-name>` 把 artifacts 還原到 disk 才能繼續 cross-check

   3. **跑 post-propose-check.sh**（檢查 User Journeys / Affected Entity Matrix / Implementation Risk Plan / Design Review 7 步）：

      ```bash
      bash scripts/spectra-advanced/post-propose-check.sh <change-name>
      ```

      若有 FINDINGS → 主線**自己**直接 Edit proposal.md / tasks.md 補齊（**不要**回 pi 修，太慢）

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

      依 `artifact-draft-contract.md` §3（Rules 1-6）+ §4（Backend-only）檢查 tasks.md `## 人工檢查`。
      違規 → 主線**自己**直接 Edit tasks.md（**不**回 pi 修，太慢）。

      完整 Rules 1-6 判準見 contract §3；Backend-only 搬移規則見 §4。此處不複述以免兩份漂移。

   5.6 **Artifact 語言遵循 check**：

      依 `artifact-draft-contract.md` §6 的 locale 判定與翻譯規則檢查 proposal.md / design.md / tasks.md。

   6. **掃 design.md 的 Open Questions**（不論前面摘要多漂亮，這步**不能省略**）：
      - Read `openspec/changes/<change-name>/design.md`
      - grep 找 `## Open Questions`（或同義變體：`## Open Question`、`## 待決問題`、`## Unresolved Questions`）
      - 若標題存在且區塊內容非空（不是 `(none)` / `N/A` / `無` / 只剩空 bullet / 只剩註解）：
        - **立刻**用 **AskUserQuestion** 把每一題列給使用者（一次最多 5 題，超過分批問）
        - **NEVER** 把「要不要回答 open questions」包成 A/B/C/D 選單裡的一個選項
        - **NEVER** 自行假設答案、自行標 wontfix、或推給未來
        - 拿到答案後 Edit design.md 把 `## Open Questions` 改為 `## Resolved Questions`，每題下補 `**Answer:** <使用者回答>`

   6b. **Elicitation gate Part 2（QA 視角 agent）** —— 依 SKILL.md § Elicitation gate 派一個
       fresh-context subagent 對 spec deltas 問「那如果⋯⋯呢」。回來的每一條 MUST 補進 spec 或
       明確標為 out of scope，兩者都留痕跡；**NEVER** 靜默丟棄，**NEVER** 用繼承主線對話的
       fork 型 subagent。

   7. **跑 `spectra analyze <change-name> --json`** 確認無 Critical/Warning（max 2 輪 fix loop，與 Step 9 邏輯相同）

   8. **`spectra validate <change-name>`** 確認 artifacts 結構合法

   9. **commit artifacts 進 git** 後結束流程（**不 park**，見 Step 11）

   10. 回報使用者：artifacts list + cross-check 結果（補了什麼、Design Review 7 步 OK 與否、analyze/validate 結果）+ `/spectra-apply <change-name>` 提示
