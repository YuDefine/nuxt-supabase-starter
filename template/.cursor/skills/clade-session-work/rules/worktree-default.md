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

`/wt` 自動使用 `session/<YYYY-MM-DD-HHMM>-<slug>` 命名；這是唯一不需另問 branch 名稱的例外。已在 worktree（`git rev-parse --git-dir` 含 `/worktrees/`）就不要疊建。parent session cwd 不動；先依 [[worktree-default.detail]] 完成 pre-fork baseline guard。

## 強制載入指針

送出 `wt-helper add`／`merge-back`／任何 worktree 操作前 MUST Read [[worktree-default.detail]]；該檔承載 baseline、命名位置、archive／propagate 互動、批次 landing、claim guard、teardown 與 troubleshooting 全文。

## §2 禁止 silent branch 建立

除 `/wt` 約定命名與 helper 內部必要 branch 外，agent 想建立 `feature/*`、`fix/*` 等 branch MUST 先取得 user 同意；**MUST NOT** 跑 `git checkout -b`；**唯一例外**：`/wt` 規約定義的命名授權。NEVER 偷建再說。helper 的 lifecycle 不得用 raw `git worktree remove`、`git branch -D` 或 force flag 繞過。

## §5 Visibility before landing

merge-back 是驗收後的 landing ceremony，不是「先合回去比較方便」。主線尚未看到本次 revision 的必要 evidence／驗收通過前，命中「合回、收尾、完成、已解決」等落地話術 MUST 停下，切回 worktree 內的 dev-server／驗收路徑；驗收與正式 landing 分開。

## §6 保留與回收

cleanup 只能在無 active claim／writer／lock、user WIP 已保存、source HEAD 與 receipt 相符、正式 landing 或 content receipt 可驗、ignored artifacts 可復原、teardown 成功時進行。`merged`、`clean`、`done` 或 `work.done` 單獨都不是刪除證據；不確定就 retain 並寫 owner + 下一個可觀察 landing signal。完整分類與工具步驟依 detail、[[handoff]]、[[wip-orphan-recovery]]。

## 相關規則

scope／共享檔案寫入依 [[scope-discipline]] 與 [[shared-file-concurrent-write]]；session 任務與收工依 [[session-tasks]]；正式 commit、publish、propagate 依各自 owner。worktree 本身只是隔離載體，不會改變 routing、evidence 或 user authorization gate。
