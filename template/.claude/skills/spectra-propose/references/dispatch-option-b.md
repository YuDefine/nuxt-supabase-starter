<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/spectra-propose/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# spectra-propose — Step 0 選項 B 三模型交叉 pipeline

> 本檔是 `spectra-propose/SKILL.md` 的執行細節分冊（clade fork 加料，2026-08-02 自 SKILL.md 抽出以縮 invoke 成本）。
> SKILL.md 對應 step 的 inline pointer 指到本檔；**MUST 依 pointer 指示完整讀對應 § 再執行**。
> 行為 gate（NEVER / MUST 判定）留在 SKILL.md inline；本檔是操作 recipe / 範本 / 查表。

---

## 選項 B 全流程（Phase B-0a Fable draft / B-0b Codex review / B-0c 主線 final check）

   ### 選項 B：三模型交叉 pipeline（Fable draft → Codex review → 主線 Fable final check）

   三段序列：Claude Fable 5 xhigh 在背景起草 → Codex GPT-5.6-sol max（fresh session）檢查出 findings → 主線 Claude Fable 5 xhigh 整合 findings 並完成全套 cross-check。三段皆背景派工 + notification-only watch（per `.claude/rules/agent-routing.codex-watch-protocol.md` § 監看排程 A）。draft 與 review 是兩個不同 model 的獨立 session（Fable draft + Codex review 交叉視角，比同 model 更能抓到盲點）。

   #### Phase B-0a：背景 Fable draft

   1. **解析 change name + requirement**（同 Phase 0a step 1）。
   2. **Write prompt 檔到 `/tmp/fable-spectra-propose-<change-name>-draft-prompt.md`** — 內容**完全沿用 Phase 0a step 2 的 draft prompt 範本**（Plan-first / Phase Purity / Manual Review Kind Marker / Backend-only 規約 / `docs/FIXTURES.md` sample / 語言遵循 / `spectra validate` 完成標準與 **NEVER park** 禁令全部照搬）。檔名用 `-draft-prompt` 與 Phase B-0b 的 `-review-prompt` 區隔，避免兩個背景 job 混用 prompt。
   3. **背景啟動 claude**（**Bash** tool 加 `run_in_background=true`）：

      ```bash
      cd <consumer-repo-root> && claude -p \
        --model claude-fable-5 \
        --effort xhigh \
        < /tmp/fable-spectra-propose-<change-name>-draft-prompt.md 2>&1
      ```

      預設 text 輸出（主線讀 tail）。
   4. **立刻**簡短回報：「已派 Claude Fable 5 xhigh 在背景 draft `<change-name>`（bash job `<id>`）；完成後派 Codex review，再由主線 Fable final check」。
   5. 啟動 **Watch Protocol**：`claude -p` background Bash 回傳 `<task-id>` 後，立刻記錄 owner / deadline，並排 1500s canonical `ASYNC_KEEPALIVE_CONTROL task=<task-id> owner=fable:spectra-propose:<change-name>:draft deadline=<ISO>...` inert control message。控制 turn 只准 `TaskOutput(block=false)`、重排同一 inert prompt、停止 wakeup或排 lifecycle intervention；**NEVER** 放原 draft prompt、讀 output tail、執行 artifact mutation或短輪詢。完成通知到達後才 claim task id、讀 stdout並進 Phase B-0b。

   #### Phase B-0b：Fable draft 完成 → 派 Codex review

   收到 Fable draft `<task-notification status=completed>` 時**立刻**：

   1. **Read Fable draft stdout** 摘要：BashOutput 讀完整 stdout，回報 artifacts list / `spectra validate` 結果。
   2. **若 Fable draft 仍 `spectra park` 了**（不該發生，draft prompt 已明令禁止）：先
      `spectra unpark <change-name>` —— park 後 artifacts 只存 `.git/spectra-app/spectra.db` SQLite
      blob、不在 disk，review Codex 讀不到。
   3. **Write Codex review prompt 到 `/tmp/codex-spectra-propose-<change-name>-review-prompt.md`**：

      ```
      請檢查（review）本 repo 已 draft 的 change `<change-name>`，**不要修改任何檔案**，只輸出 findings。
      讀取 openspec/changes/<change-name>/ 下全部 artifacts（proposal.md / design.md / tasks.md / specs/**/spec.md），對照以下規約逐項查：
      - .claude/rules/ux-completeness.md（Affected Entity Matrix / User Journeys / Implementation Risk Plan / Fixtures-Seed Plan / Design Review 7 步）
      - .claude/rules/manual-review.md（## 人工檢查 Item Kind Marker、step actionability、[verify:auto] 禁用）
      - .claude/rules/agent-routing.md（Phase Purity：UI view phase vs 非 view phase 是否切開）
      輸出格式：findings list，每條一行 `[檔案] 問題 → 建議修法`。無問題的面向寫「OK」。**禁止** Edit / Write / 改檔，只輸出文字 findings。
      ```
   4. **背景啟動 codex exec**（**Bash** tool 加 `run_in_background=true`）：

      ```bash
      cd <consumer-repo-root> && codex exec \
        --model gpt-5.6-sol \
        --dangerously-bypass-approvals-and-sandbox \
        --skip-git-repo-check \
        -c model_reasoning_effort=max \
        < /tmp/codex-spectra-propose-<change-name>-review-prompt.md 2>&1
      ```

   5. **立刻**回報：「Fable draft 完成，已派 Codex GPT-5.6-sol max review（bash job `<id>`）；完成後主線 Fable final check」+ 啟動 notification-only watch（同 Phase B-0a step 5）。

   #### Phase B-0c：Codex 檢查完 → 主線 Fable final check

   收到 Codex `<task-notification status=completed>` 時**立刻**：

   1. **Read Codex findings**：BashOutput 讀 codex stdout，整理 findings 摘要。
   2. **主線整合 findings + 跑完整 cross-check** — 執行 Phase 0b step 3 ~ 9 全套（`post-propose-check.sh` / `post-propose-manual-review-check.sh` / **`--check7-only` hard gate** / `design-inject.sh` / 補 Design Review 7 步 / Manual Review Marker Hygiene / `[verify:auto]`→explicit marker / Backend Verification Evidence 搬移 / Open Questions→AskUserQuestion / `spectra analyze` / `spectra validate` / commit artifacts 進 git），並把 Codex findings 一併納入修補依據。
   3. **主線自己 Edit 修**（**NEVER** 把修補丟回 codex，太慢、來回成本高）。
   4. 回報使用者：artifacts list + Fable draft 摘要 + **Codex review findings 摘要** + 主線補了什麼（Design Review 7 步 OK 與否、analyze/validate 結果）+ `/spectra-apply <change-name>` 提示。
