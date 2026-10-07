---
name: "clade-delivery"
description: "Commit, CI, release, and repository delivery rules. Use when committing, changing CI, preparing delivery, or handling repository state."
---

# clade-delivery

逐條對照你接下來要做的事；條件成立才讀那一份，NEVER 先把整批讀進來。

- READ 若要讀或改 `.github/workflows/**`、`.github/actions/**`，讀取 `rules/ci-workflow.md`
- READ 若要讀或改 `HANDOFF.md`、`tasks/**`、`.clade/claims/**`、`.clade/work-loop/**`，讀取 `rules/commit.detail.md`
- READ 若要讀或改 `tasks/**`、`specs/plans/**`、`docs/plans/**`，讀取 `rules/commit.trunk-gates.md`
- READ 若要讀或改 `vendor/scripts/wt-batch.ts`、`capabilities/core/skills/commit/**`、`capabilities/core/skills/wt/**`、`capabilities/core/skills/handoff/**`、`capabilities/core/skills/gh-ci-watch/**`、`.github/workflows/**` 等 8 處（全表見 rules/_index.md），讀取 `rules/github-flow.md`
- READ 若要讀或改 `.github/workflows/**`、`registry/consumers.json`，讀取 `rules/self-hosted-runner.md`

## 本 skill 啟用即讀（尚未宣告觸發點）
- READ `rules/commit.md`

rule 內文只經本 skill 載入；清單不能代替內文。
