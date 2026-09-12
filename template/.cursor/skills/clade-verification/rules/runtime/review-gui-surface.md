---
description: 所有呼叫 review-gui 的外圍 agent surface 統一 SoP——入口 scan、compound item 拆解、multi-screenshot annotation、self-rationalize 禁令、annotation format contract；觸及 screenshots / spectra change / HANDOFF 時 path-scoped 載入
paths:
  - 'screenshots/**'
  - 'openspec/changes/**'
  - 'HANDOFF.md'
  - '.claude/agents/**'
---
<!-- Clade native rule; source: adapters/cursor/instructions/rules/core/review-gui-surface.md; edit canonical source -->
<!-- clade-targets: cursor -->

# Cursor review-gui and visual carrier

Cursor visual review uses the native `Task` carrier only when the task catalog is exposed. Browser evidence MUST use `cursor-ide-browser` (`browser_tabs`, `browser_navigate`, `browser_lock`, snapshot, interaction, unlock); an absent IDE browser blocks the evidence item. Keep review-gui bucket and annotation semantics from the common rule.
