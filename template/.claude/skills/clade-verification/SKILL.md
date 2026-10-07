---
name: "clade-verification"
description: "Verification, testing, review, screenshots, and evidence rules. Use when testing, reviewing, debugging, collecting evidence, or claiming completion."
---

# clade-verification

逐條對照你接下來要做的事；條件成立才讀那一份，NEVER 先把整批讀進來。

- READ 若要讀或改 `.claude/agents/**`、`.github/workflows/**`、`wrangler.{toml,jsonc}`、`Dockerfile`、`.mcp.json`、`vendor/scripts/**` 等 11 處（全表見 rules/_index.md），讀取 `rules/agent-self-verification.claim-cross-check.md`
- READ 若要讀或改 `screenshots/**`、`specs/plans/**/tasks.md`、`app/**/*.vue`、`components/**/*.vue`、`packages/*/components/**/*.vue`、`pages/**/*.vue` 等 13 處（全表見 rules/_index.md），讀取 `rules/agent-self-verification.screenshot-evidence.md`
- READ 若要讀或改 `scripts/audit-reference-query-oracle.ts`、`test/fixtures/reference-oracle/**`、`packages/*/test/fixtures/reference-oracle/**`、`test/audit-reference-query-oracle.test.ts`、`packages/*/test/audit-reference-query-oracle.test.ts`、`vendor/scripts/run-evidence.ts` 等 7 處（全表見 rules/_index.md），讀取 `rules/agent-self-verification.structural-and-exit-evidence.md`
- READ 若要讀或改 `server/api/**/*.ts`、`packages/*/server/api/**/*.ts`、`server/utils/audit.ts`、`packages/*/server/utils/audit.ts`、`supabase/migrations/**/*.sql`，讀取 `rules/audit-pattern.md`
- READ 若要讀或改 `scripts/**/*`、`vendor/scripts/**/*`、`.github/workflows/**/*`、`package.json`、`pnpm-workspace.yaml`，讀取 `rules/checker-contract.md`
- READ 若要讀或改 `rules/core/**`、`vendor/scripts/**`、`capabilities/core/**`、`claude-md/**`、`.claude/rules/**`、`.claude/skills/**` 等 11 處（全表見 rules/_index.md），讀取 `rules/checker-subagent.md`
- READ 若要讀或改 `specs/truth/fixtures.md`、`docs/FIXTURES.md`、`docs/fixtures.md`，讀取 `rules/fixtures-reference.md`
- READ 若要讀或改 `server/**/*.ts`、`packages/*/server/**/*.ts`、`test/**/*.ts`、`packages/*/test/**/*.ts`、`e2e/**/*.ts`、`packages/*/e2e/**/*.ts` 等 7 處（全表見 rules/_index.md），讀取 `rules/manual-review.backend.md`
- READ 若要讀或改 `tasks/**`、`specs/plans/**`、`screenshots/**`，讀取 `rules/manual-review.data-readiness.md`
- READ 若要讀或改 `tasks/**`、`specs/plans/**`，讀取 `rules/manual-review.evidence.md`
- READ 若要讀或改 `tasks/**`、`specs/plans/**`、`screenshots/**`，讀取 `rules/manual-review.md`
- READ 若要讀或改 `playwright.config.ts`、`playwright.config.js`、`**/playwright.config.ts`，讀取 `rules/playwright-webserver.md`
- READ 若要讀或改 `specs/plans/**`、`specs/truth/**`、`.claude/agents/**`、`.codex/agents/**`、`supabase/migrations/**/*.sql`、`server/database/migrations/**/*.sql` 等 8 處（全表見 rules/_index.md），讀取 `rules/review-tiers.md`
- READ 若要讀或改 `screenshots/**`、`specs/plans/**/tasks.md`、`app/**/*.vue`、`components/**/*.vue`、`packages/*/components/**/*.vue`、`pages/**/*.vue` 等 13 處（全表見 rules/_index.md），讀取 `rules/runtime/agent-self-verification.screenshot-evidence.md`
- READ 若要讀或改 `rules/core/**`、`vendor/scripts/**`、`capabilities/core/**`、`claude-md/**`、`.claude/rules/**`、`.claude/skills/**` 等 11 處（全表見 rules/_index.md），讀取 `rules/runtime/checker-subagent.md`
- READ 若要讀或改 `server/**/*.ts`、`packages/*/server/**/*.ts`、`test/**/*.ts`、`packages/*/test/**/*.ts`、`e2e/**/*.ts`、`packages/*/e2e/**/*.ts` 等 7 處（全表見 rules/_index.md），讀取 `rules/runtime/manual-review.backend.md`
- READ 若要讀或改 `tasks/**`、`specs/plans/**`、`screenshots/**`，讀取 `rules/runtime/manual-review.data-readiness.md`
- READ 若要讀或改 `tasks/**`、`specs/plans/**`，讀取 `rules/runtime/manual-review.evidence.md`
- READ 若要讀或改 `tasks/**`、`specs/plans/**`、`screenshots/**`，讀取 `rules/runtime/manual-review.md`
- READ 若要讀或改 `screenshots/**`、`tests/e2e/**`、`packages/*/tests/e2e/**`、`specs/plans/**/design-review.md`，讀取 `rules/runtime/screenshot-strategy.md`
- READ 若要讀或改 `.claude/consumer-meta.json`、`scripts/dev-session*`、`scripts/dev-singleton*`、`nuxt.config.*`、`packages/**/nuxt.config.*`，讀取 `rules/runtime/verification-lease.spec.md`
- READ 若要讀或改 `screenshots/**`、`tests/e2e/**`、`packages/*/tests/e2e/**`、`specs/plans/**/design-review.md`，讀取 `rules/screenshot-strategy.md`
- READ 若要讀或改 `package.json`、`vitest.config.ts`、`vite.config.ts`，讀取 `rules/test-scripts.md`
- READ 若要讀或改 `test/**/*.ts`、`packages/*/test/**/*.ts`、`e2e/**/*.ts`、`packages/*/e2e/**/*.ts`、`vitest.config.*`、`packages/*/vitest.config.*` 等 9 處（全表見 rules/_index.md），讀取 `rules/testing-anti-patterns.md`
- READ 若要讀或改 `specs/**`、`tasks/**`、`ROADMAP.md`、`docs/decisions/**`、`server/**/*.ts`、`packages/*/server/**/*.ts` 等 11 處（全表見 rules/_index.md），讀取 `rules/truth-layers.md`
- READ 若要讀或改 `.claude/consumer-meta.json`、`scripts/dev-session*`、`scripts/dev-singleton*`、`nuxt.config.*`、`packages/**/nuxt.config.*`，讀取 `rules/verification-lease.spec.md`
- READ 若要讀或改 `**/*.ts`、`**/*.vue`、`**/*.tsx`、`tasks/**`、`specs/**`、`package.json` 等 9 處（全表見 rules/_index.md），讀取 `rules/verify-gate-chain.md`

## 本 skill 啟用即讀（尚未宣告觸發點）
- READ `rules/agent-self-verification.md`
- READ `rules/runtime/agent-self-verification.md`
- READ `rules/verification-lease.md`

rule 內文只經本 skill 載入；清單不能代替內文。
