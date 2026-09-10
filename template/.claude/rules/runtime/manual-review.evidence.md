---
description: Manual Review evidence 規約——寫 / 審 tasks.md 的 ## 人工檢查 區塊時 path-scoped 載入
paths: ['tasks/**', 'specs/plans/**', 'docs/manual-review-archive.md']
---
<!-- Clade native rule; source: adapters/claude/instructions/rules/core/manual-review.evidence.md; edit canonical source -->
<!-- clade-targets: claude -->

# Claude evidence transport

Claude uses its native `Skill` and `Agent` surfaces for evidence collection, while the shared parser-facing `#N` / `#N.M`, kind, marker, freshness, and annotation contracts remain authoritative. A `review:ui` item is handed to the shared review-gui surface after Claude has collected the permitted evidence. `AskUserQuestion` is a fallback consent surface only when the review-gui is unavailable; it does not change item ownership.
