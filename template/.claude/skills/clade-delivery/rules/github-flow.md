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
| 討論／草稿 PR | 建立 draft PR | 可討論的獨立 diff | 把未完成範圍當已 ready |
| PR ready | `batch ready` + 完整品質鏈 | 獨立可接受的完整 diff、風險分級、適用 review／測試／人工 gate | 等待湊滿四件、重跑未受影響的完整 ceremony |
| 合併 | squash merge + `batch confirm-merged` | 最新 candidate、必要 CI／衝突／人工 gate 當下成立 | 用過期綠燈或未合併的 closed PR 當落地 |
| 回收 | `batch cleanup` | 已合併、HEAD 未變、無未保存工作／活寫入者／保留契約 | 把 checkpoint 或 PR 開啟當可刪來源 |
| 發版 | `/commit` Step 6 | 獨立授權與獨立證據 | 由 checkpoint、PR ready 或 merge 自動觸發 |

同一獨立可接受目的對應一個 PR。緊密相依工作可明確合批；**NEVER** 為湊數拆碎單一需求。`pr-merge-based` 的 auto 門檻是 1 件；`trunk-based` 仍是 4 件。試行預設最多 3 件 active implementation；ready backlog 達 3 件時優先交付。

## 證據綁定

Review 證據綁定受測 `head`、`base` 與 candidate tree。來源 HEAD 前移、base 過期或 candidate 變更使舊證據失效，必須重驗受影響範圍。PR A 合入後 PR B 的 base 過期時，B 驗證新的整合候選，不沿用舊 base 綠燈。

合併 receipt 必須綁定 repository、PR、reviewed head／base、candidate tree、merge SHA、squash 方法與內容證據（candidate tree 對 merge tree，加上 stable patch-id）。PR 關閉但未合併 **NEVER** 當成落地。

## 遠端強制與本機契約

Required checks 必須綁定實際受測 revision。workflow 路徑條件或 skipped check 不得讓必要檢查永遠不回報。

private repo **不上** GitHub rulesets、branch protection、merge queue：不為此升 GitHub Pro，也不為此改公開。本機唯一 landing owner、squash-only merge method，以及 `batch confirm-merged` receipt，就是強制契約。**NEVER** 把缺遠端保護列成剩餘工作或能力缺口。**NEVER** 宣稱遠端 required checks 已強制。公開 repo 若之後要開遠端強制，另行決定。

驗證 CI 的綠燈是**最新 candidate 那條 run**。同 ref 被更新的 SHA 取代後，過期 run 必須由 workflow `concurrency` 取消，不得繼續佔 self-hosted runner 讓 HEAD 排隊。寫法與 deploy/gate 例外見 [[ci-workflow]] § CI / test workflow MUST cancel superseded runs on the same ref。

## 失敗路徑

CI 失敗、衝突、必要人工審查未完成、內容與 reviewed candidate 不符、來源 HEAD 在合併後前移：來源與未完成工作保留。清理中斷只重試 cleanup，不重複合併。未授權發版不得因 checkpoint、PR ready 或 merge 發生。
