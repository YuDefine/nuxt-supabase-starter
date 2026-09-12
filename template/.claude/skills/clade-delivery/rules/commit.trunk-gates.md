---
description: main / master 限定的人工檢查 commit hard gate 與 multi-session git hazard 交叉索引；觸及 work item carrier（tasks/**、specs/plans/**）時 path-scoped 載入
paths:
  - 'tasks/**'
  - 'specs/plans/**'
---
<!-- Clade native rule; source: rules/core/commit.trunk-gates.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->

# Commit — Trunk Gates（[[commit]] detail）

**批次 integration 同樣適用本 gate**：以 helper 登記的 path／base→candidate 判定，不能以 feature branch 名稱跳過。批次 0-MR 不採「來源未 land」SKIP；auto-triage 後仍有 blocker 就保留整批、停止 seal／land。下列 main-only 的歷史存量 pathspec withholding 只用於普通 main 模式。

本檔是 [[commit]] 的 path-scoped 延伸：main / master 限定的人工檢查 hard gate ＋ multi-session git hazard 交叉索引。**核心紀律（`git commit --only -- <paths>`、§ 禁止事項、Commit 預設位置）留在 [[commit]] 本體 always-load**，因為那些由「跑 commit 這個動作」觸發、不必然伴隨檔案存取；本檔這條 gate 的觸發條件本身就是 work item carrier 的路徑，故可 path-scoped。

## Multi-session shared working-tree 的 git hazard 地圖

多 session 並行是常態，「全 working tree scope」的 git 操作會 silently 吃進別 session 的 staged WIP / untracked 新檔 / stash 內容 → mixed commit、WIP 永久遺失、deploy commit 內容跟 message 不符。

### 交叉索引

| 危害點 | 既有規約 | Pitfall |
| --- | --- | --- |
| Ad-hoc `git add + git commit` 吃別 session staged WIP | [[commit]] § Ad-hoc commit 必走 `git commit --only -- <paths>` | [[pitfall-consumer-ad-hoc-commit-eats-other-session-staged]] |
| `git stash push` 不帶 pathspec → scope leak | [[worktree-default]] §1（Stash strategy 隱性風險 / Anti-pattern 手動 selective baseline sync） | [[pitfall-git-stash-pathspec-scope-leak]] |
| `publish.ts` auto-stash 把 tracked file 捲進 deploy commit | [[worktree-default]] §1 + [[clade-publish]] § Step 3（分組 commit，禁 `--stash-untracked` 對 tracked dirty） | [[pitfall-publish-auto-stash-bundles-tracked-into-deploy-commit]] |
| `publish.ts` flow 清掉別 session 的 parallel untracked file | [[worktree-default]] §1（Pre-fork baseline guard） | [[pitfall-publish-flow-cleans-parallel-untracked]] |
| Merge-back auto-stash 整批捲走別 session WIP | [[worktree-default]] §5.5（Merge-back ceremony / Stash reconcile） | [[pitfall-merge-back-autostash-bulk-captures-other-session-wip]] |

已撞 mixed commit → [[commit]] § Recovery from mixed commit (multi-session safety)；cross-session staged 偵測層 → commit SKILL `Step 0-Coord`。

## 人工檢查 Gate（main / master 限定，**hard rule**）

當前 branch 為 `main` / `master` 且本次 `/commit` 觸及的 work item carrier（`tasks/<date>-<slug>.md` 或 `specs/plans/NNN-<slug>/tasks.md`）滿足下列**兩條件同時成立**時，未 ready 時 MUST 擋下 commit——但不是直接停下，走 /commit skill Step 0-MR 的 auto-triage：先推進主線可自行處理項，再以 `check-review-readiness.ts` gate 判定放行與否：

0. **該工作的實作 code 已 land 進 main** → 對應 worktree 已 merge-back（`wt-helper list --json` 的 `mergedToMain:true`）或已 cleanup。仍有未 land 的 worktree 帶著該工作的改動時，本 gate 對它判 **SKIP**
1. 該 carrier 的 **非** `## 人工檢查` 段落含任一 `- [x]` → 已開始 / 完成實作
2. 該 carrier 的 `## 人工檢查` 段落含任一 `- [ ]` → 人工檢查未完成

只滿足其一不擋（尚未動工、或實作完且人工檢查全綠，都允許 commit）。判定流程、fail-fast 位置見當前 runtime 已投影的 commit skill Step 0-MR；`.claude/skills/commit/SKILL.md` 是 Claude 的交付位置。

**擋的粒度是 pathspec 交集，不是 repo 級 freeze**（TD-897）：一件工作判 BLOCK，被 withheld 的是落在該 carrier 的路徑（`tasks/<date>-<slug>.md`，或 `specs/plans/NNN-<slug>/**`）；同一次 `/commit` 其餘 group 的 `git commit --only -- <pathspec>` 照常落地。pathspec 只接受具名檔或該 plan package 目錄以下的路徑——祖先目錄（`.`、`tasks`、`specs`、`specs/plans`）、glob、`:` magic、絕對路徑一律視為交集擋下，空 pathspec 恆擋。判定式與理由在 `plugins/hub-core/skills/commit/gates.md` § 0-MR「判定粒度」；其他 group 放行 **NEVER** 讀成該工作已驗收，auto-triage 對它一條沒少。

### 為何加條件 0（worktree 未 land 即 SKIP）

普通 main 的 artifact annotation 可能先於來源落地；條件 0 對這種歷史存量避免連坐無關變更。批次 integration 含來源實作，不能使用此 SKIP。

實證（<consumer-b> 2026-08-21）：main 9 個 dirty 檔中僅一份 work item carrier 觸發 gate，該工作的 code 全在 `mergedToMain:false` 的 worktree 內，卻連帶卡住 `docs/tech-debt.md`、`nuxt.config.ts`、`shared/schemas/*` 等 8 個無關檔。

來源的人工驗收保持；修復在來源內完成並重新 checkpoint／ready，批次通過完整品質鏈後才落地 main。發布仍依既有 Step 6 gates；普通 main 的 pathspec withholding 不改變既有歷史 code。

### 為何 gate 在這

- main / master 是 trunk 終點（直接 push 觸發 deploy / propagate），**沒有 PR review 擋一層** — 下一個人類關卡就是線上 user
- `## 人工檢查` 區就是要擋「實作完但 functional round-trip 未驗收」的工作（見 [[manual-review]] §「Screenshot Review ≠ Functional Verification」案例）；commit 進 main 等同跳過該保護
- 排在 0-A/B/C 之前 fail-fast，省 5–15 min 不必要的 codex / screenshot / check 成本

### 無 override

**NEVER** 接受 `--skip-manual-review-gate` / `--ignore-mr` / `$ARGUMENTS` 旗標等任何形式跳過。Gate 過 = 真的完成人工檢查（依 [[manual-review]] 「核心規則」由使用者親自驗收後勾選 `- [x]`）。

- **NEVER** 主線自行勾掉 `- [ ]` 來通過 gate — 違反 [[manual-review]] 核心規則「**NEVER** 自行標記 `## 人工檢查` 區塊中屬於 `[review:ui]` kind 的 `- [ ]` 為 `- [x]`」
- **NEVER** `git stash` / `mv` / `rm` 把 carrier 檔或 plan package 目錄移走讓 gate scan 抓不到 — 等同繞過 hard rule，亦違反 [[commit]] 「WIP 處置禁令」
- **NEVER** 把「人工檢查還沒完成」包裝成「審查條件已滿足」「等同 OK」「之後再勾」 — gate 看的是 carrier 檔的實際勾選狀態
- **NEVER** 建議 user「先 checkout 到 feature branch 跑 /commit 再 merge 回 main」繞過 gate
- **NEVER** 因為「使用者沒明說 main 算 trunk」而判 branch 不算 — `main` / `master` 都算
- **NEVER** 為了讓條件 0 成立而動 worktree（不 merge-back、重開同名 worktree、改 branch 名）— 條件 0 是事實查詢，不是可操作的開關
- **NEVER** 把條件 0 的 SKIP 讀成該工作的人工檢查可以省略 — 那些 item 一條沒少，只是延後到來源 land 時判
