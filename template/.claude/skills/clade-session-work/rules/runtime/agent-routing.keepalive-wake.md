---
description: keepalive wakeup **醒來那個 turn** 的 allowlist 與 claim 狀態機、以及 permission classifier 要求 specific shared-action consent 時的 structured user-input surface 形狀；兩者都是 reaction-time 契約，不參與「派不派 / 派給誰 / deadline 填多少」的派出決策。本檔**不會**在派工當下自動載入——收到 keepalive wakeup、或 classifier 要求具名 consent 的那一刻，MUST 依 [[agent-routing]] § 主線靜默上限 的強制指針主動 Read
paths: ['.clade/work-loop/**']
---
<!-- Clade native rule; source: adapters/claude/instructions/rules/core/agent-routing.keepalive-wake.md; edit canonical source -->

<!-- clade-targets: claude -->

# Claude native keepalive controls

For this target, `TaskOutput(block=false)` is the non-blocking harness status query, `ScheduleWakeup` is the inert control wakeup, and `TaskStop` cancels the owned task after deadline intervention. `AskUserQuestion` supplies the specific-consent choice when the common classifier requires it.

The canonical keepalive body is shared; these names are the Claude carrier mapping. The control turn still follows the common allowlist and claim state machine.
