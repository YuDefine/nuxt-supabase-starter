---
description: 所有把人導向控制面板（review-gui）或回報「有沒有等人的事」的 agent surface 統一 SoP——入口 `flow gates`、gate family 逐條回報、compound item 拆解、evidence sidecar 契約、截圖 evidence 分工；觸及 screenshots / plan package / HANDOFF 時 path-scoped 載入
paths:
  - 'screenshots/**'
  - 'specs/plans/**'
  - 'openspec/changes/**'
  - 'HANDOFF.md'
  - '.claude/agents/**'
---
<!-- Clade native rule; source: adapters/claude/instructions/rules/core/review-gui-surface.md; edit canonical source -->
<!-- clade-targets: claude -->

# Claude review-gui and evidence carrier

Claude runs `flow gates` with its native shell tool before stating whether anything waits on a person. The Claude review path collects `[verify:ui]` evidence through Pi `--table-row screenshot-review-verify` (`--model gemini --effort high`). Design Review / visual judgment uses the qualified Claude visual executor and `agent-browser` when that CLI is exposed and validated. Inspect Pi completion from the dispatcher JSON and keep the structured user decision in `AskUserQuestion`; a conclusion that must reach a person later is filed with `flow ask`, not left in chat. Performance topics use the verified `chrome-devtools-mcp` surface when present; absence is an explicit blocked evidence item.
