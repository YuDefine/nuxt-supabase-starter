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

> Reference 檔。**要不要排 keepalive**（Iron Law、適用範圍窮舉、派出當下的自查表、Red Flags）留在 [`agent-routing.md`](./agent-routing.md) § 主線靜默上限；**怎麼填**（canonical inert 模板逐字、deadline 取值）與**醒來之後做什麼**都在本檔。兩個時刻各有 [[agent-routing]] 的具名時機指針叫醒本檔。

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

## 派出當下的模板與 deadline（MUST，由 [[agent-routing]] § 主線靜默上限 的具名時機指針叫醒）

> 本節不是 reaction-time 契約——它在**派出 async job 的那一則訊息**就要用到。[[agent-routing]] 常駐 Iron Law ＋ 適用範圍 ＋ 派出當下的自查表 ＋ Red Flags，模板逐字與 deadline 取值全文在這裡。

### Async keepalive prompt（canonical inert control message）

**每一種** async 派工都用這一份模板：只有 `Bash(run_in_background)` 有 `TaskOutput(block=false)` 查得到的 harness task id，填真實 `<task-id>`；**其餘每一種**（Agent tool、`/wt` Claude subagent、Monitor、Workflow）**逐字**填 `task=none`，**NEVER** 虛構 id 補洞。派出時 MUST 記下這三個欄位的值（`<owner>` 要能被 `TaskStop(owner)` 操作），控制訊息也只替換它們：

```text
ASYNC_KEEPALIVE_CONTROL task=<task-id|none> owner=<owner> deadline=<ISO>. Status-only. If task is an id, call TaskOutput(block=false) for it: if terminal, stop this wakeup and enqueue ASYNC_LIFECYCLE_HANDOFF task=<task-id> owner=<owner> cause=terminal. If task=none, never query TaskOutput or infer task status; wait for the native completion notification instead. Before deadline, if it is still running or no notification has arrived, re-arm this exact message. At deadline, or if status remains unknown after the bounded retry, stop this wakeup and enqueue ASYNC_DEADLINE_INTERVENTION task=<task-id|none> owner=<owner> cause=<deadline|unknown>. Never replay the dispatched instruction.
```

**Iron Law：async keepalive 只控制既有 async job 的生命週期，NEVER 承載原任務。違反字面就是違反精神。** 原任務含共享修改時，塞進 `prompt` 會讓 classifier 正確讀成「未來重新執行共享修改」，即使本意只是 keepalive。

native completion notification 到達時 **MUST** 停掉對應 wakeup。`task=none` 的 job 沒有 harness task status 可查，但 **owner 自己的原生狀態面**（Herdr pane 的 `agent_status`、Agent 的 idle notification）**是 allowlist 內的 liveness 確認**；被禁的是**讀 output / log / repo 猜進度**（兩者的界線見 rationale § liveness 確認 vs 猜進度）。deadline intervention 只准用 owner 的原生控制面（例如 `TaskStop(owner)`）發出取消，並等待 native terminal notification；確認 terminal 前保留 ownership，NEVER 收割、重派、記 fail-streak或釋放 lock。

### deadline 怎麼取（MUST）

canonical 模板的 `deadline` 是**必填**欄位，也是破壞性分支的觸發點——到期要 `TaskStop(owner)`，善後只能冷啟重跑。取值錯的代價因此不對稱：太晚只是多等一輪 interval，太早會砍掉一個**仍在自己預算內**的 run。**一律往晚的方向取。**

**每一次**填 `deadline` 都先答一句「我派出去的東西，自己的硬超時（子層的 pi `--budget`、CI job timeout、Monitor TTL）落在哪？」再依下表取值。**每一份** keepalive 都適用，不是只有長任務：

| 可觀察 predicate | deadline MUST |
| --- | --- |
| 派出的東西有**已知**硬超時（pi dispatch `--budget N` → 實際 kill 在 `(N+5)` 分；CI job 的 timeout；Monitor TTL） | ≥ 該硬超時 ＋ 父層收尾所需時間。**NEVER** 取一個比它早的值 |
| 兩層 dispatch，下游 job 的 budget 由子層自己決定、父層填 deadline 當下**尚不存在**（`/wt` Form 3 → Claude subagent 再自行派 pi，是主幹不是邊角） | 取子層**可能的最大** budget 當上界；上界也取不出來 → brief 內 MUST 要求子層回報它選定的 budget，收到後**改排**一次修正 deadline |
| 完全估不出硬超時 | 取一個明顯寬鬆的值，並在 `ScheduleWakeup` 的 `reason` 逐字註明「deadline 為上界猜測」 |

**NEVER** 把 deadline 讀成「我希望它多久做完」——它不是期望值，是「超過這個點就判定它卡死」的閾值。**NEVER** 靠縮短 interval 補償取不準的 deadline：interval 管 prompt cache，deadline 管誤殺，兩條軸獨立。

逐字反開脫：「dispatch 時間 +4 小時，看起來夠寬鬆了」——2026-08-13 <consumer-a> 實測父層就是這樣填出 `20:48:37`，子層選 `--budget 240`、實際 kill timeout 落在 `20:56`，早了 8 分鐘。**直覺值不是上界**。

本證據決定：deadline 往哪個方向取（一律往晚；資訊不足時取上界並改排）。
本證據不決定：要不要排 keepalive——**NEVER** 拿「deadline 估不準」當不排 keepalive 的理由。

### `/loop` dynamic 是唯一 prompt-preserving 分支

由 `/loop` dynamic mode 自我續跑的 wakeup **MUST** 保留同一份 `/loop` prompt；autonomous dynamic loop 使用 harness 指定的 `<<autonomous-loop-dynamic>>` sentinel（**逐字寫錯就等於默默放掉這個分支**，改動前先對照 `ScheduleWakeup` tool description 的 `prompt` 欄位；混用警告見 rationale）。這一支的目的就是下一輪繼續執行 loop，**NEVER** 套 inert control message。反方向也成立：`runner.sh`、work-loop background dispatch、pi safety net 都是 async keepalive，**NEVER** 因原任務來自 `/work-loop` 就保留原 prompt。

### 邊界

與 `\do-all` 主線閒置禁令、全域「不要把工作往後放」都**不衝突**（兩條關係的完整論證見 rationale § keepalive 與其他兩條規約的關係）。

> 成本量級與兩次靜默實測（119 分鐘 / 1h43m）見 rationale § keepalive 的成本量級。
>
> 本證據決定：主線要不要在 async work 期間醒來——要。
> 本證據不決定：醒來後做什麼——**NEVER** 拿它論證「所以應該多醒幾次」或「醒來順便輪詢進度」，那兩件事上表已各自禁止。
