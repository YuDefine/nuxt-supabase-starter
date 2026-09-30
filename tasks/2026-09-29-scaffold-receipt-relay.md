---
work_id: W-2026-09-29-starter-scaffold-receipt-clade-536-7
---

# starter scaffold receipt（clade plan 第 7 項 starter 半）— 交棒 brief

你是**繼任者**，不是被派去做一件子工作的 worker。前任 session 把 starter 半做完並已 merge，交棒理由：剩下的
pinned 驗證要等外部事件（clade 發出含 YuDefine/clade#536 的 release），前任無法在本 session 內完成（已於 2026-09-29 完成，見〈pinned 驗證〉）。

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

## pinned 驗證（已完成，2026-09-29）

- 外部事件已到：clade #536（`eb1828ef3`）是 tag v1.13.44（`245cb29ce`）的 ancestor；starter 也已升到 v1.13.44（`37b08828`）。
- 做法（Node v24.21.0）：從 clade clone tag v1.13.44，`node scripts/consumer-release.ts build --version 1.13.44` 建本機 release store。
  starter CLI（main `453b60a3` 的 dist）帶 `--release 1.13.44 --release-store <store> --registry-path <clone 的 registry> --no-push --offline --no-install --yes`，
  且帶齊 `--workflow-model`／`--business-activity`／`--deploy-track`。之後補 origin remote，跑 `pnpm install`。registry 與 visibility 快取只寫進 throwaway clone，
  真 `~/offline/clade` 的 `registry/`、`.spectra/` 為 0 行異動。
- 結果：**PASS**。effectivePolicy 為 `pinned@1.13.44`（inventory `2ffb72c0…`）；receipt 有 1369 筆且已 commit。
  postinstall 顯示 `✓ hub-sync`、`✓ bootstrap complete`，`pnpm install` exit 0，`unowned file differs at first projection` 出現 0 次；`pnpm hub:check` exit 0。
- 對照組 v1.13.43（不含 #536），同腳本同旗標：`unowned file differs at first projection: .claude/skills/clade-code-quality/rules/code-style.toolchain.md`，exit 1。
- 附帶觀察（交 clade 主線判斷，本 repo 不處理）：
  - 首投影後有 82 個 tracked 檔變成 modified，符合 adoption「認領後覆寫成 desired」的設計，所以新專案第一次 install 後會有一批投影 diff 待 commit。
  - `--yes` 缺上述三個旗標會回 `INTAKE_INVALID`。
  - GitHub repo 尚未建立時，hub-sync 會停在 visibility 無法判定。
- **唯一未驗**：在 fresh cloud session 上實跑（本次在桌機跑）。
- 回寫 clade plan 第 7 項：歸 clade 主持者，不在本 repo 的範圍。
- 報告原檔（scratch，可能被清）：`/tmp/claude-1000/-home-charles-offline-nuxt-supabase-starter/25f21f5c-7766-44ff-b7fc-7c4d03dba375/scratchpad/pinned-1.13.44-report.md`

## 邊界

- throwaway 專案與 registry 寫入只放 scratch／throwaway clone，**NEVER** 動真 `registry/consumers.json`。
- 先讀本 brief 與 repo 規約，再自行續跑；可修復的品質 gate 失敗就地修（只對自己擁有的路徑 `--fix`），不可修復才停，不向原 session 輪詢。
