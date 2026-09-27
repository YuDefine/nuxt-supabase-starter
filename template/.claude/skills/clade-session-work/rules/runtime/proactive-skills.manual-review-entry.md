---
description: 進入 tasks.md `## 人工檢查` 階段的入口規約——auto-triage 三類 pending item 的推進路徑、`flow gates` 的 exit code 判讀、`[review:ui]` item 敘述的 URL 階梯、`[discuss]` item 的歸屬
paths: ['tasks/**', 'specs/plans/**', 'screenshots/**']
---
<!-- Clade native rule; source: adapters/claude/instructions/rules/core/proactive-skills.manual-review-entry.md; edit canonical source -->
<!-- clade-targets: claude -->

# Claude manual-review entry transport

Claude performs auto-triage and runs `flow gates --repo-only --require-empty` before presenting any card to anyone. `AskUserQuestion` may collect one explicit user response at a time; Claude must not self-check a user-owned checkbox.
