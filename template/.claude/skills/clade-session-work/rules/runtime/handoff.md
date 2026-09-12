---
description: Runtime adapter fragment for handoff.md
paths: ['HANDOFF.md', 'tasks/**', 'specs/plans/**']
---
<!-- Clade native rule; source: adapters/claude/instructions/rules/core/handoff.md; edit canonical source -->
<!-- clade-targets: claude -->

# Runtime adapter: Claude

Claude Code has a verified session-start hook: `session-start-roadmap-sync.sh` runs `scripts/handoff-drift-scan.ts` and reports drift on stderr.

For a cross-session successor, invoke `/handoff relay` (or `/handoff fanout` for independent work) through the canonical `vendor/scripts/herdr-session-handoff.ts` helper. This provisions a fresh Claude session, delivers the durable task, transfers coordinator identity, and records the predecessor receipt. Native `Task`/`Agent` delegation is a bounded phase executor and MUST NOT replace successor transport.
