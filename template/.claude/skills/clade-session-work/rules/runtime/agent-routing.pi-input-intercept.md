---
description: Codex 模型經 Pi machine dispatch 提出問題時的攔截、評估、代答或升級 protocol；觸及工作計畫 / screenshot 情境時 path-scoped 載入
paths: ['openspec/changes/**/tasks.md', 'openspec/changes/**/design.md', '.claude/agents/**', 'screenshots/**/progress.json']
---
<!-- Clade native rule; source: adapters/claude/instructions/rules/core/agent-routing.pi-input-intercept.md; edit canonical source -->

<!-- clade-targets: claude -->

# Claude native question escalation

The shared Pi `## Question` protocol stays the carrier contract. Claude's coordinator reads the terminal result, answers only from a cited rule or code fact, and uses `AskUserQuestion` when the question requires a human decision. Re-dispatch preserves the original brief, route, tier basis, and retry receipt.
