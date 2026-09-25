---
description: Routing Table 的對照資料層——工作類別 × 由誰執行（model・effort）× 為什麼的逐列表，以及 effort 檔位對照表。跨列的硬禁令與判準留在 [[agent-routing]] § Routing Table，本檔只承載查表用的列。**單純「要派工」不會自動載入本檔**：查表決定 model／effort 的那一刻，MUST 依 [[agent-routing]] § Routing Table 的強制指針主動 Read；改本表任一列或動 pi-routing-*.ts / pi-dispatch.ts 時 path-scoped 載入
paths:
  [
    '.claude/rules/agent-routing.md',
    'rules/core/agent-routing.md',
    'vendor/scripts/pi-routing-policy.ts',
    'vendor/scripts/pi-routing-gate.ts',
    'vendor/scripts/pi-dispatch.ts',
  ]
---
<!-- Clade native rule; source: adapters/claude/instructions/rules/core/agent-routing.routing-table.md; edit canonical source -->

<!-- clade-targets: claude -->

# Claude native table transport

Rows whose executor is a Claude subagent use the native `Agent` catalog and the model selected by the common delegation predicates. UI view implementation, including Nuxt UI/Content (the former `ui-implementation` row), uses Claude Opus 5.5 medium; Nuxt core uses Pi GPT-6 Sol xhigh. Screenshot review uses Pi Gemini 3.8 Flash high. Design Review, UI detailed planning and screenshot-item matching use Claude Opus 5.5 medium with no fallback: when Opus is unavailable the main line does the work itself, except that commit 0-A and the commit 0-B `design-review`／`screenshot-match-analysis` seats stay incomplete. Models on the shared banned list are never a primary or fallback target. Capture and matching remain separate dispatches. Pi rows continue through `pi-dispatch.ts` with the shared model, effort, route, tier-basis, workspace-access, and retry fields.
