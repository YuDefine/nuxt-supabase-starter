---
work_id: W-2026-09-29-starter-scaffold-receipt-clade-536-7
---

# starter scaffold receipt（clade plan 第 7 項 starter 半）— 交棒 brief

你是**繼任者**，不是被派去做一件子工作的 worker。前任 session 把 starter 半做完並已 merge，交棒理由：剩下的
pinned 驗證要等外部事件（clade 發出含 YuDefine/clade#536 的 release），前任無法在本 session 內完成。

- **repo／cwd：** `~/offline/nuxt-supabase-starter`（main checkout）
- **原派工 brief：** `~/offline/clade/tasks/2026-09-29-1650-starter-scaffold-receipt-brief.md`
- **工作指針：** clade plan `~/offline/clade/specs/plans/W-2026-09-29-cloud-new-project-sop/plan.md` Open work 第 7 項
- **in-flight dispatch：** 無

## 已完成（SoT 在括號內）

- starter PR YuDefine/nuxt-supabase-starter#15 已 squash merge 為 `453b60a3`（`gh pr view 15`）。CI 的 Unit tests／smoke 紅燈與 PR #13 相同，是既有 TD-021／TD-019，與本改動無關。改動內容：新增 `template/packages/create-nuxt-starter/src/scaffold-receipt.ts`。
  `postScaffold` 寫 receipt 兩次：第一次在剝掉 hub.json 之後、init-consumer 與 `pnpm install` 之前；第二次在 initial commit 前，用最終位元組刷新。
  receipt 位於 repo 根的 `.clade-scaffold-receipt.json`，scaffold-only 也會寫，並隨 initial commit 進版控。
- 單元測試：`cd template/packages/create-nuxt-starter && pnpm exec vp test run test/scaffold-receipt.test.ts`（3 passed）。
  驗了三件事：install 當下每筆 hash 等於磁碟內容；committed receipt 等於 initial commit 的 blob；`--no-install` 加 `dbHost` 改寫後仍一致。
  全套為 235 passed / 2 skipped。
- e2e（非 pinned，只驗機制，2026-09-29）：在 scratch 對 clade #536 做 throwaway clone，registry 條目與 visibility 快取都只寫進該 clone。
  專案補上 `origin` remote 讓 `findRegistryEntryForCwd` 反查得到，然後跑 `pnpm install`：
  - main（對照組）：`unowned file differs at first projection: .claude/skills/clade-code-quality/SKILL.md`，exit 1。
  - 本改動：scaffold 內 install 路徑 exit 0；`--no-install` 後補跑 install 出現 `✓ hub-sync`，exit 0。
  - 注意：scaffold 內 install 那條在沒有 git remote 時，會先停在 `Consumer identity unavailable`。這與 receipt 無關，是首投影之前的另一道門。
- commit 0-A（Opus 5.5 medium）通過：Critical 0 / Major 0 / Minor 3，3 項已修。repo root session 載不到 `commit-0a-reviewer`（TD-022），改在 worktree 的 `template/` 開 headless `claude -p --model opus`，由它跑 prepare → Agent → finalize。

## 剩餘步驟（等外部事件才做）

1. 確認 clade #536 已 merge，且已發出包含它的 release：`gh pr view 536 -R YuDefine/clade`，並查 clade tags／CHANGELOG。沒發版就維持等待，**不要**用時間流逝當重試理由。
2. 發版後驗 pinned 路徑。照 plan 第 6 項的本機 release store 做法（需 Node 24）：
   - `node scripts/consumer-release.ts build --version <ver> --source <該 tag 的 clade clone> --output <store>`
   - starter CLI 帶 `--release <ver> --release-store <store> --registry-path <隔離的 registry 副本> --no-push --offline --no-install`
   - 補 origin remote 後跑 `pnpm install`
   - 期望 postinstall 不出現 `unowned file differs at first projection`
3. 結果寫回 clade plan 第 7 項（歸 clade desk 主線所有；本 repo **NEVER** 改 clade 檔，要改就交給 clade 主線）。

## 邊界

- throwaway 專案與 registry 寫入只放 scratch／throwaway clone，**NEVER** 動真 `registry/consumers.json`。
- 先讀本 brief 與 repo 規約，再自行續跑；可修復的品質 gate 失敗就地修（只對自己擁有的路徑 `--fix`），不可修復才停，不向原 session 輪詢。
