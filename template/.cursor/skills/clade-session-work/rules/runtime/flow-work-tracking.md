---
description: flow spine 的 work 生命週期契約——一件 work 何時誕生、誰鑄名、`work.done` 的憑證強度、驗收由誰按；動到 vendor/scripts/flow/** 或 .clade/flow/** 時 path-scoped 載入
paths:
  - 'vendor/scripts/flow/**'
  - '.clade/flow/**'
  - 'vendor/review-gui-web/pages/board.vue'
---
<!-- Clade native rule; source: adapters/cursor/instructions/rules/core/flow-work-tracking.md; edit canonical source -->

<!-- clade-targets: cursor -->

# Cursor native flow telemetry boundary

This source does not establish an automatic Cursor `session_summary` collector. Cursor must use a verified native event or transcript adapter with a recoverable receipt before claiming collection. Desktop, IDE, Web, and CLI entry points are separate capability surfaces; one observed entry cannot certify the others.

The Cursor baseline is its configured native rules delivery; an enhanced session collector is optional and must identify the actual event or transcript source. R3 status consumption remains unresolved until a configured attended-session entry emits a receipt.
