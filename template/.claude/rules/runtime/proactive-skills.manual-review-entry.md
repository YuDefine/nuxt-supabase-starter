---
description: 進入 tasks.md `## 人工檢查` 階段的入口規約——auto-triage 三類 pending item 的推進路徑、mechanical readiness gate 的 exit code 判讀、交付入口前置查詢（先問服務不問 config）、review-gui 引導與 fallback、`[discuss]` item 的歸屬
paths: ['tasks/**', 'specs/plans/**', 'screenshots/**']
---
<!-- Clade native rule; source: adapters/claude/instructions/rules/core/proactive-skills.manual-review-entry.md; edit canonical source -->
<!-- clade-targets: claude -->

# Claude manual-review entry transport

Claude performs auto-triage and runs `node vendor/scripts/check-review-readiness.ts` before using the shared review-gui. It queries `review-gui-service.sh` and the live API with its native shell tool, then returns the API-provided deep link. If GUI fallback is required, `AskUserQuestion` may collect one explicit user response at a time; Claude must not self-check a user-owned checkbox.
