---
description: Manual Review data-readiness 規約——propose 階段準備驗收資料的 hard rule、[review:ui] 純功能驗證 step actionability、`@no-manual-review-check` marker schema、截圖檔名配對；寫 proposal.md / tasks.md 時 path-scoped 載入
paths: ['tasks/**', 'specs/plans/**', 'screenshots/**']
---
<!-- Clade native rule; source: adapters/claude/instructions/rules/core/manual-review.data-readiness.md; edit canonical source -->
<!-- clade-targets: claude -->

# Claude native data-readiness operations

Claude Code prepares concrete sample identifiers, seed fixtures, URL/role details, and mechanically pollable `ready_signal` values during propose/ingest. The review walkthrough uses the approved `agent-browser`/`Agent` surface only after the shared readiness contract is satisfied.

A sample is not ready because a file or status code exists: the Claude session must observe the requested content and preserve the evidence receipt.
