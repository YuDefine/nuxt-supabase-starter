---
name: "clade-operations"
description: "Runtime, deployment, local service, and infrastructure rules. Use when changing Cloudflare, Nitro, APIs, tunnels, ports, service URLs, or operational configuration."
---

# clade-operations

逐條對照你接下來要做的事；條件成立才讀那一份，NEVER 先把整批讀進來。

- READ 若要讀或改 `server/api/**/*.ts`、`packages/*/server/api/**/*.ts`，讀取 `rules/api-patterns.md`
- READ 若要讀或改 `wrangler.{toml,jsonc}`、`void.json`、`nuxt.config.*`、`package.json`、`.github/workflows/**/*.yml`，讀取 `rules/cloudflare-workers.md`
- READ 若要讀或改 `sentry*.config.*`、`**/sentry*.ts`、`nuxt.config.*`、`Dockerfile`、`**/Dockerfile`、`wrangler.toml` 等 11 處（全表見 rules/_index.md），讀取 `rules/deploy-env-identity.md`
- READ 若要讀或改 `package.json`、`nuxt.config.ts`、`registry/consumers.json`、`registry/consumers.schema.json`，讀取 `rules/dev-port-allocation.md`
- READ 若要讀或改 `nuxt.config.*`、`.env`、`.env.local`、`package.json`，讀取 `rules/dev-tunnel-convention.md`
- READ 若要讀或改 `nuxt.config.*`、`server/**/*.ts`、`packages/*/server/**/*.ts`、`packages/**/server/**/*.ts`、`.github/workflows/**`、`**/*.env.example` 等 8 處（全表見 rules/_index.md），讀取 `rules/service-url-locality.md`
- READ 若要讀或改 `nuxt.config.*`、`vite.config.*`、`package.json`、`vendor/doctor-shared/**`、`packages/**/nuxt.config.*`、`packages/**/package.json`，讀取 `rules/vite-doctor.md`

rule 內文只經本 skill 載入；清單不能代替內文。
