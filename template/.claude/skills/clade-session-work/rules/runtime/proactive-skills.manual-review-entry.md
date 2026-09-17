---
description: 進入 tasks.md `## 人工檢查` 階段的入口規約——auto-triage 三類 pending item 的推進路徑、`flow gates` 的 exit code 判讀、交付入口前置查詢（先問服務不問 config）、面板引導與 fallback、`[discuss]` item 的歸屬
paths: ['tasks/**', 'specs/plans/**', 'screenshots/**']
---
<!-- Clade native rule; source: adapters/claude/instructions/rules/core/proactive-skills.manual-review-entry.md; edit canonical source -->
<!-- clade-targets: claude -->

# Claude manual-review entry transport

Claude performs auto-triage and runs `flow gates --repo-only --require-empty` before pointing anyone at the shared control panel. It queries `review-gui-service.sh status` with its native shell tool, then returns the link from `pnpm review:ui --print`. If panel fallback is required, `AskUserQuestion` may collect one explicit user response at a time; Claude must not self-check a user-owned checkbox.
