---
name: "clade-delivery"
description: "Commit, CI, release, and repository delivery rules. Use when committing, changing CI, preparing delivery, or handling repository state."
---

# SOP

## Phase 1 -- 用任務挑出要讀的 rule

1. READ 逐條對照接下來要做的事：條件成立才把該 rule 列入候選，NEVER 整批讀。
   - `rules/ci-workflow.md`：CI workflow 撰寫規約——外部 GitHub Action 的 uses: MUST SHA-pin、CI 三層分工（PR 只跑必要、e2e 在合併後、0-A 在 PR 開出後）；動 .github/workflows 或 .github/actions 時載入；且碰 `.github/workflows/**`、`.github/actions/**`
   - `rules/commit.detail.md`：Commit 全文規約（gate 清單、Single Session Lock、WIP 處置決策樹、main worktree 預設位置、ad-hoc `git commit --only` 紀律與 Verify / Recovery、路徑白名單、trunk hard gate、Stash 自動處置 gate、分組與訊息規範、Tag 位置 release hard gate）；always-load 的薄 pointer 在 [[commit]]，觸發時機是「下任何 git commit / git add / git stash / git tag / git push --tags / git push origin v<版本> / /commit 之前」，由 [[commit]] 的 MUST-Read 指針叫醒；且碰 `HANDOFF.md`、`tasks/**`、`.clade/claims/**`
   - `rules/commit.md`：要 commit，或要處置 WIP／stash 之前
   - `rules/commit.trunk-gates.md`：main / master 限定的人工檢查 commit hard gate 與 multi-session git hazard 交叉索引；觸及 work item carrier（tasks/**、specs/plans/**、docs/plans/**）時 path-scoped 載入；且碰 `tasks/**`、`specs/plans/**`、`docs/plans/**`
   - `rules/github-flow.md`：GitHub Flow 事件責任與成本邊界 — checkpoint、review、合併、回收、發版分成不同事件；且碰 `vendor/scripts/wt-batch.ts`、`capabilities/core/skills/commit/**`、`capabilities/core/skills/wt/**` 等 8 處
   - `rules/self-hosted-runner.md`：Self-hosted GitHub Actions runner 的標籤設計、job 路由契約與職責分工；且碰 `.github/workflows/**`、`registry/consumers.json`

## Phase 2 -- 只讀候選 rule 中與任務相關的段落

1. READ `rules/_sections.md` 中候選 rule 的區塊（首行 `<file> — `、空行結束；用 Grep 加 `-A 40` 取（區塊最長約 38 行，讀到空行為止，其後是下一份 rule 的區塊），NEVER 整份讀索引），只挑與任務相關的段落，用 Read 的 offset／limit 讀該行號區間。
2. READ 標題看不出相關與否的 rule 才整份讀；NEVER 用條件清單或段落索引代替 rule 內文。
