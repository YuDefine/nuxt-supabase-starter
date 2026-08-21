---
description: keepalive wakeup **醒來那個 turn** 的 allowlist 與 claim 狀態機、以及 permission classifier 要求 specific shared-action consent 時的 AskUserQuestion 形狀；兩者都是 reaction-time 契約，不參與「派不派 / 派給誰 / deadline 填多少」的派出決策。本檔**不會**在派工當下自動載入——收到 keepalive wakeup、或 classifier 要求具名 consent 的那一刻，MUST 依 [[agent-routing]] § 主線靜默上限 的強制指針主動 Read
paths: ['.clade/work-loop/**']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/agent-routing.keepalive-wake.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# Agent Routing — keepalive 醒來與 shared-action consent（reaction-time 契約）

> Reference 檔。派出當下的判定（要不要排 keepalive、interval、deadline 怎麼取、兩份 canonical inert 模板逐字）留在 [`agent-routing.md`](./agent-routing.md) § 主線靜默上限，**本檔不複製**。

### Generic keepalive 醒來只做控制面動作

| 可觀察 predicate | 動作 |
| --- | --- |
| `TaskOutput(block=false)` = running，且未到 deadline | 以**完全相同**的 inert prompt 重排既有 interval，本 turn 結束 |
| task = terminal | 停對應 wakeup，排一次不含原任務、結果或授權的 `ASYNC_LIFECYCLE_HANDOFF task=<id> owner=<owner> cause=terminal` |
| task = running，且到 deadline | 停 control wakeup、保留 owner 與 in-flight claim，排 `ASYNC_DEADLINE_INTERVENTION`；owner 必須先取消 task（`TaskStop`）或取得具名延長，**確認 terminal 前 NEVER** 收割、釋放 lock 或重派 |
| 狀態不可判定（含 runtime 沒有 `TaskOutput` 可用） | 不 claim、不收割、不釋放 lock；以同一 inert prompt 進行有限次重查。次數用盡時走 `ASYNC_DEADLINE_INTERVENTION`，確認 terminal 前同樣不得重派。**NEVER** 因為查不到狀態就改讀 `BashOutput` tail 或 log 補判——那是 allowlist 外的動作，per 下一段 |

control turn 的 allowlist 只有「`TaskOutput(block=false)`、重排同一 inert wakeup、停止 wakeup、排 lifecycle handoff / deadline intervention」。**NEVER** 讀 repo / log 猜狀態、執行原任務、Edit / Write、commit、publish、propagate、push、開新工作或做任何 shared-resource mutation。

**每一個** native completion notification 與 terminal lifecycle handoff **MUST** 先共用 claim（`pending → harvesting → harvested`）再收尾。**claim key：有 harness task id 的路徑用 task-id；notification-only 路徑（`taskId: null`）用 owner ref**，狀態機相同：已是 `harvesting` / `harvested` 則 no-op（這擋掉 delayed notification 重複收割），deadline / unknown **不得 claim**。只有 claim 成功的正常 turn 可讀 result 並走 owner 既有收尾，且同一 turn **MUST** 停掉對應 wakeup（`ScheduleWakeup({stop: true})`）並一併 `TaskStop` owner 的 persistent Monitor（若有）。

### Shared-action specific consent UX

permission classifier 要求具名 shared-action consent 時，主線 **MUST** 用 `AskUserQuestion` 呈現；推薦選項的 `description` **MUST** 放完整授權範圍（目標 repo / resource、具名 action、允許的 path 或 ref、明確不包含什麼）。user 點選該選項即構成這一次的 specific consent，可直接執行該範圍；**NEVER** 再要求 user 手打、複製或貼上同一句完整授權文字。

canonical 選項形狀（label / description / 另一選項的逐字模板）見 rationale § shared-action consent 的 canonical 選項形狀。

若目前 runtime 不允許 `AskUserQuestion`（unattended / headless），該 shared action 維持 blocked，將**同一份完整具名範圍**寫進 decision packaging；**NEVER** 降級成要求 user 另開訊息手打授權句，也 NEVER 自行推定 consent。

逐字實錄 → 現實的六條對照（含 `ScheduleWakeup` description 那句 pure waste 的前提為何不成立）見 rationale § 主線靜默上限的 rationalization table。
