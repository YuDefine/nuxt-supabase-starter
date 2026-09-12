---
description: Routing Table 的取證層——Cursor readonly sandbox 為什麼擋掉每一個 mutation dispatch（含兩句最常見的開脫與 Red Flags）、grok 擴權的取證狀態、以及「拿數字當降檔理由」的三個陷阱（aggregate 跑分、配額權重 5:2.5:1、class-conditional 差距）。改 Routing Table 任一列、動 pi-routing-*.ts / pi-dispatch.ts，或要拿任何數字支持一次降檔／轉列時 path-scoped 載入；判準本身在 [[agent-routing]] § Routing Table，本檔只承載理由與實證
paths:
  [
    '.claude/rules/agent-routing.md',
    'rules/core/agent-routing.md',
    'vendor/scripts/pi-routing-policy.ts',
    'vendor/scripts/pi-routing-gate.ts',
    'vendor/scripts/pi-dispatch.ts',
  ]
---
<!-- Clade native rule; source: adapters/cursor/instructions/rules/core/agent-routing.routing-table-rationale.md; edit canonical source -->

<!-- clade-targets: cursor -->

# Cursor native evidence boundary

Cursor's readonly sandbox, Task catalog, and `cursor-ide-browser` observations are target-specific evidence. Keep the mutation admission rule, historical sandbox findings, and unresolved native capability claims explicit; do not generalize a Cursor observation to another runtime.
