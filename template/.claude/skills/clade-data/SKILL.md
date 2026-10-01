---
name: "clade-data"
description: "Database, schema, storage, logging, and data-path rules. Use when changing persistence, migrations, queries, RLS, database environments, or application logging; also before running integration tests, needing a test or dev database, running any supabase CLI command, or deciding where the dev DB lives."
---

# clade-data

逐條對照你接下來要做的事；條件成立才讀那一份，NEVER 先把整批讀進來。

- READ 若要讀或改 `supabase/migrations/**/*.sql`、`server/utils/audit*.ts`、`packages/*/server/utils/audit*.ts`、`server/api/**/*.ts`、`packages/*/server/api/**/*.ts`，讀取 `rules/audit-schema.md`
- READ 若要讀或改 `app/**/*.{vue,ts}`、`packages/*/app/**/*.{vue,ts}`、`server/**/*.ts`、`packages/*/server/**/*.ts`，讀取 `rules/database-access.md`
- READ 若要讀或改 `supabase/migrations/**/*.sql`、`.github/workflows/**/*.yml`、`docker-compose*.yml`、`infra/**/*`、`scripts/dev-session*`、`scripts/worktree-*` 等 8 處（全表見 rules/_index.md），讀取 `rules/db-preview-env.md`
- READ 若要讀或改 `server/**`、`packages/**/server/**`、`specs/plans/*evlog*/**`，讀取 `rules/evlog-adoption.catalogs.md`
- READ 若要讀或改 `specs/plans/**`、`nuxt.config.ts`、`packages/**/nuxt.config.ts`、`server/plugins/evlog-*.ts`、`packages/**/server/plugins/evlog-*.ts`，讀取 `rules/evlog-adoption.decision.md`
- READ 若要讀或改 `evlog.map.json`、`packages/**/evlog.map.json`、`specs/plans/**`、`.github/**`、`server/**`、`packages/**/server/**` 等 8 處（全表見 rules/_index.md），讀取 `rules/evlog-adoption.depth-gate.md`
- READ 若要讀或改 `nuxt.config.ts`、`server/plugins/evlog-*.ts`、`app/plugins/evlog-*.ts`、`packages/**/server/plugins/evlog-*.ts`、`packages/**/app/plugins/evlog-*.ts`、`specs/plans/*evlog*/**`，讀取 `rules/evlog-adoption.md`
- READ 若要讀或改 `server/api/**`、`server/routes/**`、`server/middleware/**`、`server/utils/**`、`packages/*/server/utils/**`、`packages/**/server/api/**` 等 8 處（全表見 rules/_index.md），讀取 `rules/evlog-error-exposure.md`
- READ 若要讀或改 `server/**`、`packages/**/server/**`、`clients/**/server/**`、`layers/**/server/**`、`server/plugins/evlog-*.ts`、`packages/*/server/plugins/evlog-*.ts` 等 8 處（全表見 rules/_index.md），讀取 `rules/evlog-investigate.md`
- READ 若要讀或改 `server/api/**/*.ts`、`server/plugins/evlog-*.ts`、`app/plugins/evlog-*.ts`、`nuxt.config.ts`、`packages/**/server/api/**/*.ts`、`packages/**/server/plugins/evlog-*.ts` 等 7 處（全表見 rules/_index.md），讀取 `rules/evlog-stream-extend.md`
- READ 若要讀或改 `app/**/*.ts`、`app/**/*.vue`、`packages/**/app/**/*.ts`、`packages/**/app/**/*.vue`、`server/utils/**/*.ts`、`packages/**/server/utils/**/*.ts` 等 10 處（全表見 rules/_index.md），讀取 `rules/logging.client-fields.md`
- READ 若要讀或改 `server/plugins/evlog-*.ts`、`packages/**/server/plugins/evlog-*.ts`、`nuxt.config.ts`、`packages/**/nuxt.config.ts`，讀取 `rules/logging.drain-pipeline.md`
- READ 若要讀或改 `server/api/**/*.ts`、`server/routes/**/*.ts`、`server/middleware/**/*.ts`、`server/utils/**/*.ts`、`packages/**/server/api/**/*.ts`、`packages/**/server/routes/**/*.ts` 等 8 處（全表見 rules/_index.md），讀取 `rules/logging.error-contract.md`
- READ 若要讀或改 `server/api/**/*.ts`、`server/plugins/evlog-*.ts`、`app/plugins/evlog-*.ts`、`nuxt.config.ts`、`packages/**/server/api/**/*.ts`、`packages/**/server/plugins/evlog-*.ts` 等 7 處（全表見 rules/_index.md），讀取 `rules/logging.md`
- READ 若要讀或改 `nuxt.config.ts`、`packages/**/nuxt.config.ts`、`server/plugins/evlog-*.ts`、`packages/**/server/plugins/evlog-*.ts`，讀取 `rules/logging.sampling-redaction.md`
- READ 若要讀或改 `supabase/migrations/**/*.sql`、`server/**/*.ts`、`packages/*/server/**/*.ts`，讀取 `rules/mcp-remote.md`
- READ 若要讀或改 `supabase/migrations/**/*.sql`、`server/**/*.ts`、`packages/*/server/**/*.ts`，讀取 `rules/migration.md`
- READ 若要讀或改 `supabase/migrations/**/*.sql`、`server/api/**/*.ts`、`packages/*/server/api/**/*.ts`，讀取 `rules/query-optimization.md`
- READ 若要讀或改 `supabase/migrations/**/*.sql`，讀取 `rules/rls-policy.md`
- READ 若要讀或改 `server/api/**/*.ts`、`packages/*/server/api/**/*.ts`、`supabase/migrations/**/*.sql`，讀取 `rules/storage.md`
- READ 若要讀或改 `supabase/migrations/**/*.sql`，讀取 `rules/trigger.md`
- READ 若要讀或改 `supabase/migrations/**/*.sql`、`server/**/*.ts`、`packages/*/server/**/*.ts`、`app/**/*.{ts,vue}`、`packages/*/app/**/*.{ts,vue}`，讀取 `rules/unused-features.md`

rule 內文只經本 skill 載入；清單不能代替內文。
