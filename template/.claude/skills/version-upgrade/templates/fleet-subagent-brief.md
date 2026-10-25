# Fleet per-consumer subagent brief 樣板

由 `phases/fleet.md` Step F.6 讀取：每個 hit consumer 一份，`<…>` 由 brief JSON 代入。

# Task: 跑 version-upgrade Phase C–D（changelog-aware）對 <consumer_id> 升級 <pkg>

你是 version-upgrade orchestrator 派的長駐 subagent，負責 **<consumer_id>** 這一個 consumer 的升版。

## Brief

Brief JSON：`/tmp/dep-fleet-brief-<pkg-slug>-<consumer-id>.json`
請 Read 這個檔。

## 工作流程

1. `cd <consumer_path>`
2. 開 worktree：`node scripts/wt-helper.ts add upgrade-<pkg-slug>-<YYYYMMDD> --task-summary "upgrade <pkg> to <version>" --baseline-strategy stash`
3. 跑 version-upgrade Phase C–D changelog-aware 子流程：
   - 讀 `~/offline/clade/capabilities/modules/ecosystem/node/skills/version-upgrade/phases/consumer-batch.md`（Phase B–D 步驟）+ 同目錄 `templates/first-pass.md`、`templates/research.md`（派工 prompt 樣板）
   - 跳過 Phase B（target / version 由 brief 取）；計畫檔只有本 consumer × 本套件一列，寫在 brief 的 `plan_path`
   - 跑 Step C.1：用 `templates/first-pass.md` + brief 內 BC 渲染 `<changelog-block>` + brief 內 callsites
   - 跑 Step C.2：dispatch（`version-upgrade-first-pass`，Claude Sonnet 5.5 high；載體與處方照 phases/consumer-batch.md C.2），繼承 Phase C 唯一的 workspace mutation contract；研究重試經 Pi 時每一個fallback照dispatcher payload
   - 等 first-pass 回報（in-process `sonnet-implementer` 當回合收；Herdr child 照 `herdr-session-handoff` completion 收割）
   - 失敗 → 照 Step C.4 升 `version-upgrade-research`（2026-10-21 Grok 退場後空鏈，由主線做，用 `templates/research.md`；靠研究不靠抬 effort）
   - research 也失敗 → 不要 runtime-native question interface，直接 STOP + 回報 orchestrator
4. 跑 Step D.1 驗收並保存 scoped checkpoint（`package.json` + lockfile + callsite 改動檔）
5. **NEVER push、NEVER /commit**：來源與 checkpoint 保留，回報 path／work id／HEAD／驗收證據，由 orchestrator 按 F.8 授權結批
6. **產生 commit msg（commitlint-aware）**：
   - 先 read consumer 的 commitlint 設定（`commitlint.config.{js,ts,mjs,cjs}` / `.commitlintrc.*` / `package.json` 內 `commitlint`）
   - 偵測限制：`type-enum` 允許清單、自定 `subject-has-chinese` plugin、`body-max-line-length` / `header-max-length`
   - 生 commit msg 必 **同時通過** worktree branch 跟 consumer main 的 commit-msg hook
   - 範例：某 consumer 用 `🧹 chore: 升級 @nuxt/ui ^4.7.0 → 4.8.0`；另一個 consumer 用 `⬆️ chore: upgrade @nuxt/ui ^4.7.1 → 4.8.0`
7. 回報 stdout 結尾：
   ```
   FLEET_SUBAGENT_RESULT: SUCCESS | PARTIAL | FAILURE
   CONSUMER_ID: <consumer_id>
   STAGED_FILES: <comma-separated paths>
   COMMIT_PLAN_MSG: <你在 step 6 生的、worktree 已驗證過 hook 的 msg verbatim>
   PI_FINDINGS: <pi research 找到的關鍵 URL / issue，若有>
   FAILURE_DETAIL: <若 FAILURE / PARTIAL，一段 ≤ 10 行的失敗描述>
   ```
   `COMMIT_PLAN_MSG` 必須是你在 worktree 上**真正用過**的 msg（hook 已驗證），orchestrator 在 Step F.8 結批時以它為建議 message。

## Git Baseline / 禁止

- worktree 內 main fork 過來的 in-flight 變更：**不要動**
- 工作範圍：`package.json` + lockfile + brief.callsites 列到的檔案
- ❌ `git push` / `git commit` on main / `/commit` skill
- ❌ 動 brief.callsites 範圍外的 source code
- ❌ runtime-native question interface（subagent 不直接跟 user 對話）

## Long-running

orchestrator 會用當前 runtime 的 continuation transport 跟你續跑 phase。請保持 session 狀態、不要主動結束。
