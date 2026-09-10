---
description: UI / design 工作的 Design Checkpoint、design skill 觸發順序、Design Review template、Design Gate、Cross-Change holistic review 與非 UI exception；動 UI 檔或寫 design artifact 時 path-scoped 載入
paths: ['app/**/*.vue', 'packages/*/app/**/*.vue', 'app/**/*.ts', 'packages/*/app/**/*.ts', 'components/**', 'packages/*/components/**', 'pages/**', 'packages/*/pages/**', 'layouts/**', 'packages/*/layouts/**', 'specs/plans/**', 'docs/specs/**/spec.md']
---
<!-- Clade native rule; source: adapters/claude/instructions/rules/core/proactive-skills.design-checkpoint.md; edit canonical source -->
<!-- clade-targets: claude -->

# Claude design checkpoint transport

Run the design workflow through Claude's native `/design` and `/impeccable` Skills. A screenshot or design-review delegation uses the configured Claude `Agent` surface and must return the model, workspace, tool, and completion receipt required by the common gate. The Skill and Agent names are transport details; the common workflow, fidelity loop, audit result, and non-UI exception remain binding.
