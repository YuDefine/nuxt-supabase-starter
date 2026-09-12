---
description: Codex 模型經 Pi machine dispatch 提出問題時的攔截、評估、代答或升級 protocol；觸及工作計畫 / screenshot 情境時 path-scoped 載入
paths: ['openspec/changes/**/tasks.md', 'openspec/changes/**/design.md', '.claude/agents/**', 'screenshots/**/progress.json']
---
<!-- Clade native rule; source: adapters/cursor/instructions/rules/core/agent-routing.pi-input-intercept.md; edit canonical source -->

<!-- clade-targets: cursor -->

# Cursor native input boundary

Pi's `--no-session` JSON carrier and `## Question` protocol remain shared. Cursor Task and its native interaction surface are target-specific; use them only when present in the current catalog and preserve the common fail-closed re-dispatch contract.
