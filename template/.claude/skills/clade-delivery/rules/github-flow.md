---
description: GitHub Flow 事件責任與成本邊界 — checkpoint、review、合併、回收、發版分成不同事件
paths:
  - 'vendor/scripts/wt-batch.ts'
  - 'plugins/hub-core/skills/commit/**'
  - 'plugins/hub-core/skills/wt/**'
  - 'plugins/hub-core/skills/handoff/**'
  - 'plugins/hub-core/skills/gh-ci-watch/**'
  - '.github/workflows/**'
  - 'HANDOFF.md'
  - 'tasks/**'
---
<!-- Clade native rule; source: rules/core/github-flow.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->

# GitHub Flow 事件契約

本檔是 Claude Code／Cursor／Codex／Pi 共用的平行切片作業契約。盤點 outstanding → 獨立切片各派一個 owner → **一刀一 branch 一 draft PR** → 盯該 PR 的 CI → 紅燈回原 owner。操作命令見 commit skill `batch.md`、[[worktree-default]] §5、[[gh-ci-watch]]。

## 事件與成本

| 事件 | 入口 | 必要成本 | 禁止綁上的成本 |
| --- | --- | --- | --- |
| 實作 checkpoint | `batch checkpoint` | 保存自己的 scope、必要基本檢查、作者與來源 | 完整 AI review、收割全 repo WIP、全域 handoff、發版 |
| 切片可見性 draft | slice owner `git push` + `gh pr create --draft` | 相對 `main` 非空 committed diff、該 session branch、CI watch | 把未完成範圍當已 ready、啟動完整品質鏈、merge、直推 `main` |
| 討論 draft（可選） | 同上，另記 `batch draft` | 可見性 draft 的條件，加上具名討論者與會改變剩餘實作的具體問題 | 把討論當 ready |
| PR ready | `batch ready` + 完整品質鏈 | 獨立可接受的完整 diff、風險分級、適用 review／測試／人工 gate | 等待湊滿四件、重跑未受影響的完整 ceremony |
| 合併 | 具名 coordinator 在 C 節 predicate 全成立時 squash + `batch confirm-merged`／`batch merge-unattended` | 最新 candidate、必要 CI／衝突／人工 gate 當下成立；unattended 另需授權 JSON | 用過期綠燈或未合併的 closed PR 當落地；slice **worker NEVER merge** |
| 回收 | `batch cleanup` | 已合併、HEAD 未變、無未保存工作／活寫入者／保留契約 | 把 checkpoint、draft 或 PR 開啟當可刪來源 |
| 發版 | `/commit` Step 6 | 獨立授權與獨立證據 | 由 checkpoint、draft、PR ready 或 merge 自動觸發 |

同一獨立可接受目的對應一個 PR。緊密相依工作可明確合批；**NEVER** 為湊數拆碎單一需求。`pr-merge-based` 的 auto 門檻是 1 件；`trunk-based` 仍是 4 件。預設最多 3 件 active implementation；ready backlog 達 3 件時優先交付。

## Draft 不是 ready

**Iron Law：Draft 不是 ready。違反字面就是違反精神。** 切片 draft 付的是**可見性與 CI**，不是「獨立可接受的完整 diff」。PR ready／merge 仍在實作與完整品質鏈之後。

### 切片可見性 draft（預設；slice owner 自己開）

獨立切片在來源 worktree 相對 `main` 已有非空 committed diff 後，**slice owner**（cloud implementer、`/wt` worker、desk worktree 執行者）MUST：

1. 來源 `git status` 乾淨（相對於要推的 commits）。
2. `gh pr view <session-branch> --json number,isDraft,headRefName`（branch 是位置參數；查無 PR 時非 0 退出）：已有 PR 就沿用該號，**NEVER** 再開一張。
3. 沒有遠端物件時 **只** `git push -u origin <session-branch>`。**NEVER** `git push origin main`。
4. 沒有 PR 時 `gh pr create --draft --base main --head <session-branch>`。
5. `gh pr view <session-branch> --json number,isDraft,headRefName`：`isDraft` 為 true、head 就是該 session branch。**NEVER** 省略 branch。
6. 立刻盯**該 PR head SHA** 的 CI（Claude／Codex：`/gh-ci-watch`；Cursor：`subscribe_github_ci`／`subscribe_github_pr` 或同等）。
7. CI 紅燈：同一 owner、同一張 PR 上修再 push；**NEVER** 為同一切片開第二張 PR。
8. 用該 PR 號跑 `batch draft --kind visibility` 把可見性 receipt 持久登記。create／push 失敗就不要寫 receipt。討論 draft 才用 `--kind discussion`（或舊的 `--discussant`＋`--question`）。

Draft 維持 draft 直到 review。slice **worker NEVER merge**、**NEVER** `gh pr ready`、**NEVER** 為了看得見而 merge-back。空 branch／只有 WIP **NEVER** 開 PR。具名 coordinator 只在 [[commit]] 批次 `merge-unattended` 的機械 predicate 全成立、且沒有有效 do-not-merge hold 時才能 squash；那不是 worker 權限，也不是把所有 agent 當 coordinator。

原生派工載體不同、結果相同：Cursor Project 用 `CreateAgent`；Claude／Codex 用 `/wt` 或 Herdr fanout。**NEVER** 把 Cursor 主線的 `/handoff relay|fanout` 讀成這條契約的必要入口。

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
| 「PR 是落地／送審事件，所以做完才能開任何 PR」 | 切片 draft 付的是可見性與 CI，不是 ready |
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
