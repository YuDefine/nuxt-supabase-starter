---
description: 人工檢查（Manual Review）主檔——核心 invariant、Item Kind Marker、annotation schema、Parent State Derivation、Post-Edit Gate；有 active spectra change（動 openspec/changes/**）時載入
paths: ['tasks/**', 'specs/plans/**', 'screenshots/**']
---
<!-- Clade native rule; source: adapters/cursor/instructions/rules/core/manual-review.md; edit canonical source -->
<!-- clade-targets: cursor -->

# Cursor native manual-review operations

Cursor performs automated triage and visual evidence through `cursor-ide-browser` and native IDE interaction. Use the review GUI as the user acceptance surface; native interaction can prepare evidence but cannot silently flip a user-owned visual checkbox.

Keep item kind, checkbox ownership, annotation schema, and archive timing from the common contract. If the native IDE surface cannot perform the required action, retain the blocked state and its evidence trail.
