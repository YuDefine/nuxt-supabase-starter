---
description: Runtime adapter fragment for handoff.md
paths: ['HANDOFF.md', 'tasks/**', 'specs/plans/**']
---
<!-- Clade native rule; source: adapters/cursor/instructions/rules/core/handoff.md; edit canonical source -->
<!-- clade-targets: cursor -->

# Runtime adapter: Cursor

Cursor has no automatic session-start hook in the declared surface, so run the handoff drift scan as an explicit entry check before continuing. When a clean successor session is required, use the common create-only handoff transport for a Cursor workspace; do not call a bounded native task as a substitute for the durable handoff. Preserve the durable task and report the exact launcher or workspace preflight error if transport is unavailable.
