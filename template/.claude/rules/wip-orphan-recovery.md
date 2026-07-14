---
description: Orphan WIP（worktree dirty + claim 無效/過期）接手 SOP——session 死後 working tree 未 commit 改動的完成度判斷與 land/discard 流程；處理 HANDOFF / session 交接 / 別 session 遺留時 path-scoped 載入
paths: ['HANDOFF.md', 'tasks/**']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/wip-orphan-recovery.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# WIP Orphan Recovery

> Reference 檔。被 Stop hook（`stop-wip-guard.sh`）warn message 與 `handoff-drift-scan.mjs` Trigger 5（`orphan-uncommitted-wip`）指向。預防層見 [[worktree-default]] §5、claim 機制見 [[session-claims]]、升級出口見 [[handoff]] / [[session-tasks]]。

## 什麼是 orphan WIP

worktree working tree 有**未 commit 的 user 改動**（`git status --porcelain` 非空、且過濾掉 clade projection 後仍有檔）**且**該 worktree 對應 claim 不存在或已過期（session 已死 / 結束沒收尾）。

**核心問題**：commit 是唯一的完成度標記，但 orphan WIP 定義就是「還沒 commit」。session 一死，這批改動成黑箱——新 session 無從得知「做到哪、做完沒、為什麼這樣改、是不是半成品被打斷」。只能靠下方 SOP 逐一考古推斷。

## 兩個偵測入口

| 層 | 機制 | 時機 |
| --- | --- | --- |
| 提醒（Layer 0） | Stop hook `stop-wip-guard.sh` | session 結束前 working tree 有 user WIP → **warn**（不阻擋），提醒有未 commit 改動。多 session 並行共用 working tree 是常態，dirty file 可能屬於別的 active session，不應 block |
| 事後（Layer 2） | `handoff-drift-scan.mjs` Trigger 5 `orphan-uncommitted-wip` | session-start drift scan 偵測「worktree dirty + claim 無效/過期」→ 列出待接手。**有 active claim 的 dirty worktree 不報**（不擾動 live session） |

兩層共用 `wip-dirty.mjs` 的 `userDirtyPaths()`（single-source projection filter，與 `wt-helper merge-back` 同源，避免重刻 `LOCKED_PROJECTION_RE` 漂移）。

## 接手 SOP（碰到 orphan WIP 時逐步跑）

1. **git status 攤平**：`git -C <worktree> status --short` 看全部 dirty + `git -C <worktree> log --oneline -6` 看最近 commit。**禁止**憑印象，拿 git 即時真相。
2. **半成品痕跡掃描**：`git diff` grep `TODO|FIXME|XXX|debugger|console\.(log|debug)|\bWIP\b`。命中 = 高機率半成品被打斷 → 偏向回報 user，不輕易 commit。
3. **完成度硬驗**：跑 `vp check`（fmt/lint）；視情況 typecheck / test。0 errors 是「可 commit」的硬門檻之一（warnings 多為既有、非阻擋）。
4. **git log 脈絡比對**：對照 `tasks.md` / `proposal.md` / review issue，判斷這批 WIP 對應哪些 task / finding / issue（是「做完忘 commit」還是「做一半」）。
5. **危險項識別（最關鍵）**：掃 dirty 清單有無：
   - **跨 change 目錄刪除**（`D openspec/changes/<別的-change>/...`）→ 該 change 可能有自己 active worktree，刪除若 commit/merge 回 main 會**破壞別 change**。**MUST** `git -C <worktree> checkout HEAD -- <該目錄>` restore 保護，**NEVER** 連同 commit。
   - **跨 session 檔**（不屬本批工作主題的檔）→ 比對 claim `expected_paths` / 另一 worktree，疑似別 session WIP 滲入 → 回報，不擅自處置。
6. **收尾分流**：
   - **完成 + 驗過 + 無危險項** → selective commit（`git -C <worktree> commit --only -- <每個 scoped 檔>`，**禁止** `git add -A`）到 session branch。
   - **半成品 / 完成度不確定 / 含危險項** → **STOP + 回報 user**，攤平 facts（git status + 完成度驗證結果 + 危險項），讓 user 拍板。**NEVER** 自行 commit 半成品或 discard user WIP。

## 禁止事項

- **NEVER** 盲目 `git add -A` + commit 整批 orphan WIP — 先跑步驟 2-5 驗完成度 + 識別危險項
- **NEVER** commit 跨 change 目錄刪除（破壞別 change 的 openspec artifacts）— 一律 restore 保護
- **NEVER** discard / `git checkout --` user WIP 而未回報 user（per [[commit]] WIP 處置禁令）
- **NEVER** 對 active-claim 的 dirty worktree 當 orphan 處理 — 那是 live session 正在做（drift-scan Trigger 5 已排除，手動接手時也 MUST 先查 claim）
- **NEVER** 假設 orphan WIP 是完成態 — 沒 commit message 的完成度自評，預設視為「待驗證」
- **NEVER** 為了消掉 stop hook / drift-scan 的 orphan WIP warn，反射性把該檔加進 `.gitignore`（詳見下節）

## 反射性 gitignore 禁令（stop hook 攔 orphan WIP 時）

Stop hook `stop-wip-guard.sh` warn「working tree 有未 commit 改動」時，**正確反射只有兩個**：

1. **commit 它**（完成 + 驗過 + 無危險項 → selective commit per 上方 SOP 步驟 6）
2. **寫 HANDOFF**（半成品 / 不確定 → 升 `HANDOFF.md` 或 `tasks/<id>.md` 留接手脈絡）

**NEVER** 把 untracked WIP 檔（典型：`tasks/todo.md`、新建 doc）加進 `.gitignore` 來「消掉 warn 噪音」——那是把**該入庫的東西藏起來**，方向完全反了。warn 的目的是提醒「有東西還沒收尾」，加 gitignore 等於拔掉警報器而非處理火源。

> **判斷準則**：想加 `.gitignore` 時 STOP 自問「這個檔本來就該 ignore（build artifact / runtime state / secret），還是我只是想讓 warn 閉嘴？」後者一律走 commit 或 HANDOFF。對應 [[commit]] § Step 3（untracked 非 ignored 一律納入分組）+ Step 2 `.gitignore` 變更處置（只允許 clade 管理的 artifact ignore 條目）。

## 為什麼這條 rule 存在

2026-06-01 一個 session 內連續撞到兩個實例：clade working tree 反覆冒出別 session 未 commit 的 fix / pitfall / script 改動（在 session 進行中流動消失）；某 worktree 有 9 檔 demo WIP（完成度不明）+ 一個危險的跨 change 目錄誤刪（若 commit 會破壞另一個 active change）。全靠手動考古（git status → 半成品掃描 → fmt/lint → git log 脈絡 → 危險項 restore）才釐清。本 rule 把該流程固化，避免每次重新發明 + 防止盲目 commit 半成品 / 跨 change 污染。
