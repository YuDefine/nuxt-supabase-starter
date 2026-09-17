---
description: 所有把人導向控制面板（review-gui）或回報「有沒有等人的事」的 agent surface 統一 SoP——入口 `flow gates`、gate family 逐條回報、compound item 拆解、evidence sidecar 契約、截圖 evidence 分工；觸及 screenshots / plan package / HANDOFF 時 path-scoped 載入
paths:
  - 'screenshots/**'
  - 'specs/plans/**'
  - 'openspec/changes/**'
  - 'HANDOFF.md'
  - '.claude/agents/**'
---
<!-- Clade native rule; source: adapters/cursor/instructions/rules/core/review-gui-surface.md; edit canonical source -->
<!-- clade-targets: cursor -->

# Cursor review-gui and visual carrier

Cursor visual review uses the native `Task` carrier only when the task catalog is exposed. Browser evidence MUST use `cursor-ide-browser` (`browser_tabs`, `browser_navigate`, `browser_lock`, snapshot, interaction, unlock); an absent IDE browser blocks the evidence item. Keep the gate family and evidence sidecar semantics from the common rule.
