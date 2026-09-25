---
description: Worktree 升級路徑 / Stop hook 死鎖 / spectra DB 跨 wt 共享 / artifact git / phase-tick commit / main 端 tasks.md 打勾方向判定 / review-gui 坑（已退役）/ WORKTREE-BRIEF（worktree-default §7–§12 detail）
paths:
  - 'openspec/changes/**'
  - 'vendor/scripts/wt-helper.ts'
  - 'vendor/scripts/stash-reconcile.ts'
  - 'scripts/wt-helper.ts'
---
<!-- Clade native rule; source: rules/core/worktree-default.troubleshooting.md; edit canonical source -->

> Path-scoped detail of [[worktree-default]] §7–§12。核心 always-load 規約在母檔 worktree-default.md。

<!-- clade-targets: claude,codex,cursor -->
<!-- clade-adapters: claude,codex,cursor -->

## §7 升級路徑與 grandfathered worktree

命名不符 `session/*` 的舊 worktree **grandfathered**，不強制重命名；`wt-helper list` / `prune` 只認 `session/` 前綴，新建一律走 `/wt`。V2 → V3 in-flight worktree 處置：ready archive → OPSX 在實作樹驗 gate、archive、commit bookkeeping，再由主持者序列落地；還在 implementation → 沿原身分接續；ad-hoc Form-1 → `wt-helper land-pending <slug>`（alias of merge-back，容忍 multi-commit branch）；內容已被 main 後續改寫取代 → `cleanup <slug> --superseded-by <commit|file=commit|file=path>[,…] --reason <text>`（逐檔證據，tip 釘在 `refs/wt-superseded/`，不丟內容）；過時不要 → `cleanup --force --force-discard-unland`（**永久砍 commit**）。Legacy `cross-session-block-*` stash 走 `stash-reconcile.ts`；HANDOFF drift 由 session-start `handoff-drift-scan.ts` 偵測，drift → `/handoff` refresh。

## §8 Stop hook 死鎖 fallback

死鎖場景：**主線在 main 累積當前 session 的 dirty WIP + Stop hook 攔住 + 還要繼續做**。兩分支：

- **剩下的事可靠 `/wt` 隔離** → 跑 `/wt <剩下要做的事>`；新 worktree 從 main HEAD 開、看不到主線 dirty WIP，撞同檔走 §5 squash conflict fallback。
- **必須在 main 直接處理（罕見）** → escalate to `/handoff`（Mode A 自動偵測，per [[handoff]]）；HANDOFF entry 含 Stop hook 攔點 + missing acceptance criterion + 改過檔案清單 + 下一 session 接手指引。

要把後續 skill dispatch 出去時走 `/wt <slug>: /<next-skill>` form（per [[wt]] Form 3），不切 parent cwd。

### 預防原則

Session 開頭判定要動 code 就 **SHOULD** 立刻打 `/wt <task>`，不要先在 main 改一改才想到該開 worktree。

## §9 spectra DB 跨 worktree 共享心智模型

核心禁令見 [[worktree-default.detail]] §9。補充：偵測「zombie」時 `find` 的範圍是 `~/offline/<consumer>-wt`；啟動 active / parked change `apply` 前 **MUST** `git worktree list` 確認別 session 沒在同 change 做；誤動 DB 後從 `/tmp/spectra-db-backup-*.db` restore。

## §9.5 需求 artifacts 與證據持久性

Canonical intent 與投影保留在實作 checkout，正式 evidence receipt 走 OPSX evidence command。每個 phase 完成後先回讀目前 revision 的證據與 gate，執行 project，再限定路徑 commit tracked artifacts。commit message 用合法 `📝 docs` type；未 commit 的檔案不會由 squash 帶回 main。

Legacy 原件以 OPSX history（path 或 legacy-change-id）回讀並確認 digest。未完需求先以 supersedes／provenance 建立承接關係，再 materialize；不執行 Spectra park／unpark，不手動勾 tasks.md 或寫 touched sidecar。GC 前確認證據儲存位置可從正式 checkout 回讀，不能只依 ephemeral worktree。

history 回 corrupt／unsupported／truncated 時，先恢復可讀原件並核對內容與 digest；確認前不 create 承接 change、不 materialize。保留原件與具體 blocker，不能憑空補來源內容。

## §9.7.1 main 與 worktree 的投影分歧

每次看到 tasks.md 分歧，先分辨 canonical OPSX projection 與 legacy 原件。OPSX 由目前 revision 的同一 source／receipt 重建，不能合併 checkbox 宣告完成。legacy 的任何獨有內容都先保存並回讀 digest，再作承接；未確認身分、revision 與來源前，不以較舊時間、相同勾選數或 stash 標題捨棄任一份內容。

`git diff HEAD -- <path>` 同時包含 staged 與 unstaged，逐項比較來源，不能只看 `--stat`。worktree 是隔離位置，不是較新證據的保證。

## §10 review-gui 與 worktree 互動的已知坑

面板讀 spine 的 read model，人工 gate 由 `flow gates` 判定，不掃 worktree 的 change 目錄，所以舊聚合器的三條坑不適用。歷史脈絡在 [[pitfall-review-gui-collision-typo-and-worktree-startup]]、[[pitfall-review-gui-source-aggregation-collision]]、[[pitfall-review-gui-apply-pending-mid-apply-changes]]。

## §11 WORKTREE-BRIEF.md — 持久化任務交接上下文

讀取與更新義務見 [[worktree-default.detail]] §11；brief 是這個 worktree「該做什麼、做到哪、還剩什麼」的唯一權威來源。完成時 frontmatter `status` 改為 `done`（或 `blocked` / `failed`）。

**Resume path**：新 session 進入有 brief 的 worktree 時，走 brief 裡的 Recovery section：

1. `git log main..HEAD --oneline` 看已完成 commit
2. `git status` 看未 commit 的工作
3. 從 Progress 下一個未勾選項繼續
4. 不要從頭來過 — brief 已包含 digested context

**`/wt resume <slug>`**：明確 resume 入口。偵測既有 worktree + brief → 跳過建立，直接 dispatch resume subagent。

## §12 archive / merge-back 撞平行 worktree fork residue — canonical recovery

多條 change 平行、其中一條要 archive / merge-back 收尾時，會撞兩類 fork-time residue 阻擋。**MUST** 照下列 recovery 直接做，**NEVER** 回頭問 user。完整根因見 pitfall `pitfall-archive-mergeback-parallel-worktree-fork-residue`。

### §12.1 merge-back blocker 是別 session 的 main WIP

先檢查 main dirty 與活 claim，和持有者協調可落地的時點。`--auto-stash` 會捕捉全部 main dirty，不能把它當最小範圍操作。依 [[worktree-default.commit-ceremony]] dry-run／claim guard 放行後再執行，完成時檢查還原結果；有 conflict 就保留 stash 並依明示 recovery 處理。

### §12.2 legacy archive 曾撞 sibling 副本

OPSX 按指定 repo／change 身分解析並執行 gate，不以 sibling worktree 的同名目錄阻擋。遇到同名歷史先 history 回讀來源與 digest，NEVER 刪除其他 worktree 的原件來讓新 archive 通過。未確認的 ownership 或來源衝突保持可見並回報。
