---
description: 高擴散半徑改動（跨 consumer 共用 SoT / migration / auth 路徑 / 共用 util）在 publish 或 commit 前 MUST 派 fresh-context checker subagent 複核——只讀 diff + spec，產出 PASS/FAIL + finding；gate 全綠是派 checker 的前置條件不是複核項；其餘任務不派
paths: ['rules/core/**', 'vendor/scripts/**', 'plugins/hub-core/**', 'claude-md/**', '.claude/rules/**', '.claude/skills/**', '**/migrations/**', 'shared/**', 'packages/*/shared/**', 'server/utils/**', 'packages/*/server/utils/**']
---
<!-- Clade native rule; source: adapters/claude/instructions/rules/core/checker-subagent.md; edit canonical source -->

<!-- clade-targets: claude -->
<!-- extracted-from: rules/core/checker-subagent.md -->

# Claude checker transport

checker **MUST** 是新開的 subagent（`Agent` tool，非續跑 maker）。**NEVER** 用**繼承主線對話**的 fork 型 subagent 當 checker——user 打的 `/subtask`、以及 `subagent_type: 'fork'`（該 rollout 開啟時）繼承主線完整 message history，等同把 maker 的實作敘事整份附給 checker，fresh context 當場失效（per § Checker brief 模板）。「它字面上也是新開的 subagent」不構成例外。


**checker 的 `model` 刻意省略、繼承主線**——checker 的輸出**本身**就是品質判定，命中
[[agent-routing]] § NEVER 降檔的形狀第 1 條。這是聲明不是疏漏：**NEVER** 拿該檔
§ `subagent_type` 是 `general-purpose` 或 `Explore` 時… 的「MUST 顯式帶檔位」外推到 checker，
**也 NEVER** 把 checker 轉派 codex `--model luna` 或 `--model gemini`。

