---
description: GitHub Flow 事件責任與成本邊界 — checkpoint、review、合併、回收、發版分成不同事件
paths:
  - 'vendor/scripts/wt-batch.ts'
  - 'capabilities/core/skills/commit/**'
  - 'capabilities/core/skills/wt/**'
  - 'capabilities/core/skills/handoff/**'
  - 'capabilities/core/skills/gh-ci-watch/**'
  - '.github/workflows/**'
  - 'HANDOFF.md'
  - 'tasks/**'
---
<!-- Clade native rule; source: rules/core/github-flow.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->

# GitHub Flow 事件契約

本檔是 Claude Code／Cursor／Codex／Pi 共用的平行切片作業契約。盤點 outstanding → 獨立切片各派一個 owner → **一刀一 branch 一 PR** → 盯該 PR 的 CI → 紅燈回原 owner。**預設開發模式是 § Integration branch（小步快跑）**：feature branch 開 PR 併入 `integration/<work-id>`，只付機械檢查；完整 test-lane 只在 `integration/<work-id>` → `main` 那一張 PR 上付一次。只有一個切片就完工的工作才直接對 `main` 開 PR。操作命令見 commit skill `batch.md`、[[worktree-default]] §5、[[gh-ci-watch]]。

## 事件與成本

| 事件 | 入口 | 必要成本 | 禁止綁上的成本 |
| --- | --- | --- | --- |
| 實作 checkpoint | `batch checkpoint` | 保存自己的 scope、必要基本檢查、作者與來源 | 完整 AI review、收割全 repo WIP、全域 handoff、發版 |
| 切片可見性 draft | slice owner `git push` + `gh pr create --draft` | 相對 base（`main`；integration 模式見 § Integration branch）非空 committed diff、該 session branch、機械檢查（lint／fmt／typecheck／doctor）的 CI watch——**draft 期間不跑 test-lane** | 把未完成範圍當已 ready、啟動完整品質鏈、merge、直推 `main` |
| 討論 draft（可選） | 同上，另記 `batch draft` | 可見性 draft 的條件，加上具名討論者與會改變剩餘實作的具體問題 | 把討論當 ready |
| PR ready | `batch ready` + 完整品質鏈 | 獨立可接受的完整 diff、風險分級、適用 review／測試／人工 gate | 等待湊滿四件、重跑未受影響的完整 ceremony |
| 合併 | coordinator 在 C 節 predicate 全成立時 squash + `batch confirm-merged`／`batch merge-unattended`，或依 § Coordinator 直接合併 以 `gh pr merge --match-head-commit` 合併。**不需要 Charles 逐張授權** | 最新 candidate、必要 CI／衝突／人工 gate 當下成立；`merge-unattended` 的 `--authorization` 是綁定快照（head／base／tree／seal／CI，加上該 work 的落地授權證據與 human gate 紀錄），不是 Charles 對該 PR 的逐張點頭 | 用過期綠燈或未合併的 closed PR 當落地；slice **worker NEVER merge** |
| 回收 | `batch cleanup` | 已合併、HEAD 未變、無未保存工作／活寫入者／保留契約 | 把 checkpoint、draft 或 PR 開啟當可刪來源 |
| 發版 | `/commit` Step 6 | 獨立授權與獨立證據 | 由 checkpoint、draft、PR ready 或 merge 自動觸發 |

同一獨立可接受目的對應一個**進 `main` 的** PR。緊密相依工作可明確合批；不要為湊數拆碎單一需求。`pr-merge-based` 的 auto 門檻是 1 件；`trunk-based` 仍是 4 件。

**上限數的是進 `main` 的 PR，不是切片。** 預設最多 3 張 base 為 `main` 的 active implementation；ready backlog 達 3 張時優先交付。一條 `integration/<work-id>` 連同它底下**每一個**切片合計只算 1 張。

## Integration branch（預設開發模式：小步快跑）

| 可觀察 predicate | 走哪條 |
| --- | --- |
| 這件工作**一個 PR 就完工**（只有一個切片） | 上面的「一刀一 branch 一 draft PR」，base 是 `main`；它轉 ready 那一刻就是「進 `main` 的最後一趟」，付 full |
| 其他（2 個以上切片，平行或循序皆然） | 本節（預設） |

不要把同一件工作的多個小步各自對 `main` 開 PR——每張 ready 的 main PR 都付一次六 shard full lane，而且與其他 main PR 搶同一組 6 個 slot（2026-09-22 實測：PR 從觸發到最後一個 shard 開跑的等待 p90 41.7 分，執行本身 5.3 分——慢的是佇列，不是測試）。兩步以上就開 integration。

### 三層，各付各的成本

| 層 | 事件 | 門檻 | test-lane |
| --- | --- | --- | --- |
| 切片 → `integration/<work-id>` | slice owner 開 PR（`--base integration/<work-id>`），完成後轉 ready；coordinator 以 `node scripts/integration-merge.ts --integration <worktree> --slice <branch> --pr <n>` 由 GitHub squash 落地，一個切片一個 commit | 來源 worktree 內跑 canonical check ＋ repo 在 CI 機械檢查裡跑的 typecheck（clade：`pnpm exec vp check` ＋ `node node_modules/typescript-native/bin/tsc -p tsconfig.clade.json --noEmit`，動到 `vendor/scripts` 再加 `node node_modules/typescript-native/bin/tsc -p tsconfig.vendor.json --noEmit`）；該 PR 的 CI 機械檢查全綠（工具會驗） | 不跑 |
| `integration/<work-id>` 每次 push | 每個切片 PR 落地就是一次 push；同 ref 的舊 run 由 workflow `concurrency` 取消。它那張對 `main` 的 PR 此時是 draft，不跑 test-lane | 無——非阻塞的滾動訊號 | 單一 job 的 `affected`（base＝這條 branch 上一次綠燈的 push——被 `concurrency` 取消的那幾趟因此一併涵蓋）；紅燈的嫌疑範圍＝上一次綠燈之後併入的切片 |
| `integration/<work-id>` → `main` | 同一張 PR 轉 ready，走 `batch ready`／seal／`confirm-merged` | 轉 ready **之前** coordinator 在 integration worktree 跑一次 `test:affected`（base＝`origin/main`，經 heavy gate slot），綠了才 `gh pr ready`；之後是完整品質鏈 | **full lane 六 shard**，在這張 PR 上跑；整件工作只付這一次 |

### MUST

1. coordinator 從最新 `origin/main` 開 `integration/<work-id>` 並**立刻 push 上 origin**（切片 PR 要有 base；`wt-helper add --base integration/<work-id>` 開後續切片；第一棵 integration 仍從 landing base 分叉），**第一個切片併入後立刻**對 `main` 開 draft PR 並登記 `batch draft --kind visibility`。這一張就是整件工作的可見性；commit 列表就是切片清單。
2. **每一個**切片併入之前，coordinator 都要先把 integration 同步到最新 `origin/main`（每次併入的前置，不是收尾動作）。
3. **每一個**切片開工前都要宣告路徑（claim 的 `expected_paths`），且與**每一個**其他活切片的宣告路徑不相交。相交就序列化，或併成同一個切片。
4. 切片層跑 canonical check ＋ repo 在 CI 機械檢查裡跑的 typecheck，不要在每個切片各跑一次 `test:affected`／測試（N 個切片就是 N 次排 heavy gate slot）。`test:affected` 只在 integration 轉 ready 前跑一次。2026-09-21 實測兩個切片的 `test:affected` 在 heavy gate slot 各排了二十分鐘以上還沒輪到，是切片層最慢的一環，而 canonical check 只要 3 秒；Charles 當日拍板切片只付 canonical check。保護沒有少：紅了用切片 commit 列表二分，進 `main` 仍有完整 test-lane。typecheck 不能省成只跑 `vp check`：它的 typecheck 範圍不等於 CI `validate-manifests` 跑的 `tsconfig.clade.json`（2026-09-21 `scripts/main-sync.ts` 的 TS2534 通過 `vp check`、進了 main 才紅，之後每張 ready 的 PR 都帶這個紅，直到另開一張 PR 修掉）。
5. 滾動訊號紅燈：coordinator 以上一次綠燈之後併入的切片為嫌疑範圍，紅因歸到切片就 `git revert` 該切片的 commit、把它退回 owner；不要讓整條 integration 等一個切片修好。
6. 切片 owner 對 `integration/<work-id>` 開 PR（做到一半先開 draft，完成後自己 `gh pr ready` 該切片 PR），不對 `main` 開 PR，也不自己 merge。落地一律由 coordinator 跑 `integration-merge.ts --pr <n>`（它驗 PR 狀態、機械檢查全綠、同步與路徑不相交）；不要在 GitHub 網頁或 `gh pr merge` 直接按掉切片 PR。切片 PR 不登記 `batch draft` receipt。

### 工具現況

`wt-helper add --base integration/<work-id>` 從 integration 分支分叉（不帶 `--base` 從 landing base 分叉）。`integration-merge.ts` 不帶 `--pr` 是本機 `git merge --squash`，只留給沒有 PR 的舊切片。`wt-batch.ts` 的 `MAX_ACTIVE_IMPLEMENTATIONS` 排除 `phase=landed` 殘骸，同一 `workId` 的切片只算 1。

## 各事件的 test-lane

SoT 是 `.github/workflows/validate.yml` 的 `lane-plan` job（consumer 以自家 workflow 對應）；本表是它的人讀版。

| 事件 | test-lane |
| --- | --- |
| PR，base＝`main`、非 draft | full lane 六 shard（`integration/<work-id>` → `main` 的最後一趟，或單切片工作的那張 PR） |
| PR，base＝`integration/**`，或任何 draft | 不跑（只付 vp-check／doctor／validate-manifests） |
| PR 或 push，變更全在登記簿 allowlist（`HANDOFF.md`、`ROADMAP.md`、`docs/`、`tasks/`、`specs/plans/`、`vendor/ledger/`；改名的舊路徑也算，程式碼搬進 `docs/` 不算只動登記簿） | 不跑——登記簿同步是 push 的大宗，每筆各燒一次六 shard full 買不到任何訊號 |
| push 到 `main` 或 `integration/**` | 單一 job 的 `affected`，base＝該 branch 上一次綠燈的 push（它不是 HEAD 的祖先才退回 push 之前的 SHA；新建 branch 用 `origin/main`）。full 已在進 `main` 的 PR 上付過，這一趟只驗上次綠燈之後落地的那幾步 |
| nightly | full lane 六 shard；`main` 自上一趟綠燈 nightly 後沒動就跳過 |

不要為了讓某張切片 PR 或 draft「也看得到綠燈」放寬本表——要測試訊號就在來源 worktree 跑 `test:affected`。

### Ready 之後的 push 紀律

**ready 的 main PR 上，每一次 push 都是一趟六 shard full。** 被 `concurrency` 取消的 run 已跑掉的 shard 分鐘不會退回。

| 可觀察 predicate | MUST |
| --- | --- |
| ready 的 main PR CI 紅了 | 先照 [[commit]] `batch.md` § CI 紅燈處置 跑 `ci-triage`；修正在來源 worktree 跑 `test:affected`（base＝`origin/main`）綠了才 push，**一次 push 帶齊**這一輪的所有修正 |
| 預期要修不只一輪，或要邊修邊看 CI | `gh pr ready --undo` 退回 draft（停止付 full），修完再 ready |
| 只是 `main` 往前走了、PR 沒有衝突 | 不要為了「跟上 main」push 到 ready PR；squash 落地時 GitHub 會合在最新的 `main` 上，落地後的 push `affected` 驗那一步 |

ready PR 上的 CI 不是試錯環境（「push 上去讓 CI 跑一下看看」）。

## Draft 不是 ready

**Draft 不是 ready。** 切片 draft 付的是**可見性與機械檢查**，不是「獨立可接受的完整 diff」，也不是 test-lane——test-lane 只在 base 為 `main` 的 PR **轉 ready 的那一刻起**才跑（workflow 的 `ready_for_review`）。PR ready／merge 仍在實作與完整品質鏈之後。draft 期間要測試訊號就在來源 worktree 跑 `test:affected`；不要為了看 CI 綠燈提前 `gh pr ready`。

### 切片可見性 draft（預設；slice owner 自己開）

獨立切片在來源 worktree 相對 `main` 已有非空 committed diff 後，**slice owner**（cloud implementer、`/wt` worker、desk worktree 執行者）要：

1. 來源 `git status` 乾淨（相對於要推的 commits）。
2. `gh pr view <session-branch> --json number,isDraft,headRefName`（branch 是位置參數；查無 PR 時非 0 退出）：已有 PR 就沿用該號，不要再開一張。
3. 沒有遠端物件時**只** `git push -u origin <session-branch>`。不得 `git push origin main`——slice owner、worker、coordinator 皆同；唯一具名例外見 § 遠端強制與本機契約 的「登記簿同步」。
4. 沒有 PR 時 `gh pr create --draft --base main --head <session-branch>`。（integration 模式下的切片 base 是 `integration/<work-id>`、不登記 receipt、由 coordinator 以 `--pr` 落地，見 § Integration branch MUST 6。）
5. `gh pr view <session-branch> --json number,isDraft,headRefName`：`isDraft` 為 true、head 就是該 session branch。不要省略 branch。
6. 立刻盯**該 PR head SHA** 的 CI（Claude／Codex：`/gh-ci-watch`；Cursor：`subscribe_github_ci`／`subscribe_github_pr` 或同等）。
7. CI 紅燈：同一 owner、同一張 PR 上修再 push；不要為同一切片開第二張 PR。
8. 用該 PR 號跑 `batch draft --kind visibility` 把可見性 receipt 持久登記。create／push 失敗就不要寫 receipt。討論 draft 才用 `--kind discussion`（或舊的 `--discussant`＋`--question`）。

Draft 維持 draft 直到 review。slice **worker NEVER merge**、**NEVER** `gh pr ready`、**NEVER** 為了看得見而 merge-back。空 branch／只有 WIP **NEVER** 開 PR。具名 coordinator 在 [[commit]] 批次 `merge-unattended` 的機械 predicate 全成立，或下方 § Coordinator 直接合併 的條件全成立，且沒有有效 do-not-merge hold 時 squash；那不是 worker 權限，也不是把所有 agent 當 coordinator。

原生派工載體不同、結果相同：Cursor Project 用 `CreateAgent`；Claude 用 `/wt` 或 Herdr fanout；Codex 使用 native subagent 協作並由原上游完成交付，不建立另一個 Codex successor pane。不要把 Cursor 主線的 `/handoff relay|fanout` 讀成這條契約的必要入口。

### 討論 draft（可選、較嚴）

已有可討論的獨立 diff，且具名討論者須回答會改變剩餘實作的具體問題時，可在實作完成前開 draft。除上方可見性條件外，body 要寫具名討論者與那條問題。`batch draft --kind discussion`（或舊命令）缺任一欄就拒絕；不要假裝已進入討論事件。可見性事件必須明示 `--kind visibility`。

### Draft → ready：同一張 PR

同一獨立可接受目的對應**一**個 PR 號。Draft 掛來源 session branch；正式 commits 在隔離 integration。seal 之後 coordinator 要把**受審 formal HEAD** 交到**既有** PR 的 head ref，然後才 `gh pr ready`／ship。

`prepare` 要把每個成員的 draft PR 號與 head branch 寫入 batch journal，`confirm-merged` 要比對 journal 與遠端 PR（不重讀 `drafts/` 側檔；只有沒有綁定欄位的舊批次例外改用側檔，不符同樣 fail closed）。`batch draft` 要拒絕已屬於 active batch 的 workId；讀 draft receipt 時要驗 workId 完全相等，碰撞時 fail closed。

- 既有 head 能快轉到 formal HEAD → 快轉 push。
- 不能快轉（integration squash 產生新 commit）→ 先 `git ls-remote origin refs/heads/<既有 PR 的 head branch>` 取得遠端 SHA，確認它等於 `gh pr view <PR 號> --json headRefOid` 與 draft receipt 記的 head，再只准 `git push --force-with-lease=refs/heads/<既有 PR 的 head branch>:<剛驗證的遠端 SHA> origin <reviewed-formal-head>:refs/heads/<既有 PR 的 head branch>`。不要用不帶 expected SHA 的 `--force-with-lease`——它比對的是本機 remote-tracking ref，中途一次 fetch 就讓 lease 失效。這是本節具名轉換，不是通用 `--force`。
- `--force-with-lease` 失敗、遠端 HEAD 已變、或 PR 號對不上 workId → **停**。不要開第二張 PR，也不要把關閉 draft 當成 landed。

`batch ready` 與完整品質鏈仍在轉換**之前**；轉換成功只是讓同一張 PR 指向受審 HEAD，不跳過 seal／confirm-merged。

不要在 `wt-helper add` 或第一個 commit 之前開 PR。不要把 draft、checkpoint 或未合併 PR 當成可刪來源或已落地。不要把 `git commit --no-verify` 或 `HUSKY=0` 寫成 fleet 預設。

### Coordinator 直接合併（不需要逐張授權）

合併**不需要** Charles 逐張授權（Charles 2026-09-24：「我覺得可以不需要授權了」）。coordinator（主線）在下表條件全成立時可直接 squash，不必經 `batch merge-unattended`；條件任一不成立就停，回報缺口。授權從來不是這裡的保護——保護是下表的機械證據。

| 條件 | MUST |
| --- | --- |
| 身分 | coordinator（主線）。slice **worker** 仍不得 merge，本節不改 worker 權限 |
| 品質證據 | 該 head 的 `/commit` gates 已有實際證據（0-A receipt 的 requested／observed 合格、0-C 結論行、其他已觸發 gate）。缺任一格就停，回報缺口 |
| CI | 該 head SHA 的 required checks 全綠；draft 期間 skipped 的 test-lane 在 `gh pr ready` 後必須補跑轉綠才合 |
| 人工 gate | 該 PR 沒有待 Charles 處理的 human gate 或 leftover（`merge-unattended` 授權 JSON 的 `human.status=blocked-charles` 或 `leftovers` 非空的同型狀態），也沒有有效的 do-not-merge hold。沒有 batch 時查：該 work id 在 `flow pending`／`/decisions` 有沒有未答的 ask、PR 上有沒有 do-not-merge 標記或留言、該 repo `HANDOFF.md` 有沒有把這件標成等 Charles。有就停，那是「Charles 還沒看的東西」，不是授權問題 |
| 落地授權 | 該 work item 的落地授權（`batch ready --authorize-landing` 所依據的工作授權）仍有效、未被撤回；已撤回就停。沒有 batch 時查：`flow status <work id>` 不是 `dropped`／`parked`，以及該 work 的授權載體（plan.md 或派工 brief 的授權段）沒有被改寫成停止或撤回。合併不需逐張授權，**不等於**撤回過的工作也能合 |
| 部署 | 合併前跑 `deploy-trigger-check.ts`；合併會觸發 production（`derived=push-main` 或 `pr-merge`）或 `status` 不是 `confirmed` 時停，另問**發版**授權——發版仍是獨立授權（上方事件表「發版」列），本節只解除合併的授權 |
| head 釘住 | 仍是 draft 就先 `gh pr ready <N>` 並等 CI 補跑轉綠，再以 `gh pr merge <N> --squash --match-head-commit <已審 head SHA>` 合併；head 在審查後前移就停，先重驗受影響範圍（§ 證據綁定） |
| 批次 | 該 PR 屬 active batch 時合併前確認 `origin/main` 仍是 seal 的 `reviewed_base`（不是就先 reseal），合併後 MUST 走 `batch confirm-merged`（receipt 規格見 [[commit]] `batch.md`）；沒有 batch 時完成報告 MUST 寫齊 § 證據綁定 的 receipt 欄位（repository、PR、reviewed head／base、candidate tree、merge SHA、squash 方法，以及 candidate tree 對 merge tree 的比對與 stable patch-id）；缺任一欄不算落地，**NEVER** 只記 PR 號與 merge SHA |
| 合併後 | 本機 `main` 以該 repo 的同步方式對齊：一般 repo `git merge --ff-only origin/main`；本機 main 承載登記簿、與 origin 依設計分岔的 repo（clade home）走其同步工具（`node scripts/main-sync.ts --apply`，見下方 § 遠端強制與本機契約 的登記簿同步段）。**NEVER** rebase、不碰 main 上他人 WIP；盯該 merge SHA 的 staging；來源 worktree 走 `wt-helper cleanup`／`batch cleanup` |

逐字禁令：**NEVER** 為了符合本節而把 draft 轉 ready 卻不補跑 CI；**NEVER** 用 `--admin` 或關閉 required check 過關；**NEVER** 把「合併不需授權」讀成「發版不需授權」；**NEVER** 為了等授權而把已滿足本節條件的 PR 丟回 Charles 或開 flow ask。

## 證據綁定

Review 證據綁定受測 `head`、`base` 與 candidate tree。來源 HEAD 前移、base 過期或 candidate 變更使舊證據失效，必須重驗受影響範圍。PR A 合入後 PR B 的 base 過期時，B 驗證新的整合候選，不沿用舊 base 綠燈。

合併 receipt 必須綁定 repository、PR、reviewed head／base、candidate tree、merge SHA、squash 方法與內容證據（candidate tree 對 merge tree，加上 stable patch-id）。PR 關閉但未合併不算落地。

## 遠端強制與本機契約

Required checks 必須綁定實際受測 revision。workflow 路徑條件或 skipped check 不得讓必要檢查永遠不回報。

private repo **不上** GitHub rulesets、branch protection、merge queue：不為此升 GitHub Pro，也不為此改公開。本機唯一 landing owner、squash-only merge method，以及 `batch confirm-merged` receipt，就是強制契約。不要把缺遠端保護列成剩餘工作或能力缺口，也不要宣稱遠端 required checks 已強制。公開 repo 若之後要開遠端強制，另行決定。

**登記簿同步（唯一直推 `main`、唯一非 squash 的具名例外）。** PR 制 repo 的共享本機 `main` 若承載必須當下可見的登記簿類檔案（handoff、tech-debt、tasks、plan 結案），要由**一支工具**負責同步：內容差**每一個**路徑都在該 repo 宣告的 allowlist 內才放行，以 merge commit 收斂、不碰 working tree、push 前驗遠端未移動。allowlist 不得含規約、skill、script、CI、truth 或任何會被散播／執行的路徑；不要手動 `git push origin main` 代替該工具，也不要擴 allowlist 來放行一筆本來該走 PR 的 commit。clade home 的實作是 `scripts/main-sync.ts`，判準在其 `.claude/rules/local/clade-home-worktree.md` § 本機 main 與 origin 的同步；沒有這類共享登記簿的 repo 不適用本段。

## 合併後分支回收

`registry/consumers.json` 的**每一個** `repo_id` 都要開 GitHub「Automatically delete head branches」（`delete_branch_on_merge=true`），不限 `pr-merge-based`（squash 後 `--merged` 判不出已落地）。它**只**回收遠端 head branch，本機仍走 `batch cleanup`／`wt-helper cleanup`。

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | `node scripts/audit-repo-merge-settings.ts` exit 1（有 repo 沒開，印 `gh repo edit <repo> --delete-branch-on-merge`）；exit 2 是讀不到設定，不要讀成已開。warn-only，不接 publish gate |
| 消費端 | `scripts/bootstrap-project.ts` 的 `repo-merge-settings` step（新 consumer onboarding）；`/clade-health full` 掃存量 |
| 載入路徑 | 本節（consumer 端投影為 `.claude/rules/github-flow.md`）；開設定的操作在 `project-bootstrap` skill § 4 |

驗證 CI 的綠燈是**最新 candidate 那條 run**。同 ref 被更新的 SHA 取代後，過期 run 必須由 workflow `concurrency` 取消，不得繼續佔 self-hosted runner 讓 HEAD 排隊。寫法與 deploy/gate 例外見 [[ci-workflow]] § CI / test workflow MUST cancel superseded runs on the same ref。

## 失敗路徑

CI 失敗、衝突、必要人工審查未完成、內容與 reviewed candidate 不符、來源 HEAD 在合併後前移：來源與未完成工作保留。清理中斷只重試 cleanup，不重複合併。未授權發版不得因 checkpoint、draft、PR ready 或 merge 發生。
