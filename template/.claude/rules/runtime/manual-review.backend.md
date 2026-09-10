---
description: Manual Review backend 規約——backend-only change 特別規約 + 標準流程（含 verify channel baseline）；動 server / test / e2e / supabase 時 path-scoped 載入
paths: ['server/**/*.ts', 'packages/*/server/**/*.ts', 'test/**/*.ts', 'packages/*/test/**/*.ts', 'e2e/**/*.ts', 'packages/*/e2e/**/*.ts', 'supabase/**']
---
<!-- Clade native rule; source: adapters/claude/instructions/rules/core/manual-review.backend.md; edit canonical source -->
<!-- clade-targets: claude -->

# Claude native backend verification operations

Claude Code writes and runs the approved `Playwright` verification spec for e2e checks, executes the sanctioned curl/ofetch recipe for API checks, and dispatches the approved `Agent` in verify mode for final-state UI observation. Each channel writes its own evidence-store receipt; the UI observer does not mutate data or perform multi-role login.

Before any channel, the Claude session verifies the consumer baseline, dev-login route, seed fixture, env, and CLI contract. A missing baseline follows the shared scaffold/fallback policy and retains a complete failure trail.
