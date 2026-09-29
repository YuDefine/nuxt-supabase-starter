---
name: "clade-code-quality"
description: "Code quality, error handling, shell safety, language, and maintainability rules. Use when implementing or refactoring code, scripts, or language-specific components."
---

# clade-code-quality

逐條對照你接下來要做的事；條件成立才讀那一份，NEVER 先把整批讀進來。

- READ 若要讀或改 `**/*.{js,ts,vue,jsx,tsx,mjs,cjs,mts,cts}`，讀取 `rules/code-style.md`
- READ 若要讀或改 `vite.config.*`、`nuxt.config.*`、`package.json`、`packages/*/package.json`、`pnpm-workspace.yaml`、`tsconfig*.json` 等 13 處（全表見 rules/_index.md），讀取 `rules/code-style.toolchain.md`
- READ 若要讀或改 `**/*.{ts,tsx,mts,cts,vue}`，讀取 `rules/coupling-cohesion.md`
- READ 若要讀或改 `app/**/*.{vue,ts}`、`packages/*/app/**/*.{vue,ts}`、`server/**/*.ts`、`packages/*/server/**/*.ts`，讀取 `rules/error-handling.md`
- READ 若要讀或改 `**/*.sh`、`ops/**`、`deploy/**`、`scripts/**`，讀取 `rules/shell-script-safety.md`

## 本 skill 啟用即讀（尚未宣告觸發點）
- READ `rules/runtime/threshold-remediation.md`
- READ `rules/threshold-remediation.md`

rule 內文只經本 skill 載入；清單不能代替內文。
