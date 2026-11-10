---
name: "clade-spec-workflow"
description: "Specification and requirements workflow rules. Use when work involves SDD, BDD, SpecFormula, decisions, structured plans, or pre-BDD legacy tests."
---

# SOP

## Phase 1 -- 用任務挑出要讀的 rule

1. READ 逐條對照接下來要做的事：條件成立才把該 rule 列入候選，NEVER 整批讀。
   - `rules/aixbdd-workflow.md`：aixbdd 需求到實作的 workflow 契約——plan package 是唯一迭代單位、truth 只由 truth owner skill 改、PM/RD 兩側入口順序、與 SpecFormula 的分工；且碰 `specs/plans/**`、`specs/truth/**`、`.agents/constitution/**`
   - `rules/legacy-tests.md`：宣告 aixbdd 的 consumer 裡，導入 BDD 之前留下的舊測試——凍結、只減不增、工作碰到就吸收；新測試與迴歸的落點；且碰 `**/*.test.*`、`**/*.spec.*`、`vitest.config.*` 等 5 處
   - `rules/specformula.md`：SpecFormula BDD/SDD 框架的 fleet 採用契約——spec-first 順序、embedded／PostgreSQL 資料源判定、framework-neutral HTTP／test-control seam、業務時鐘單一來源、hosted Supabase 的 SSL 阻斷；且碰 `specs/truth/contracts/**`、`specs/truth/features/**`、`specs/truth/data/**` 等 12 處

## Phase 2 -- 只讀候選 rule 中與任務相關的段落

1. READ `rules/_sections.md` 中候選 rule 的區塊（首行 `<file> — `、空行結束；用 Grep 加 `-A 40` 取（區塊最長約 38 行，讀到空行為止，其後是下一份 rule 的區塊），NEVER 整份讀索引），只挑與任務相關的段落，用 Read 的 offset／limit 讀該行號區間。
2. READ 標題看不出相關與否的 rule 才整份讀；NEVER 用條件清單或段落索引代替 rule 內文。
