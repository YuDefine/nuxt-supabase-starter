---
description: 進入 tasks.md `## 人工檢查` 階段的入口規約——auto-triage 三類 pending item 的推進路徑、mechanical readiness gate 的 exit code 判讀、交付入口前置查詢（先問服務不問 config）、review-gui 引導與 fallback、`[discuss]` item 的歸屬
paths: ['tasks/**', 'specs/plans/**', 'screenshots/**']
---
<!-- Clade native rule; source: adapters/cursor/instructions/rules/core/proactive-skills.manual-review-entry.md; edit canonical source -->
<!-- clade-targets: cursor -->

# Cursor manual-review entry transport

Cursor performs readiness and service/API queries through its native Task/Agent terminal entry, then opens the returned review-gui deep link with the Cursor IDE browser when available. Cursor has no verified native review-gui decision writer in this adapter. If the IDE browser or input surface is unavailable, report the gap and preserve user-owned checkbox state.
