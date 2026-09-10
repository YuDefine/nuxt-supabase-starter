---
description: Dev Server Auto-Spawn 規約——agent 自起 dev server 的持久層、lease、port 分流、tunnel 規範
paths: ['scripts/dev-session*', 'vendor/scripts/dev-session*', '.claude/consumer-meta.json', 'nuxt.config.*']
---
<!-- Clade native rule; source: adapters/claude/instructions/rules/core/proactive-skills.dev-server-spawn.md; edit canonical source -->
<!-- clade-targets: claude -->

# Claude dev-server transport

Claude starts and inspects the durable server with `node scripts/dev-session.ts`; the wrapper owns the Herdr tab, lease, port, and worktree checks. A separate Claude Code session uses `vendor/scripts/herdr-session-handoff.ts` when the workflow explicitly requires it. `run_in_background` is not a durable-server mechanism and cannot replace the wrapper. Report the wrapper receipt and the target URL before handing a review surface to the user.
