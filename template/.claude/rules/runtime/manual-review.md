---
description: 人工檢查（Manual Review）主檔——核心 invariant、Item Kind Marker、annotation schema、Parent State Derivation、Post-Edit Gate；有 active spectra change（動 openspec/changes/**）時載入
paths: ['tasks/**', 'specs/plans/**', 'screenshots/**']
---
<!-- Clade native rule; source: adapters/claude/instructions/rules/core/manual-review.md; edit canonical source -->
<!-- clade-targets: claude -->

# Claude native manual-review operations

Claude Code owns the automated triage and evidence preparation. Use the approved `Agent`/`agent-browser` carrier for self-collection, and use the native question surface only for the shared fallback path that genuinely needs a decision. The review GUI remains the user acceptance surface; Claude may write the documented evidence annotations but does not turn visual evidence into user acceptance.

The `claude-discussed` annotation is valid only after the archive walkthrough presented evidence and received an explicit answer. Preserve item kind, checkbox ownership, and conflict-aware writes from the common contract.
