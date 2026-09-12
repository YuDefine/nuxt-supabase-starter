---
description: 高擴散半徑改動（跨 consumer 共用 SoT / migration / auth 路徑 / 共用 util）在 publish 或 commit 前 MUST 派 fresh-context checker subagent 複核——只讀 diff + spec，產出 PASS/FAIL + finding；gate 全綠是派 checker 的前置條件不是複核項；其餘任務不派
paths: ['rules/core/**', 'vendor/scripts/**', 'plugins/hub-core/**', 'claude-md/**', '.claude/rules/**', '.claude/skills/**', '**/migrations/**', 'shared/**', 'packages/*/shared/**', 'server/utils/**', 'packages/*/server/utils/**']
---
<!-- Clade native rule; source: adapters/cursor/instructions/rules/core/checker-subagent.md; edit canonical source -->

<!-- clade-targets: cursor -->
<!-- extracted-from: rules/core/checker-subagent.md -->

# Cursor checker transport

**Cursor runtime**：本節的 `Agent` tool 是 Claude Code 的 Agent，**NEVER** 改用 Cursor Task 的非 grok-4.6 `model` 充當 checker。改走 [[agent-routing]] § Cursor runtime 主線 residency 的 Herdr create-only `--launcher cc`／`ccw`。

