---
description: flow spine 的 work 生命週期契約——一件 work 何時誕生、誰鑄名、`work.done` 的憑證強度、驗收由誰按；動到 vendor/scripts/flow/** 或 .clade/flow/** 時 path-scoped 載入
paths:
  - 'vendor/scripts/flow/**'
  - '.clade/flow/**'
  - 'vendor/review-gui-web/pages/board.vue'
---
<!-- Clade native rule; source: adapters/claude/instructions/rules/core/flow-work-tracking.md; edit canonical source -->

<!-- clade-targets: claude -->

# Claude native flow telemetry

Claude Code currently supplies the connected `session_summary` collector: `session-start-stalled.sh` invokes `transcript-summary.ts`, which reads the Claude transcript at `~/.claude/projects/<slug>/<session_id>.jsonl`. Record this as Claude Code evidence only; the transcript `version` field is a Claude Code version. A hook invocation or summary event does not certify another runtime's producer.

For R3, the attended-session consumer is the configured `session-start-stalled.sh` entry, which runs `flow status --stalled` and carries the receipt into the session. The Claude projection carries this source's loading path for `vendor/scripts/flow/**`; the common rule remains the source of the orphan threshold and warning semantics.
