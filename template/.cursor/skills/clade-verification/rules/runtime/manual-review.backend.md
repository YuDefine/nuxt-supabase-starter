---
description: Manual Review backend 規約——backend-only change 特別規約 + 標準流程（含 verify channel baseline）；動 server / test / e2e / supabase 時 path-scoped 載入
paths: ['server/**/*.ts', 'packages/*/server/**/*.ts', 'test/**/*.ts', 'packages/*/test/**/*.ts', 'e2e/**/*.ts', 'packages/*/e2e/**/*.ts', 'supabase/**']
---
<!-- Clade native rule; source: adapters/cursor/instructions/rules/core/manual-review.backend.md; edit canonical source -->
<!-- clade-targets: cursor -->

# Cursor native backend verification operations

Cursor runs project `Playwright` specs for repeatable e2e checks, uses native IDE commands for API recipes where the project contract permits, and uses `cursor-ide-browser` for final-state UI observation. Browser observations and evidence-store writes stay separate from mutation and multi-role login.

Before any channel, verify the consumer baseline, dev-login route, seed fixture, env, and command contract in the native session. Missing capabilities remain blocked with the shared fallback trail.
