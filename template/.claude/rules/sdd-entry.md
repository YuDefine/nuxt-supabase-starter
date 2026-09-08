---
description: 適用於已 onboard repo 收到新需求或續跑需求時，先由 clade-onboard 確認 manifest、readiness 與 capability，再交給 sdd-start；不適用於純 onboard 狀態、readiness 或 registry drift 查詢。
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/sdd-entry.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


<!-- clade-targets: claude,codex,cursor -->

# SDD 新工作入口

已 onboard 的 repo 收到新需求或要續跑未完成需求時，MUST 先進 `clade-onboard` 的「manifest 已存在」判定，再交給 `sdd-start` 分類與續跑。`sdd-start` 的輸出是需求類型、package／免 package 理由、下一支 skill、缺少前提與 UI checkpoint。

純 onboard 狀態查詢、readiness 稽核或 registry drift 處理留在 `clade-onboard`；`sdd-start` 不提前執行 UI、規格或實作步驟。缺少 `aixbdd` capability 或入口尚未同步時，先回報缺口並完成適用的同步流程。
