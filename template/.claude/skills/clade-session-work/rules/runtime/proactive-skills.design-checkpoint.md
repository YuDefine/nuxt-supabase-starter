---
description: UI 工作的 impeccable 修改閉環（找問題 → 專科修 → 沉澱）、P0–P3 問題族 × 專科指令對照、Design Review tasks 模板、design-review.md 證據與 Design Gate、非 UI exception；動 UI 檔或寫 design artifact 時 path-scoped 載入
paths: ['app/**/*.vue', 'packages/*/app/**/*.vue', 'app/**/*.ts', 'packages/*/app/**/*.ts', 'components/**', 'packages/*/components/**', 'pages/**', 'packages/*/pages/**', 'layouts/**', 'packages/*/layouts/**', 'specs/plans/**', 'docs/specs/**/spec.md']
---
<!-- Clade native rule; source: adapters/claude/instructions/rules/core/proactive-skills.design-checkpoint.md; edit canonical source -->
<!-- clade-targets: claude -->

# Claude design checkpoint transport

Run the closed loop through Claude's native `/impeccable` Skill; a bare `/impeccable` gives the context-aware next-command recommendation. The hub-core plugin registers impeccable's detector hook (`PostToolUse` Edit|Write and `Stop`), so mechanical findings arrive after each UI edit. A screenshot or design-review delegation uses the configured Claude `Agent` surface and must return the model, workspace, tool, and completion receipt required by the common gate. The Skill and Agent names are transport details; the shared loop stages, `design-review.md` evidence, and non-UI exception remain binding.
