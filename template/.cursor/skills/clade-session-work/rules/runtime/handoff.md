---
description: Runtime adapter fragment for handoff.md
paths: ['HANDOFF.md', 'tasks/**', 'specs/plans/**']
---
<!-- Clade native rule; source: adapters/cursor/instructions/rules/core/handoff.md; edit canonical source -->
<!-- clade-targets: cursor -->

# Runtime adapter: Cursor

Cursor has no automatic session-start hook in the declared surface, so run the handoff drift scan as an explicit entry check before continuing.

In Cursor (IDE Agent / Projects), parallel work is **multitask** (Project workers / CreateAgent), not `/handoff fanout`. Implementation workers prefer `swe-2-max`, fallback `composer-2.5` (never Composer-first; omit `swe-2-max` when it is not in the live Cursor catalog). Planning, inventory, and coordination stay on the Project Grok main line. Bare `/handoff` that would land on fanout stays in the Project and multitasks; do not 收工 or open successor panes. Explicit fanout: multitask or `park`, never Herdr fanout panes. `/handoff next` inventory may run; follow-through is multitask. Claude Code / Herdr keep `/handoff fanout` on that host.

When a clean successor session is required, do not treat `/handoff fanout` or a bounded native task as the Cursor mechanism; stay and multitask, or `park`. Preserve the durable task and report the exact launcher or workspace preflight error if a create-only Herdr transport is actually required and unavailable.

When the Cursor Project coordinator harvests a finished Devin session, close that session's herdr pane in the same harvest. Never leave leftover herdr panes.
