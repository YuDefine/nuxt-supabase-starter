---
description: Screenshot strategy 規則——根據互動深度、跨裝置、跨瀏覽器與是否要沉澱成回歸測試，選擇 approved browser carrier 或 reproducible browser runner CLI
paths: ['screenshots/**', 'tests/e2e/**', 'packages/*/tests/e2e/**', 'openspec/changes/**/design-review.md']
---
<!-- Clade native rule; source: adapters/claude/instructions/rules/core/screenshot-strategy.md; edit canonical source -->
<!-- clade-targets: claude -->

# Claude native screenshot strategy

For Claude Code, use `agent-browser` for a one-off authenticated observation or review, `Playwright` for repeatable responsive/cross-browser specs, and `chrome-devtools-mcp` only for performance measurement (Lighthouse, traces, heap snapshots); daily screenshots and interaction use the browser carrier. Use `safe-screenshot.ts` for canonical review evidence.

The carrier session must remain isolated, be re-snapshotted after navigation or interaction, and validate URL, DOM, expected text, and artifact size in the same operation. Remote browser providers are opt-in and require the shared consent and privacy gates.
