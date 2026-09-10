---
description: 收 verify:ui / review:ui 視覺 evidence 的操作規約——截圖與驗證同一個 Bash call、(a)–(e) 五層驗證的 canonical pattern、seed fixture 必須進 seed.sql、worktree .env 先驗再宣稱缺、既有 [x] 要自拍佐證、UI 改動後全批重拍、`(deferred:)` failure trail 逐字範例、收尾前 receipt 齊全核對
paths: ['screenshots/**', 'openspec/changes/**/tasks.md', 'app/**/*.vue', 'components/**/*.vue', 'packages/*/components/**/*.vue', 'pages/**/*.vue', 'packages/*/pages/**/*.vue', 'layouts/**/*.vue', 'packages/*/layouts/**/*.vue', 'e2e/**', 'packages/*/e2e/**', 'playwright.config.*', 'packages/**/app/**/*.vue']
---
<!-- Clade native rule; source: adapters/claude/instructions/rules/core/agent-self-verification.screenshot-evidence.md; edit canonical source -->
<!-- clade-targets: claude -->

# Claude screenshot evidence operations

Use Claude Code's `agent-browser` session for non-Cursor evidence. The canonical operation is one shell call: run the screenshot command, verify file size, inspect the interactive snapshot, check the final URL, and perform the item-description cross-check before writing the annotation. `safe-screenshot.ts` is the atomic capture helper for canonical evidence and must preserve the previous file when validation fails.

When a separate visual verifier is required, dispatch the approved Claude `Agent` with the review skill's verify mode. It may observe a known URL and final state; it does not mutate data, fill forms, or invent fixtures.
