---
description: 進入 tasks.md `## 人工檢查` 階段的入口規約——auto-triage 三類 pending item 的推進路徑、`flow gates` 的 exit code 判讀、`[review:ui]` item 敘述的 URL 階梯、`[discuss]` item 的歸屬
paths: ['tasks/**', 'specs/plans/**', 'screenshots/**']
---
<!-- Clade native rule; source: adapters/cursor/instructions/rules/core/proactive-skills.manual-review-entry.md; edit canonical source -->
<!-- clade-targets: cursor -->

# Cursor manual-review entry transport

Cursor runs `flow gates --repo-only --require-empty` through its native Task/Agent terminal entry. Cursor has no verified native decision writer in this adapter. If the input surface is unavailable, report the gap and preserve user-owned checkbox state.
