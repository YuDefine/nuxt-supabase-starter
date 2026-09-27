---
description: Manual Review evidence 規約——寫 / 審 tasks.md 的 ## 人工檢查 區塊時 path-scoped 載入
paths: ['tasks/**', 'specs/plans/**']
---
<!-- Clade native rule; source: adapters/claude/instructions/rules/core/manual-review.evidence.md; edit canonical source -->
<!-- clade-targets: claude -->

# Claude evidence transport

Claude uses its native `Skill` and `Agent` surfaces for evidence collection, while the shared parser-facing `#N` / `#N.M`, kind, marker, freshness, and annotation contracts remain authoritative. `AskUserQuestion` may collect the user's decision on a `review:ui` item after Claude has collected the permitted evidence; it does not change item ownership.
