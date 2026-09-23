<!-- Clade native rule; source: rules/core/worktree-default.md; edit canonical source -->
# Worktree Default

<!-- clade-targets: claude,codex,cursor -->
<!-- clade-adapters: claude,codex,cursor -->

**核心命題**：multi-session 共用 main；staged 區、branch HEAD、partial WIP 與 ignored artifacts 都會跨 session 滲漏。凡會改 tracked code 的工作預設在隔離 worktree，先保存並驗證成果，再由批次 `/commit` 落地；main 上其他 session 的 WIP NEVER stash、覆寫或猜測清理。

## Runtime boundary

Worktree、branch、archive、merge-back 的具體 carrier 由 target adapter 提供；本規則只定義共通 admission、驗收與保留 predicate。缺少已驗證 carrier 時保留 blocker，不能改用另一 runtime 的命令形狀。

## §1 預設用 worktree

請求含 implement／fix／refactor／add／edit／deployment prep／migration／config write 且目標是 tracked file → **先**開 worktree，再動 code。**MUST** 在獨立 worktree 內執行，**NEVER** 直接在 main 改。只有明示唯讀（grep、log、audit、history、解釋）可留在 main。

```bash
node vendor/scripts/wt-helper.ts add <slug> --task-summary "<一句話：這棵樹要做什麼>"
```

`/wt` 自動使用 `session/<YYYY-MM-DD-HHMM>-<slug>` 命名；這是唯一不需另問 branch 名稱的例外。已在 worktree（`git rev-parse --git-dir` 含 `/worktrees/`）就不要疊建。寫入共享登記簿（`.clade/flow/` 的決策題、`.impeccable/questions/`）要落在 main checkout 才讀得到；`flow ask` 已自動改寫落點並明說，其餘寫入端未涵蓋（見 clade TD-798）。parent session cwd 不動；先依 [[worktree-default.detail]] 完成 pre-fork baseline guard。

## 強制載入指針

送出 `wt-helper add`／`merge-back`／任何 worktree 操作前 MUST Read [[worktree-default.detail]]；該檔承載 baseline、命名位置、archive／propagate 互動、批次 landing、claim guard、teardown 與 troubleshooting 全文。

## §2 禁止 silent branch 建立

除 `/wt` 約定命名與 helper 內部必要 branch 外，agent 想建立 `feature/*`、`fix/*` 等 branch MUST 先取得 user 同意；**MUST NOT** 跑 `git checkout -b`；**唯一例外**：`/wt` 規約定義的命名授權。NEVER 偷建再說。helper 的 lifecycle 不得用 raw `git worktree remove`、`git branch -D` 或 force flag 繞過。

## §5 Visibility before landing

獨立切片的可見性是 **session branch 上的 draft PR**，不是合回 main。三件事分開：

1. **可見性**：slice owner push 該 branch、開 draft、登記 visibility receipt、盯該 PR CI（draft 期間只有機械檢查）。integration 模式的切片同樣 push 並開 PR、盯機械檢查，但 base 是 `integration/<work-id>`、不登記 receipt——整件工作的 visibility receipt 綁在 `integration/<work-id>` 對 `main` 那一張 draft。
2. **Ready**：coordinator 驗授權、writer release 與驗收後 `batch ready`，再跑完整 `/commit`。
3. **Landing**：只有具名 coordinator 在 unattended predicate 全成立時 squash；**worker NEVER merge**、**NEVER** 直推 `main`。

slice owner 在相對 `main` 有非空 committed diff 後 MUST push **該** branch 並開 draft PR，再盯該 PR 的 CI；紅燈回同一 owner、同一張 PR。**Integration 模式**（預設；[[github-flow]] § Integration branch）：同一個 work id 有 2 個以上切片時，worker push **該** branch 並對 `integration/<work-id>` 開 PR（`gh pr create --base integration/<work-id>`，做到一半先開 draft），盯該 PR 的 CI（只有機械檢查、不跑 test-lane）；在來源 worktree 跑完本機門檻（canonical check ＋ repo 在 CI 機械檢查裡跑的 typecheck；clade 是 `pnpm exec vp check` ＋ `npx tsc -p tsconfig.clade.json --noEmit`，動到 vendor/scripts 再加 `npx tsc -p tsconfig.vendor.json --noEmit`。兩條 tsc 以秒計、不必排 heavy gate slot。`test:affected` 仍由 coordinator 在 integration 轉 ready 前跑一次）且該 PR 的 CI 全綠後，自己 `gh pr ready` 該切片 PR，completion 回 coordinator，由 coordinator 以 `integration-merge.ts --pr <n>` 落地。切片 PR 不登記 `batch draft` receipt；**NEVER** 對 `main` 開 PR、**NEVER** 自己 merge。只有一個切片就完工的工作才走上面那條 base 為 `main` 的 draft PR。**NEVER** 為了看得見而 merge-back 或直推 `main`。Draft 維持 draft 直到 review。平行預設走隔離雲端／worktree；要 shared live DB（desk LXC／3040）才 desk。操作見 [[github-flow]] 與 [[db-topology-invariant]]。Cloud clone 的絕對路徑不能當 desk 共用 worktree；coordinator 必須 fetch 具名 branch 並在本機受管來源對同一 `workId` 建映射。唯一 landing owner 在本 repository，worker 不持 merge credential。

merge-back 是驗收後的 landing ceremony，不是「先合回去比較方便」。主線尚未看到本次 revision 的必要 evidence／驗收通過前，命中「合回、收尾、完成、已解決」等落地話術 MUST 停下，切回 worktree 內的 dev-server／驗收路徑；驗收與正式 landing 分開。

## §6 保留與回收

cleanup 只能在無 active claim／writer／lock、user WIP 已保存、source HEAD 與 receipt 相符、正式 landing 或 content receipt 可驗、ignored artifacts 可復原、teardown 成功時進行。`merged`、`clean`、`done` 或 `work.done` 單獨都不是刪除證據；不確定就 retain 並寫 owner + 下一個可觀察 landing signal。完整分類與工具步驟依 detail、[[handoff]]、[[wip-orphan-recovery]]。

## 相關規則

scope／共享檔案寫入依 [[scope-discipline]] 與 [[shared-file-concurrent-write]]；session 任務與收工依 [[session-tasks]]；正式 commit、publish、propagate 依各自 owner。worktree 本身只是隔離載體，不會改變 routing、evidence 或 user authorization gate。
