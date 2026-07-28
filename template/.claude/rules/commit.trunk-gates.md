---
description: main / master 限定的兩條 commit hard gate（Partial Archive Gate / 人工檢查 Gate）與 multi-session git hazard 交叉索引；跑 /commit 或觸及 spectra change 時 path-scoped 載入
paths:
  - 'openspec/changes/**'
  - '.claude/skills/commit/**'
  - '.claude/skills/spectra-archive/**'
  - '.claude/skills/spectra-verify/**'
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/commit.trunk-gates.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# Commit — Trunk Gates（[[commit]] detail）

本檔是 [[commit]] 的 path-scoped 延伸：兩條 main / master 限定 hard gate ＋ multi-session git hazard 交叉索引。**核心紀律（`git commit --only -- <paths>`、§ 禁止事項、Commit 預設位置）留在 [[commit]] 本體 always-load**，因為那些由「跑 commit 這個動作」觸發、不必然伴隨檔案存取；本檔兩條 gate 的觸發條件本身就是 `openspec/changes/**`，故可 path-scoped。

## Multi-session shared working-tree 的 git hazard 地圖

多 session 並行是常態，「全 working tree scope」的 git 操作會 silently 吃進別 session 的 staged WIP / untracked 新檔 / stash 內容 → mixed commit、WIP 永久遺失、deploy commit 內容跟 message 不符。

### 交叉索引

| 危害點 | 既有規約 | Pitfall |
| --- | --- | --- |
| Ad-hoc `git add + git commit` 吃別 session staged WIP | [[commit]] § Ad-hoc commit 必走 `git commit --only -- <paths>` | [[pitfall-consumer-ad-hoc-commit-eats-other-session-staged]] |
| `git stash push` 不帶 pathspec → scope leak | [[worktree-default]] §1（Stash strategy 隱性風險 / Anti-pattern 手動 selective baseline sync） | [[pitfall-git-stash-pathspec-scope-leak]] |
| `publish.mjs` auto-stash 把 tracked file 捲進 deploy commit | [[worktree-default]] §1 + [[clade-publish]] § Step 3（分組 commit，禁 `--stash-untracked` 對 tracked dirty） | [[pitfall-publish-auto-stash-bundles-tracked-into-deploy-commit]] |
| `publish.mjs` flow 清掉別 session 的 parallel untracked file | [[worktree-default]] §1（Pre-fork baseline guard） | [[pitfall-publish-flow-cleans-parallel-untracked]] |
| Merge-back auto-stash 整批捲走別 session WIP | [[worktree-default]] §5.5（Merge-back ceremony / Stash reconcile） | [[pitfall-merge-back-autostash-bulk-captures-other-session-wip]] |

已撞 mixed commit → [[commit]] § Recovery from mixed commit (multi-session safety)；cross-session staged 偵測層 → commit SKILL `Step 0-Coord`。

## Partial Archive Gate（main / master 限定，**hard rule**）

當前 branch 為 `main` / `master` 且本次 `/commit` 含**任一** `openspec/changes/<X>/**` staged-delete（**排除** `openspec/changes/archive/`）時，**MUST** 對該 change 同時驗證：

1. **archive directory 存在** — `openspec/changes/archive/YYYY-MM-DD-<X>/` 必須存在於 working tree（staged 或 untracked 皆可），且至少含 `tasks.md` + `proposal.md`
2. **spec delta-sync 完整** — 若 HEAD 內 `openspec/changes/<X>/specs/<cap>/spec.md` 存在，則 `openspec/specs/<cap>/spec.md` 必須有對應 staged modification

任一條件不成立 → **中止 commit**，release lock，列出殘缺項 + 印出 recovery hint（含 `git show HEAD:<src> > <dst>` 命令模板，見 commit SKILL `Step 0-Archive-Coupling`；詳見 [[pitfall-spectra-archive-interrupted-leaves-partial-state]] § Fix Recipe）。

### 為何 gate 在這

- `/spectra-archive` 是多 step 非 atomic flow，任一步驟中斷會留下 staged-delete + 缺 archive dir 的 partial state；直接 commit = `openspec/changes/<X>/**` 完全消失於 history，spec delta 卡在 wt-merge-block stash 也會永久遺失
- 跟人工檢查 Gate 並列：兩條都是 main / master 限定的 hard rule，都在 0-A/B/C 之前 fail-fast

### 無 override

**NEVER** 接受 `--skip-archive-coupling` / `--ignore-archive` / `$ARGUMENTS` 旗標。Gate 過 = archive flow 真的跑完。

- **NEVER** 用 `git restore --staged` 把 staged-deletes 退掉「敷衍 gate」— 掩蓋 in-flight archive state
- **NEVER** `mv archive/YYYY-MM-DD-<X>/ <somewhere-else>` 後重 stage 假裝 archive 存在
- **NEVER** 自行決定「也許那個 change 不該 archive」直接 unstage deletes — partial state 一律由 user 拍板

## 人工檢查 Gate（main / master 限定，**hard rule**）

當前 branch 為 `main` / `master` 且本次 `/commit` 觸及的 spectra change（`openspec/changes/<name>/**` 路徑，archive 子目錄除外）滿足下列**兩條件同時成立**時，未 ready 時 MUST 擋下 commit——但不是直接停下，走 /commit skill Step 0-MR 的 auto-triage：先推進 Claude 可自行處理項，再以 `check-review-readiness.mjs` gate 判定放行與否：

1. 該 change 的 `tasks.md` **非** `## 人工檢查` 段落含任一 `- [x]` → 已開始 / 完成實作
2. 該 change 的 `## 人工檢查` 段落含任一 `- [ ]` → 人工檢查未完成

只滿足其一不擋（純 propose 未動工、或實作完且人工檢查全綠，都允許 commit）。判定流程、fail-fast 位置見 `.claude/skills/commit/SKILL.md` Step 0-MR。

### 為何 gate 在這

- main / master 是 trunk 終點（直接 push 觸發 deploy / propagate），**沒有 PR review 擋一層** — 下一個人類關卡就是線上 user
- `## 人工檢查` 區就是要擋「實作完但 functional round-trip 未驗收」的工作（見 [[manual-review]] §「Screenshot Review ≠ Functional Verification」案例）；commit 進 main 等同跳過該保護
- 排在 0-A/B/C 之前 fail-fast，省 5–15 min 不必要的 codex / screenshot / check 成本

### 無 override

**NEVER** 接受 `--skip-manual-review-gate` / `--ignore-mr` / `$ARGUMENTS` 旗標等任何形式跳過。Gate 過 = 真的完成人工檢查（依 [[manual-review]] 「核心規則」由使用者親自驗收後勾選 `- [x]`）。

- **NEVER** 主線自行勾掉 `- [ ]` 來通過 gate — 違反 [[manual-review]] 核心規則「**NEVER** 自行標記 `## 人工檢查` 區塊中屬於 `[review:ui]` kind 的 `- [ ]` 為 `- [x]`」
- **NEVER** `git stash` / `mv` / `rm` 把 `tasks.md` 或 change 目錄移走讓 gate scan 抓不到 — 等同繞過 hard rule，亦違反 [[commit]] 「WIP 處置禁令」
- **NEVER** 把「人工檢查還沒完成」包裝成「審查條件已滿足」「等同 OK」「之後再勾」 — gate 看的是 tasks.md 的實際勾選狀態
- **NEVER** 建議 user「先 checkout 到 feature branch 跑 /commit 再 merge 回 main」繞過 gate
- **NEVER** 因為「使用者沒明說 main 算 trunk」而判 branch 不算 — `main` / `master` 都算
