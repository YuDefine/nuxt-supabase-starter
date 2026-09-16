---
description: GitHub Flow 事件責任與成本邊界 — checkpoint、review、合併、回收、發版分成不同事件
paths:
  - 'vendor/scripts/wt-batch.ts'
  - 'plugins/hub-core/skills/commit/**'
  - '.github/workflows/**'
---
<!-- Clade native rule; source: rules/core/github-flow.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->

# GitHub Flow 事件契約

本檔是 clade 標準層與 `YuDefine/clade` 試行契約。全面採用與 fleet rollout 另行決定。操作命令見 commit skill `batch.md`。

## 事件與成本

| 事件 | 入口 | 必要成本 | 禁止綁上的成本 |
| --- | --- | --- | --- |
| 實作 checkpoint | `batch checkpoint` | 保存自己的 scope、必要基本檢查、作者與來源 | 完整 AI review、收割全 repo WIP、全域 handoff、發版 |
| 討論／草稿 PR | `batch draft` | 可討論的獨立 diff、具名討論者、會改變剩餘實作的具體問題 | 把未完成範圍當已 ready、啟動完整品質鏈、授予 worker push／merge |
| PR ready | `batch ready` + 完整品質鏈 | 獨立可接受的完整 diff、風險分級、適用 review／測試／人工 gate | 等待湊滿四件、重跑未受影響的完整 ceremony |
| 合併 | squash merge + `batch confirm-merged` | 最新 candidate、必要 CI／衝突／人工 gate 當下成立 | 用過期綠燈或未合併的 closed PR 當落地 |
| 回收 | `batch cleanup` | 已合併、HEAD 未變、無未保存工作／活寫入者／保留契約 | 把 checkpoint、draft 或 PR 開啟當可刪來源 |
| 發版 | `/commit` Step 6 | 獨立授權與獨立證據 | 由 checkpoint、draft、PR ready 或 merge 自動觸發 |

同一獨立可接受目的對應一個 PR。緊密相依工作可明確合批；**NEVER** 為湊數拆碎單一需求。`pr-merge-based` 的 auto 門檻是 1 件；`trunk-based` 仍是 4 件。試行預設最多 3 件 active implementation；ready backlog 達 3 件時優先交付。

## Draft 不是 ready

**Iron Law：Draft 不是 ready。違反字面就是違反精神。** 「可討論的獨立 diff」不是「獨立可接受的完整 diff」。PR ready／merge 仍在實作與完整品質鏈之後；draft 只是討論事件。

已有可討論的獨立 diff，且具名討論者須回答會影響後續實作的具體問題時，可於實作完成前建立 draft PR；不得因此登記 ready、啟動完整品質鏈或授予 worker push／merge 權限。

**每一個** draft 都 MUST 三條全中，缺一就停在 checkpoint，不開 PR：

1. 來源 worktree 相對 `main` 已有非空 committed diff（空 branch／只有 WIP 都不算）
2. 具名討論者（人的名字或角色，不是「有人」）
3. 一條具體待答問題，且該答案會改變剩餘實作

操作入口是 `batch draft`（commit skill `batch.md`）。它只記 receipt，**不是**建立 GitHub PR 的命令，**NEVER** 把該來源放進 ready 池、**NEVER** 當 `prepare` 成員、**NEVER** 當落地授權。

### Coordinator 發佈 draft（順序不可調換）

**每一個**遠端 draft 都由 coordinator 做，worker **NEVER** `git push`、**NEVER** `gh pr create`、**NEVER** merge。建立任何遠端物件之前 MUST 先核對三條 predicate，且來源 worktree 乾淨、HEAD 相對 checkpoint 未前移。缺一停在 checkpoint。

1. 本機三條 predicate 全中，來源 `git status` 乾淨。
2. `gh pr view <session-branch> --json number,isDraft,headRefName`（`gh pr view` 沒有 `--head` 旗標，branch 是位置參數；查無 PR 時非 0 退出）：已有 PR 就沿用該號，**NEVER** 再開一張。
3. 沒有遠端物件時，coordinator **只** `git push -u origin <session-branch>`（討論期唯一合法 push）。
4. `gh pr create --draft --base main --head <session-branch>`，body 寫具名討論者與那條具體問題。
5. `gh pr view <session-branch> --json number,isDraft,headRefName`：`isDraft` 為 true、head 就是該 session branch。**NEVER** 省略 branch——不帶參數時 `gh` 取當前 checkout 的 branch，coordinator 不在來源 worktree 內就查到別張 PR。
6. 用該 PR 號跑 `batch draft`。create／push 失敗就不要寫 receipt；已存在的 PR 不要重開。

### Draft → ready：同一張 PR

同一獨立可接受目的對應**一**個 PR 號。Draft 掛來源 session branch；正式 commits 在隔離 integration。seal 之後 coordinator MUST 把**受審 formal HEAD** 交到**既有** PR 的 head ref，然後才 `gh pr ready`／ship。

`prepare` MUST 把每個成員當下的 draft PR 號與 head branch 寫入 batch journal；批次建立後，該 journal 是本批綁定的唯一依據，`confirm-merged` MUST 比對 journal 與遠端 PR，不得在合併確認時重讀 `drafts/` 側檔。唯一例外是綁定快照上線前 prepare 的舊批次（journal 沒有綁定欄位）：它可能已經合併，cancel 重來會移動 reviewed base、讓 receipt 永遠過不了，所以改以成員當下的 `drafts/` 側檔為綁定依據，側檔與 receipt 不符同樣 fail closed。`batch draft` MUST 拒絕已屬於 active batch（非 landed／cleaned／cancelled）的 workId，並指出 batch id。讀取 draft receipt 時 MUST 驗證 receipt 內的 workId 與查詢值完全相等；有損檔名正規化造成碰撞時 fail closed，保留 receipt 供復原，不得讓另一件工作繼承綁定。

- 既有 head 能快轉到 formal HEAD → 快轉 push。
- 不能快轉（integration squash 產生新 commit）→ 先 `git ls-remote origin refs/heads/<既有 PR 的 head branch>` 取得遠端 SHA，確認它等於 `gh pr view <PR 號> --json headRefOid` 與 draft receipt 記的 head，再只准 `git push --force-with-lease=refs/heads/<既有 PR 的 head branch>:<剛驗證的遠端 SHA> origin <reviewed-formal-head>:refs/heads/<既有 PR 的 head branch>`。**NEVER** 用不帶 expected SHA 的 `--force-with-lease`——它比對的是本機 remote-tracking ref，中途一次 fetch 就讓 lease 失效。這是本節具名轉換，不是通用 `--force`。
- `--force-with-lease` 失敗、遠端 HEAD 已變、或 PR 號對不上 workId → **停**。**NEVER** 開第二張 PR，**NEVER** 把關閉 draft 當成 landed。

`batch ready` 與完整品質鏈仍在轉換**之前**；轉換成功只是讓同一張 PR 指向受審 HEAD，不跳過 seal／confirm-merged。

| 藉口 | 現實 |
| --- | --- |
| 「PR 是落地／送審事件，所以做完才能開任何 PR」 | 本檔已有討論／草稿事件；draft 付的是討論成本，不是 ready |
| 「branch 一開就先開 PR 比較看得見」 | 空 PR 不是可討論的獨立 diff；worktree／session branch 才是開工身分 |
| 「反正是 draft，先 ready 再說」 | draft **NEVER** 進 ready 池，也不啟動完整品質鏈 |
| 「worker 自己 push 比較快」 | draft 不授予 worker push／merge；worker 仍只 checkpoint |

**NEVER** 在 `wt-helper add` 或第一個 commit 之前開 PR。**NEVER** 把 draft、checkpoint 或未合併 PR 當成可刪來源或已落地。

## 證據綁定

Review 證據綁定受測 `head`、`base` 與 candidate tree。來源 HEAD 前移、base 過期或 candidate 變更使舊證據失效，必須重驗受影響範圍。PR A 合入後 PR B 的 base 過期時，B 驗證新的整合候選，不沿用舊 base 綠燈。

合併 receipt 必須綁定 repository、PR、reviewed head／base、candidate tree、merge SHA、squash 方法與內容證據（candidate tree 對 merge tree，加上 stable patch-id）。PR 關閉但未合併 **NEVER** 當成落地。

## 遠端強制與本機契約

Required checks 必須綁定實際受測 revision。workflow 路徑條件或 skipped check 不得讓必要檢查永遠不回報。

private repo **不上** GitHub rulesets、branch protection、merge queue：不為此升 GitHub Pro，也不為此改公開。本機唯一 landing owner、squash-only merge method，以及 `batch confirm-merged` receipt，就是強制契約。**NEVER** 把缺遠端保護列成剩餘工作或能力缺口。**NEVER** 宣稱遠端 required checks 已強制。公開 repo 若之後要開遠端強制，另行決定。

驗證 CI 的綠燈是**最新 candidate 那條 run**。同 ref 被更新的 SHA 取代後，過期 run 必須由 workflow `concurrency` 取消，不得繼續佔 self-hosted runner 讓 HEAD 排隊。寫法與 deploy/gate 例外見 [[ci-workflow]] § CI / test workflow MUST cancel superseded runs on the same ref。

## 失敗路徑

CI 失敗、衝突、必要人工審查未完成、內容與 reviewed candidate 不符、來源 HEAD 在合併後前移：來源與未完成工作保留。清理中斷只重試 cleanup，不重複合併。未授權發版不得因 checkpoint、draft、PR ready 或 merge 發生。
