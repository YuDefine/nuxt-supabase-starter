---
name: "clade-security"
description: "Authentication, secrets, production access, and security boundary rules. Use when changing identity, authorization, credentials, production MCP access, or user lifecycle behavior."
---

# clade-security

逐條對照你接下來要做的事；條件成立才讀那一份，NEVER 先把整批讀進來。

- READ 若要讀或改 `app/**/*.ts`、`packages/*/app/**/*.ts`、`app/**/*.vue`、`packages/*/app/**/*.vue`、`supabase/migrations/**/*.sql`、`server/api/**/*.ts` 等 9 處（全表見 rules/_index.md），讀取 `rules/auth-data-path-consistency.md`
- READ 若要讀或改 `app/**/*.{vue,ts}`、`packages/*/app/**/*.{vue,ts}`、`server/**/*.ts`、`packages/*/server/**/*.ts`，讀取 `rules/auth.md`
- READ 若要讀或改 `server/routes/auth/**/*dev-login*.ts`、`server/routes/auth/**/*test-login*.ts`、`server/api/_dev/**/*.ts`、`packages/*/server/routes/auth/**/*dev-login*.ts`、`packages/*/server/routes/auth/**/*test-login*.ts`、`packages/*/server/api/_dev/**/*.ts` 等 12 處（全表見 rules/_index.md），讀取 `rules/dev-login.md`
- READ 若要讀或改 `.mcp.json`、`.claude/settings.json`、`.claude/settings.local.json`、`.codex/config.toml`、`.cursor/cli.json`，讀取 `rules/prod-mcp-safety.enforcement.md`
- READ 若要讀或改 `.github/workflows/**/*.yml`、`wrangler.toml`、`wrangler.jsonc`，讀取 `rules/secrets.md`
- READ 若要讀或改 `SECURITY.md`、`packages/*/SECURITY.md`、`server/middleware/**`、`packages/*/server/middleware/**`、`supabase/migrations/**/*.sql`、`server/database/migrations/**/*.sql` 等 8 處（全表見 rules/_index.md），讀取 `rules/security-policy.md`
- READ 若要讀或改 `server/api/**/user*`、`packages/*/server/api/**/user*`、`server/api/**/admin/user*`、`packages/*/server/api/**/admin/user*`、`supabase/migrations/**/*.sql`、`server/database/migrations/**/*.sql` 等 7 處（全表見 rules/_index.md），讀取 `rules/user-lifecycle.md`

## 本 skill 啟用即讀（尚未宣告觸發點）
- READ `rules/prod-mcp-safety.md`
- READ `rules/secret-custody.md`

rule 內文只經本 skill 載入；清單不能代替內文。
