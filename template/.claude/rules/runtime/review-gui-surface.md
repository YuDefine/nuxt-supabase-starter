---
description: 所有呼叫 review-gui 的外圍 agent surface 統一 SoP——入口 scan、compound item 拆解、multi-screenshot annotation、self-rationalize 禁令、annotation format contract；觸及 screenshots / spectra change / HANDOFF 時 path-scoped 載入
paths:
  - 'screenshots/**'
  - 'openspec/changes/**'
  - 'HANDOFF.md'
  - '.claude/agents/**'
---
<!-- Clade native rule; source: adapters/claude/instructions/rules/core/review-gui-surface.md; edit canonical source -->
<!-- clade-targets: claude -->

# Claude review-gui and evidence carrier

The Claude review path collects `[verify:ui]` evidence through Pi `--table-row screenshot-review-verify` (`--model gemini --effort high`). Design Review / visual judgment uses the qualified Claude visual executor and `agent-browser` when that CLI is exposed and validated. Inspect Pi completion from the dispatcher JSON and keep the structured user decision in `AskUserQuestion`. Performance topics use the verified `chrome-devtools-mcp` surface when present; absence is an explicit blocked evidence item.
