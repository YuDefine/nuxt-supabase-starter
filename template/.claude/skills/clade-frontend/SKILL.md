---
name: "clade-frontend"
description: "Frontend, interaction, accessibility, localization, and UX integrity rules. Use when changing UI, forms, display values, interactions, translations, or visual completeness."
---

# clade-frontend

逐條對照你接下來要做的事；條件成立才讀那一份，NEVER 先把整批讀進來。

- READ 若要讀或改 `app/**/*.{vue,ts}`、`packages/*/app/**/*.{vue,ts}`、`server/**/*.ts`、`packages/*/server/**/*.ts`、`test/**/*.ts`、`packages/*/test/**/*.ts` 等 9 處（全表見 rules/_index.md），讀取 `rules/development.md`
- READ 若要讀或改 `server/**/*.ts`、`packages/*/server/**/*.ts`、`app/composables/**/*.ts`、`packages/*/app/composables/**/*.ts`，讀取 `rules/display-value-integrity.md`
- READ 若要讀或改 `**/composables/**rag*.ts`、`**/composables/**ove*.ts`、`**/composables/**esize*.ts`、`**/composables/**ort*.ts`、`**/components/**rag*.vue`、`**/composables/*schedule*/**` 等 7 處（全表見 rules/_index.md），讀取 `rules/drag-interaction.md`
- READ 若要讀或改 `DESIGN.md`、`docs/decisions/**`、`app/**/*.{vue,ts,tsx,jsx}`、`packages/*/app/**/*.{vue,ts,tsx,jsx}`、`components/**/*.{vue,ts,tsx,jsx}`、`packages/*/components/**/*.{vue,ts,tsx,jsx}` 等 14 處（全表見 rules/_index.md），讀取 `rules/i18n-boundary.md`
- READ 若要讀或改 `**/*.vue`、`app/**/*.ts`、`packages/*/app/**/*.ts`、`server/**/*.ts`、`packages/*/server/**/*.ts`、`composables/**` 等 13 處（全表見 rules/_index.md），讀取 `rules/nuxt-data-perf.md`
- READ 若要讀或改 `nuxt.config.*`、`vite.config.*`、`package.json`、`scripts/dev-session*`、`vendor/scripts/dev-session*`，讀取 `rules/nuxt-dev-watch.md`
- READ 若要讀或改 `app/**/*.vue`、`packages/*/app/**/*.vue`、`components/**/*.vue`、`packages/*/components/**/*.vue`、`pages/**/*.vue`、`packages/*/pages/**/*.vue`，讀取 `rules/nuxt-error-localization.md`
- READ 若要讀或改 `app/**/*.vue`、`packages/*/app/**/*.vue`、`components/**/*.vue`、`packages/*/components/**/*.vue`、`pages/**/*.vue`、`packages/*/pages/**/*.vue`，讀取 `rules/nuxt-form-validation.md`
- READ 若要讀或改 `app/**/*.vue`、`packages/*/app/**/*.vue`、`components/**/*.vue`、`packages/*/components/**/*.vue`、`layouts/**/*.vue`、`packages/*/layouts/**/*.vue` 等 8 處（全表見 rules/_index.md），讀取 `rules/nuxt-overlay-slot.md`
- READ 若要讀或改 `app/**/*.vue`、`packages/*/app/**/*.vue`、`pages/**/*.vue`、`packages/*/pages/**/*.vue`、`components/**/*.vue`、`packages/*/components/**/*.vue` 等 12 處（全表見 rules/_index.md），讀取 `rules/nuxt-review-bans.md`
- READ 若要讀或改 `nuxt.config.ts`，讀取 `rules/nuxt-security.md`
- READ 若要讀或改 `app/**/*.vue`、`packages/*/app/**/*.vue`、`pages/**/*.vue`、`packages/*/pages/**/*.vue`、`components/**/*.vue`、`packages/*/components/**/*.vue` 等 8 處（全表見 rules/_index.md），讀取 `rules/nuxt-ui-conventions.md`
- READ 若要讀或改 `app/**/*.{vue,ts}`、`packages/*/app/**/*.{vue,ts}`、`pages/**/*.vue`、`packages/*/pages/**/*.vue`、`components/**/*.vue`、`packages/*/components/**/*.vue` 等 13 處（全表見 rules/_index.md），讀取 `rules/nuxt-ui-mcp.md`
- READ 若要讀或改 `app/**/*.{vue,ts}`、`packages/*/app/**/*.{vue,ts}`、`pages/**/*.vue`、`packages/*/pages/**/*.vue`、`components/**/*.vue`、`packages/*/components/**/*.vue` 等 8 處（全表見 rules/_index.md），讀取 `rules/nuxt-ui-native-picker-ban.md`
- READ 若要讀或改 `app/app.vue`、`packages/*/app/app.vue`、`app/pages/**/*.vue`、`packages/*/app/pages/**/*.vue`、`pages/**/*.vue`、`packages/*/pages/**/*.vue` 等 12 處（全表見 rules/_index.md），讀取 `rules/page-loading-golden-path.md`
- READ 若要讀或改 `tasks/**`、`specs/plans/**`、`app/**/*.vue`、`packages/*/app/**/*.vue`、`shared/types/**/*.ts`、`packages/*/shared/types/**/*.ts` 等 7 處（全表見 rules/_index.md），讀取 `rules/runtime/ux-completeness.md`
- READ 若要讀或改 `app/**/*.vue`、`packages/*/app/**/*.vue`、`app/**/*.ts`、`packages/*/app/**/*.ts`、`components/**`、`packages/*/components/**` 等 15 處（全表見 rules/_index.md），讀取 `rules/ui-copy-tone.md`
- READ 若要讀或改 `tasks/**`、`specs/plans/**`、`app/**/*.vue`、`packages/*/app/**/*.vue`、`shared/types/**/*.ts`、`packages/*/shared/types/**/*.ts` 等 7 處（全表見 rules/_index.md），讀取 `rules/ux-completeness.md`

rule 內文只經本 skill 載入；清單不能代替內文。
