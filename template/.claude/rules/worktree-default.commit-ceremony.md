---
description: Worktree v3 commit 階段 — subagent commit → archive 吸收 → merge-back ceremony → 操作工具（worktree-default §5/§5.5/§6 detail）
paths:
  - 'openspec/changes/**'
  - 'HANDOFF.md'
  - 'vendor/scripts/wt-helper.ts'
  - 'vendor/scripts/stash-reconcile.ts'
  - 'scripts/wt-helper.ts'
  - 'scripts/stash-reconcile.ts'
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/worktree-default.commit-ceremony.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


> Path-scoped detail of [[worktree-default]] §5 / §5.5 / §6。核心 always-load 規約在母檔 worktree-default.md。


## §5 Commit 階段：checkpoint → 批次整合 → 單次 /commit → 回收

每一個實作 worktree 完成必要測試及行為驗收後，保存 scoped checkpoint，包含實作、進度與證據。Hooks 照跑，新檔逐檔 add，其餘使用 `git commit --only -- <paths>`。Worker 不 push、不各跑完整 `/commit`；正式審查由整批一次執行。Pi phase checkpoint 的命名與 phase 邊界仍依 [[agent-routing.pi-watch-protocol]]。

### 就緒與觸發契約

1. 主線收割 terminal outcome、驗 scope／必要驗收並確認寫入權已交接，再用 `wt-helper batch ready` 登記來源 HEAD、work id、證據及落地授權。只有已明確就緒且允許落地的 wt 進池，**NEVER** 從「git status 乾淨」推定已驗收。
2. 每次就緒、收割、停止開發或 session 接手，跑 `wt-helper batch status --trigger auto`。自動門檻為 4 個 distinct work id，同任務多個 wt 不重複計數；未達門檻繼續開發，不佔 commit lock。
3. 使用者要求 `/commit` 或 merge back → `manual`，**無最低件數**。下游必須先落地 → `dependency`；已授權開發都完成或受阻 → `drained`；使用者結束本輪 → `stop`。三者皆可提前結批。單純 session handoff 保留佇列。
4. 觸發後主線進 `/commit`，固定同 repo 當下所有已就緒且允許落地的成員，在隔離整合區合併。**NEVER** 要使用者代打已命中條件的 `/commit`。
5. 整批跑完整 simplify、review、checks 與適用人工 gate，依功能建立多筆正式 commit。批次開始後的新成員進下一批；未就緒任務不阻擋手動提交。
6. 正式落地 main 後由 commit skill 呼叫 batch cleanup，逐來源驗落地、HEAD 未變、無 WIP／活寫入者／保留契約才移除 wt／branch，隔離整合區最後回收。PR 制等 PR 合入 main。清理可獨立重試。

進入本流程時 **MUST** 讀 commit skill 的 `batch.md`，包含命令、證據格式、衝突續跑與落地順序。無就緒 wt／待續跑批次時，普通 `/commit` 照常處理當前工作區。

### OPSX 與 skill-owned worktree

Spectra archive gates 與 bookkeeping 在持有該 change 實作的 worktree 執行，完成後連同成果 checkpoint，再進就緒池。**NEVER** 在看不到實作的 main 跑 archive gates，也不在 archive Step 0 刪來源。人工檢查、spec sync、sidecar 與 evidence 義務保留。

Ad-hoc Form-1、`/dep-upgrade` 等 skill-owned wt 同樣在完成點登記就緒並評估批次條件。已授權的自動落地由主線執行；使用者明示保留的 wt 不納入自動回收。Worker 不因批次契約取得 push／publish／刪除來源的權限。

### 安全邊界

**Iron Law：正式品質流程未通過、成果未落地 main，來源就保留。違反字面就是違反精神。**

| 已發生的說法 | 可驗事實 |
| --- | --- |
| `absorbed into main` | 舊 merge-back 可能只寫 index；須有正式 commit 與落地證據才可清理 |
| 「兩條改的檔完全不重疊」 | 共享 index 仍有競態；同 repo 只有一批持有整合權 |

Red flag：正在把「checkpoint 已 commit」「squash exit 0」當成可刪來源的證據時，改查正式落地紀錄。衝突或 gate 失敗保留來源；main／source 前移、審後修改使舊證據失效，不使用 force-discard 解決。

## §5.5 Legacy merge-back 與 stash 救援

舊單棵 `wt-helper merge-back` 保留供 caller 遷移，**不在正式 commit 前清理來源**。新的主流程使用 batch；使用者的「merge back」意圖走 manual batch。已登記批次的來源不得用 legacy 路徑落地或刪除。

下列 guard 仍約束 legacy stash 路徑與存量救援，不作為 batch 的搬運機制。

### Claim guard scope ⊇ bulk-stash scope（hard rule）

`--auto-stash` 實際執行的是 **bulk-stash（`git stash push -u`，不帶 pathspec）**，捲走 main **全部** dirty —— 不只 `blockers`（= branch changeset ∩ main dirty）。因此 `--auto-stash` 在真正 bulk-stash **之前**，claim guard 的檢查範圍 **MUST ⊇ 將被 bulk-stash 捲走的全部 dirty**，**NEVER** 只查 `blockers` 子集。

- bulk-stash 前 **MUST** 對 main **全部** dirty（`detectMainDirty`）跑 claim 比對（`classifyDirtyPaths`，`excludeClaim` 為本 merge-back worktree 的 claim）；
- 差集（`allDirty \ blockers`）若含**別 session 認領**（`otherSession`）的 dirty → **fail-loud STOP / refuse auto-stash**（與既有 blocker-only / pre-fork guard 一致），列出 `<path> → <session-id>`，並**先跑 [[session-tasks]] § 並行爭用 的 Step 0 判出對方性質再決定動作**（前景 session → 主動 `SendMessage` 協調；unattended runner → 讓位、**NEVER** 等它「收斂」；人類 → 才是要 user 介入的那一種），**NEVER** 默默 bulk-stash 捲走別 session WIP、**NEVER** 在未判出對方性質前就把這題退回給 user；
- 差集為空 / 全屬本 change / 為**無主**（unclaimed）dirty → 維持既有正常 flow（`--auto-stash` 本就設計來吞無主 dirty，squash 落地後**自動 pop 回 main**，不留 stash tail；只有 pop 撞真衝突才走 `stash-reconcile`）。

⚠️ **guard 的輸入有兩個來源，宣告的那個實測恆空**：`classifyDirtyPaths` 先拿 dirty path 比對 `c.expected_paths`，claim 沒帶 paths 就**永遠比不中**（2026-08-03 <consumer-a> 實證：3 個 active claim 的 `expected_paths` 全空，88 條 unclaimed dirty 全數被 bulk-stash 捲走而 guard 零告警）。2026-08-26 起補上第二個來源：比不中且該路徑**在 main 沒有自己的寫入時證據**時，改問「有沒有哪個**還活著**的 worktree 寫過同名路徑」（[[session-claims]] § 3.3 的導出值）。因此 [[worktree-default]] §1 那條「main 累積 dirty 時寫 coarse claim **要帶 `--expected-paths`**」仍然要做——導出值只涵蓋 worktree 有實際寫入、且持有者仍活著的路徑，**NEVER** 讀成「現在不宣告也沒關係」。

**為什麼**：claim guard 原本只假設「危險 = branch 要 land 的改動撞到別 session 改同檔」，但 bulk-stash 的副作用是「為清出乾淨 working tree 做 squash，把**所有** dirty 移走」——範圍遠大於 branch changeset。不在 branch changeset 的別 session 認領檔不是 blocker，guard 從未檢查，bulk-stash 照捲（2026-05-29 <consumer-b>：vending merge-back `--auto-stash` 捲走別 session my-kpi 19 檔 WIP）。**正解是擴大 guard 檢查範圍，不是縮小 stash 範圍**（pathspec stash 會踩 git 2.50.1 scope leak，見 `pitfall-git-stash-pathspec-scope-leak`）。詳見 `pitfall-merge-back-autostash-bulk-captures-other-session-wip`。

### Stash 操作必 verify create

`git stash push -u -m <msg>` 對乾淨 working tree exit 0 + stdout `No local changes to save`，**不會丟 exception**、stash list 不會多 entry。任何 wt-helper / spectra script 跑 `git stash push` 都 **MUST** 在 push 前後比對 `git rev-parse --verify refs/stash` 確認 stash entry 真的建立；mismatch → 把 stashRef 設 null 並 warn，**禁止**仍宣稱 stashed。詳見 `pitfall-wt-helper-merge-back-silent-stash-miss`。未來新加 stash push 路徑（spectra-apply phase suffixes、clade-propagate、clade-publish 等）皆套同樣 contract。

### Stash reconcile（後續清理）

`node scripts/stash-reconcile.ts`（`--interactive` / `--json` / `--slug <slug>` / `--stale-days N` / `--include-all`）列每條 namespaced stash + 建議命令；merge-back 成功收尾會自動印帶 `--slug` 的 reconcile hint。**永遠不 auto-pop / auto-stage / auto-commit**：apply 後 user WIP 在 working tree，必須走 `/commit` 的 selective stage（**禁止** `git add -A`）。

**`drop` 不在上面那條禁令內**（它管的是 pop / stage / commit）：通過 [[commit]] § Stash 自動處置 gate
全部判準的 stash，agent **MUST** 主動 drop + 留痕，不留給 user —— 詳見該節與 `/handoff` Step 3.2a。
`--interactive` 仍是 user 想逐條自己看時的入口，但**不再是**清理 stash 的唯一路徑（實證顯示那條路徑
在 user 不看 stash 時等於沒有出口，stash 只會單調遞增）。

完整命令清單、Stash 命名空間表與失敗 fallback 表見 `~/offline/clade/vendor/snippets/worktree-baseline/merge-back-ceremony.md`。其中 `cleanup` 拒絕 uncommitted 時 **NEVER** 急加 `--force-discard-uncommitted` — 先 `wt-helper rescue --show <ref>` 看 patch、救完再 cleanup。

## §6 操作工具：`/wt`、`wt-helper.ts`、`stash-reconcile.ts`

常用 6 列：

| 動作 | 指令 | 說明 |
| --- | --- | --- |
| 開始 worktree task（推薦入口） | `/wt <task description>` | `/wt` orchestrate build + dispatch + report；不 squash 不 cleanup（v3） |
| 列出 session worktree | `node scripts/wt-helper.ts list` 或 `--json` | 看 pending worktrees |
| Atomic merge-back | `node scripts/wt-helper.ts merge-back <slug>` | 把 worktree atomic land 進 main（squash + cleanup） |
| Merge-back 預覽 | `node scripts/wt-helper.ts merge-back <slug> --dry-run` | 列 blockers 不執行 |
| List pre-fork baseline 救援候選 | `node scripts/wt-helper.ts rescue` | 列 `refs/wt-baseline/*` pinned ref + fsck dangling stash；`--show <ref\|sha>` 看 patch（read-only） |
| Stash reconcile 互動 | `node scripts/stash-reconcile.ts --interactive` | 一條一條 apply / drop / view（never auto-pop） |

完整工具表（含 `cleanup --force`（**丟工作**，必先 merge-back + rescue 撈 baseline）、`land-pending`、`prune`、reconcile 各模式、`handoff-drift-scan.ts`）見 `~/offline/clade/vendor/snippets/wt-helper/README.md` § 工具速查表。

`/wt` skill source：`~/offline/clade/plugins/hub-core/skills/wt/SKILL.md`；`wt-helper.ts` / `stash-reconcile.ts` / `handoff-drift-scan.ts` source：`~/offline/clade/vendor/scripts/`（散播投影到 consumer 的 `scripts/`）。
