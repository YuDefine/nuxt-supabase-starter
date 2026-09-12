---
description: 收 verify:ui / review:ui 視覺 evidence 的操作規約——截圖與驗證同一個 Bash call、(a)–(e) 五層驗證的 canonical pattern、seed fixture 必須進 seed.sql、worktree .env 先驗再宣稱缺、既有 [x] 要自拍佐證、UI 改動後全批重拍、`(deferred:)` failure trail 逐字範例、收尾前 receipt 齊全核對
paths: ['screenshots/**', 'openspec/changes/**/tasks.md', 'app/**/*.vue', 'components/**/*.vue', 'packages/*/components/**/*.vue', 'pages/**/*.vue', 'packages/*/pages/**/*.vue', 'layouts/**/*.vue', 'packages/*/layouts/**/*.vue', 'e2e/**', 'packages/*/e2e/**', 'playwright.config.*', 'packages/**/app/**/*.vue']
---
<!-- Clade native rule; source: adapters/cursor/instructions/rules/core/agent-self-verification.screenshot-evidence.md; edit canonical source -->
<!-- clade-targets: cursor -->

# Cursor screenshot evidence operations

Cursor uses `cursor-ide-browser` snapshot/screenshot and `browser_cdp` evaluation in one atomic interaction round. Capture, URL/auth checks, DOM readiness, dialog checks, and item-description cross-checks must be completed before the evidence annotation is written. A failed check invalidates the capture and requires a new interaction round.

Cursor's native browser session is the only carrier for this fragment. Do not route screenshot collection through a shell runner or a separate runtime.
