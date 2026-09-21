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

本檔是 Claude Code／Cursor／Codex／Pi 共用的平行切片作業契約。盤點 outstanding → 獨立切片各派一個 owner → **一刀一 branch 一 draft PR** → 盯該 PR 的 CI → 紅燈回原 owner。一件大型工作拆成多個平行切片時改走 § Integration branch：切片併入 `integration/<work-id>` 只付機械檢查，完整驗證只在進 `main` 的那一張 PR 上付。操作命令見 commit skill `batch.md`、[[worktree-default]] §5、[[gh-ci-watch]]。

## 事件與成本

| 事件 | 入口 | 必要成本 | 禁止綁上的成本 |
| --- | --- | --- | --- |
| 實作 checkpoint | `batch checkpoint` | 保存自己的 scope、必要基本檢查、作者與來源 | 完整 AI review、收割全 repo WIP、全域 handoff、發版 |
| 切片可見性 draft | slice owner `git push` + `gh pr create --draft` | 相對 base（`main`；integration 模式見 § Integration branch）非空 committed diff、該 session branch、機械檢查（lint／fmt／typecheck／doctor）的 CI watch——**draft 期間不跑 test-lane** | 把未完成範圍當已 ready、啟動完整品質鏈、merge、直推 `main` |
| 討論 draft（可選） | 同上，另記 `batch draft` | 可見性 draft 的條件，加上具名討論者與會改變剩餘實作的具體問題 | 把討論當 ready |
| PR ready | `batch ready` + 完整品質鏈 | 獨立可接受的完整 diff、風險分級、適用 review／測試／人工 gate | 等待湊滿四件、重跑未受影響的完整 ceremony |
| 合併 | 具名 coordinator 在 C 節 predicate 全成立時 squash + `batch confirm-merged`／`batch merge-unattended` | 最新 candidate、必要 CI／衝突／人工 gate 當下成立；unattended 另需授權 JSON | 用過期綠燈或未合併的 closed PR 當落地；slice **worker NEVER merge** |
| 回收 | `batch cleanup` | 已合併、HEAD 未變、無未保存工作／活寫入者／保留契約 | 把 checkpoint、draft 或 PR 開啟當可刪來源 |
| 發版 | `/commit` Step 6 | 獨立授權與獨立證據 | 由 checkpoint、draft、PR ready 或 merge 自動觸發 |

同一獨立可接受目的對應一個**進 `main` 的** PR。緊密相依工作可明確合批；**NEVER** 為湊數拆碎單一需求。`pr-merge-based` 的 auto 門檻是 1 件；`trunk-based` 仍是 4 件。

**上限數的是進 `main` 的 PR，不是切片。** 預設最多 3 張 base 為 `main` 的 active implementation；ready backlog 達 3 張時優先交付。一條 `integration/<work-id>` 連同它底下**每一個**切片合計只算 1 張——吃 test-lane 佇列與人工 seal 的是進 `main` 的那一張，切片兩樣都不吃。切片的准入另有判準，見 § Integration branch。

## Integration branch（一件大型工作拆成多個平行切片）

目的是讓一件大型工作以最短時間平行完工：切片併入的路上不排 CI 佇列，完整驗證整件工作只付一次，而且付的時候嫌疑範圍很小。

| 可觀察 predicate | 走哪條 |
| --- | --- |
| 切片自己就是獨立可接受目的（單獨進 `main` 有意義） | 上面的「一刀一 branch 一 draft PR」，base 是 `main` |
| 同一個 work id 的 `tasks.md` 拆出 2 個以上可平行的 task | 本節 |

### 三層，各付各的成本

| 層 | 事件 | 門檻 | test-lane |
| --- | --- | --- | --- |
| 切片 → `integration/<work-id>` | coordinator 在 integration worktree `git merge --squash <slice-branch>`，一個切片一個 commit，message 帶 task 編號 | 來源 worktree 內跑 canonical check ＋ repo 在 CI 機械檢查裡跑的 typecheck（clade：`pnpm exec vp check` ＋ `npx tsc -p tsconfig.clade.json --noEmit`，動到 `vendor/scripts` 再加 `npx tsc -p tsconfig.vendor.json --noEmit`）。兩條 tsc 以秒計、本機跑、不佔 CI runner、不必排 heavy gate slot | 不跑 |
| `integration/<work-id>` 每次 push | workflow 對 `integration/**` 的 push trigger；同 ref 的舊 run 由 workflow `concurrency` 取消。它那張對 `main` 的 PR 此時是 draft，不跑 test-lane，所以同一個 SHA 不會付兩次 | 無——非阻塞的滾動訊號 | fast lane；紅燈的嫌疑範圍＝上一次綠燈之後併入的切片 |
| `integration/<work-id>` → `main` | 同一張 PR 轉 ready，走 `batch ready`／seal／`confirm-merged` | 轉 ready **之前** coordinator 在 integration worktree 跑一次 `test:affected`（base＝`origin/main`，經 heavy gate slot），綠了才 `gh pr ready`；之後是完整品質鏈 | 這張 PR 上跑；整件工作只付這一次 |

### MUST

1. coordinator 從最新 `origin/main` 開 `integration/<work-id>`（`wt-helper add --base integration/<work-id>` 開後續切片；第一棵 integration 仍從 landing base 分叉），**第一個切片併入後立刻**對 `main` 開 draft PR 並登記 `batch draft --kind visibility`。這一張就是整件工作的可見性；commit 列表就是切片清單。
2. **每一個**切片併入之前，coordinator MUST 先把 integration 同步到最新 `origin/main`。integration 活得越久、離 `main` 越遠，最後那一輪越難綠——這一步不是收尾動作，是每次併入的前置。
3. **每一個**切片開工前 MUST 宣告路徑（claim 的 `expected_paths`），且與**每一個**其他活切片的宣告路徑不相交。相交就序列化，或併成同一個切片。
4. 切片層跑 canonical check ＋ repo 在 CI 機械檢查裡跑的 typecheck，**NEVER** 在每個切片各跑一次 `test:affected`／測試——它要排 heavy gate slot，N 個切片就是 N 次排隊，瓶頸只是從 runner 搬到本機。`test:affected` 仍只在 integration 轉 ready 前跑一次（經 `clade-gate`），加上進 `main` 那一趟 test-lane。
5. 滾動訊號紅燈：coordinator 以上一次綠燈之後併入的切片為嫌疑範圍，紅因歸到切片就 `git revert` 該切片的 commit、把它退回 owner；**NEVER** 讓整條 integration 等一個切片修好。
6. 切片 owner **NEVER** 對 `main` 開 PR、**NEVER** 自己併入 integration。具名討論才另開 draft，base 是 `integration/<work-id>`（CI 只跑機械檢查）。

| 藉口（2026-09-21 設計對話逐字） | 現實 |
| --- | --- |
| 「切片也各跑一次 `test:affected` 比較保險，它在本機以秒計，省它不會更快」（本檔 2026-09-21 初版的條文） | 實測相反：同日兩個切片的 `test:affected` 在 heavy gate slot 各排了二十分鐘以上還沒輪到，是切片層最慢的一環；而 canonical check 只要 3 秒。Charles 當日拍板切片只付 canonical check。保護沒有少：`test:affected` 改在 integration 轉 ready 前跑一次，紅了用切片 commit 列表二分；進 `main` 仍有完整 test-lane |
| 「切片只跑 vp check 就夠，它已經含 typecheck」 | `vp check` 的 typecheck 範圍不等於 CI `validate-manifests` 跑的 `tsconfig.clade.json`。2026-09-21 `scripts/main-sync.ts` 的 TS2534 通過 `vp check`、進了 main 才紅，之後每張 ready 的 PR 都帶這個紅，直到另開一張 PR 修掉 |

### 工具現況

`wt-helper add --base integration/<work-id>` 從指定的 integration 分支分叉（只接受 `integration/…` 或 `origin/integration/…`）。不帶 `--base` 時仍從 landing base 分叉。切片併入 integration 用 `node scripts/integration-merge.ts --integration <worktree> --slice <branch>`（先 sync `origin/main`、跑 canonical check、驗路徑不相交，再 `git merge --squash`）。`wt-batch.ts` 的 `MAX_ACTIVE_IMPLEMENTATIONS` 計數排除 `phase=landed` 未清理殘骸，同一 `workId` 的切片只算 1。

## Draft 不是 ready

**Iron Law：Draft 不是 ready。違反字面就是違反精神。** 切片 draft 付的是**可見性與機械檢查**，不是「獨立可接受的完整 diff」，也不是 test-lane——test-lane 只在 base 為 `main` 的 PR **轉 ready 的那一刻起**才跑（workflow 的 `ready_for_review`）。PR ready／merge 仍在實作與完整品質鏈之後。draft 期間要測試訊號就在來源 worktree 跑 `test:affected`；**NEVER** 為了看 CI 綠燈提前 `gh pr ready`。

### 切片可見性 draft（預設；slice owner 自己開）

獨立切片在來源 worktree 相對 `main` 已有非空 committed diff 後，**slice owner**（cloud implementer、`/wt` worker、desk worktree 執行者）MUST：

1. 來源 `git status` 乾淨（相對於要推的 commits）。
2. `gh pr view <session-branch> --json number,isDraft,headRefName`（branch 是位置參數；查無 PR 時非 0 退出）：已有 PR 就沿用該號，**NEVER** 再開一張。
3. 沒有遠端物件時 **只** `git push -u origin <session-branch>`。**NEVER** `git push origin main`——slice owner、worker、coordinator 皆同；唯一具名例外見 § 遠端強制與本機契約 的「登記簿同步」。
4. 沒有 PR 時 `gh pr create --draft --base main --head <session-branch>`。（integration 模式下的切片**不走本節**：它不開 PR，見 § Integration branch。）
5. `gh pr view <session-branch> --json number,isDraft,headRefName`：`isDraft` 為 true、head 就是該 session branch。**NEVER** 省略 branch。
6. 立刻盯**該 PR head SHA** 的 CI（Claude／Codex：`/gh-ci-watch`；Cursor：`subscribe_github_ci`／`subscribe_github_pr` 或同等）。
7. CI 紅燈：同一 owner、同一張 PR 上修再 push；**NEVER** 為同一切片開第二張 PR。
8. 用該 PR 號跑 `batch draft --kind visibility` 把可見性 receipt 持久登記。create／push 失敗就不要寫 receipt。討論 draft 才用 `--kind discussion`（或舊的 `--discussant`＋`--question`）。

Draft 維持 draft 直到 review。slice **worker NEVER merge**、**NEVER** `gh pr ready`、**NEVER** 為了看得見而 merge-back。空 branch／只有 WIP **NEVER** 開 PR。具名 coordinator 只在 [[commit]] 批次 `merge-unattended` 的機械 predicate 全成立、且沒有有效 do-not-merge hold 時才能 squash；那不是 worker 權限，也不是把所有 agent 當 coordinator。

原生派工載體不同、結果相同：Cursor Project 用 `CreateAgent`；Claude 用 `/wt` 或 Herdr fanout；Codex 使用 native subagent 協作並由原上游完成交付，不建立另一個 Codex successor pane。**NEVER** 把 Cursor 主線的 `/handoff relay|fanout` 讀成這條契約的必要入口。

### 討論 draft（可選、較嚴）

已有可討論的獨立 diff，且具名討論者須回答會改變剩餘實作的具體問題時，可在實作完成前開 draft。除上方可見性條件外，body MUST 寫具名討論者與那條問題。`batch draft --kind discussion`（或舊命令）缺任一欄就拒絕；不要假裝已進入討論事件。可見性事件必須明示 `--kind visibility`。

### Draft → ready：同一張 PR

同一獨立可接受目的對應**一**個 PR 號。Draft 掛來源 session branch；正式 commits 在隔離 integration。seal 之後 coordinator MUST 把**受審 formal HEAD** 交到**既有** PR 的 head ref，然後才 `gh pr ready`／ship。

`prepare` MUST 把每個成員當下的 draft PR 號與 head branch 寫入 batch journal；批次建立後，該 journal 是本批綁定的唯一依據，`confirm-merged` MUST 比對 journal 與遠端 PR，不得在合併確認時重讀 `drafts/` 側檔。唯一例外是綁定快照上線前 prepare 的舊批次（journal 沒有綁定欄位）：它可能已經合併，cancel 重來會移動 reviewed base、讓 receipt 永遠過不了，所以改以成員當下的 `drafts/` 側檔為綁定依據，側檔與 receipt 不符同樣 fail closed。`batch draft` MUST 拒絕已屬於 active batch（非 landed／cleaned／cancelled）的 workId，並指出 batch id。讀取 draft receipt 時 MUST 驗證 receipt 內的 workId 與查詢值完全相等；有損檔名正規化造成碰撞時 fail closed，保留 receipt 供復原，不得讓另一件工作繼承綁定。

- 既有 head 能快轉到 formal HEAD → 快轉 push。
- 不能快轉（integration squash 產生新 commit）→ 先 `git ls-remote origin refs/heads/<既有 PR 的 head branch>` 取得遠端 SHA，確認它等於 `gh pr view <PR 號> --json headRefOid` 與 draft receipt 記的 head，再只准 `git push --force-with-lease=refs/heads/<既有 PR 的 head branch>:<剛驗證的遠端 SHA> origin <reviewed-formal-head>:refs/heads/<既有 PR 的 head branch>`。**NEVER** 用不帶 expected SHA 的 `--force-with-lease`——它比對的是本機 remote-tracking ref，中途一次 fetch 就讓 lease 失效。這是本節具名轉換，不是通用 `--force`。
- `--force-with-lease` 失敗、遠端 HEAD 已變、或 PR 號對不上 workId → **停**。**NEVER** 開第二張 PR，**NEVER** 把關閉 draft 當成 landed。

`batch ready` 與完整品質鏈仍在轉換**之前**；轉換成功只是讓同一張 PR 指向受審 HEAD，不跳過 seal／confirm-merged。

| 藉口 | 現實 |
| --- | --- |
| 「PR 是落地／送審事件，所以做完才能開任何 PR」 | 切片 draft 付的是可見性與機械檢查，不是 ready |
| 「為了看得見先 merge-back / 直推 main」 | 可見性走 draft PR；[[worktree-default]] §5 禁止拿 landing 換可見性 |
| 「反正是 draft，先 ready 再說」 | draft **NEVER** 進 ready 池，也不啟動完整品質鏈；**worker NEVER merge**。具名 coordinator 的 unattended squash 仍要完整 `/commit` 品質鏈 + 最新 formal HEAD CI |
| 「CI 紅了另開一張 PR 比較乾淨」 | 同一切片同一張 PR，修回原 owner |

**NEVER** 在 `wt-helper add` 或第一個 commit 之前開 PR。**NEVER** 把 draft、checkpoint 或未合併 PR 當成可刪來源或已落地。**NEVER** 把 `git commit --no-verify` 或 `HUSKY=0` 寫成 fleet 預設。

## 證據綁定

Review 證據綁定受測 `head`、`base` 與 candidate tree。來源 HEAD 前移、base 過期或 candidate 變更使舊證據失效，必須重驗受影響範圍。PR A 合入後 PR B 的 base 過期時，B 驗證新的整合候選，不沿用舊 base 綠燈。

合併 receipt 必須綁定 repository、PR、reviewed head／base、candidate tree、merge SHA、squash 方法與內容證據（candidate tree 對 merge tree，加上 stable patch-id）。PR 關閉但未合併 **NEVER** 當成落地。

## 遠端強制與本機契約

Required checks 必須綁定實際受測 revision。workflow 路徑條件或 skipped check 不得讓必要檢查永遠不回報。

private repo **不上** GitHub rulesets、branch protection、merge queue：不為此升 GitHub Pro，也不為此改公開。本機唯一 landing owner、squash-only merge method，以及 `batch confirm-merged` receipt，就是強制契約。**NEVER** 把缺遠端保護列成剩餘工作或能力缺口。**NEVER** 宣稱遠端 required checks 已強制。公開 repo 若之後要開遠端強制，另行決定。

**登記簿同步（唯一直推 `main`、唯一非 squash 的具名例外）。** PR 制 repo 的共享本機 `main` 若承載必須當下可見的登記簿類檔案（handoff、tech-debt、tasks、plan 結案），那些 commit 沒有經 PR 上 origin 的路，而 squash 會讓本機與 origin 永久互不為祖先。這種 repo MUST 由**一支工具**負責同步：內容差**每一個**路徑都在該 repo 宣告的 allowlist 內才放行，以 merge commit 收斂、不碰 working tree、push 前驗遠端未移動。allowlist **NEVER** 含規約、skill、script、CI、truth 或任何會被散播／執行的路徑；**NEVER** 手動 `git push origin main` 代替該工具，**NEVER** 擴 allowlist 來放行一筆本來該走 PR 的 commit。clade home 的實作是 `scripts/main-sync.ts`，判準在其 `.claude/rules/local/clade-home-worktree.md` § 本機 main 與 origin 的同步；沒有這類共享登記簿的 repo 不適用本段。

## 合併後分支回收

`registry/consumers.json` 的**每一個** `repo_id` 都 MUST 開 GitHub「Automatically delete head branches」（`delete_branch_on_merge=true`），不限 `pr-merge-based`——trunk-based repo 偶發的 PR 一樣會留下分支。squash merge 之後原分支在 git 看來永遠領先 `main`，`--merged` 判不出它已落地，不開就只增不減。

開它不影響本檔的事件契約：`batch confirm-merged`／`cleanup` 讀 PR 號、receipt 與本機 `refs/heads/*`，不讀合併後的遠端 head branch；GitHub 也不刪 default branch 與仍是其他 open PR head 的分支。它**只**回收遠端 head branch——本機 worktree 與 branch 仍走 `batch cleanup`／`wt-helper cleanup`。

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | `node scripts/audit-repo-merge-settings.ts` exit 1（有 repo 沒開，印 `gh repo edit <repo> --delete-branch-on-merge`）；exit 2 是讀不到設定，**NEVER** 讀成已開。warn-only，不接 publish gate |
| 消費端 | `scripts/bootstrap-project.ts` 的 `repo-merge-settings` step（新 consumer onboarding）；`/clade-health full` 掃存量 |
| 載入路徑 | 本節（consumer 端投影為 `.claude/rules/github-flow.md`）；開設定的操作在 `project-bootstrap` skill § 4 |

驗證 CI 的綠燈是**最新 candidate 那條 run**。同 ref 被更新的 SHA 取代後，過期 run 必須由 workflow `concurrency` 取消，不得繼續佔 self-hosted runner 讓 HEAD 排隊。寫法與 deploy/gate 例外見 [[ci-workflow]] § CI / test workflow MUST cancel superseded runs on the same ref。

## 失敗路徑

CI 失敗、衝突、必要人工審查未完成、內容與 reviewed candidate 不符、來源 HEAD 在合併後前移：來源與未完成工作保留。清理中斷只重試 cleanup，不重複合併。未授權發版不得因 checkpoint、draft、PR ready 或 merge 發生。
