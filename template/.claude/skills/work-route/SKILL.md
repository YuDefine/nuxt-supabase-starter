---
name: work-route
description: Use when the user wants to start or continue project work (new requirement, bug report, or refactor) without picking workflow skills. NOT for fleet readiness or registry drift queries (clade-onboard).
license: MIT
metadata: {"author":"clade","version":"1.0","clade":{"permission_tier":"action"}}
---


<!-- clade-workflow-bundles: ["spec-by-example","technical-research","ui-plan","api-plan","data-plan","dsl-refine","gherkin-and-dsl","tasks","bdd","truth-delta","clarify-over-specs","specformula-config","specformula-api-spec","specformula-entity-spec","specformula-feature"] -->

# work-route（統一工作入口）

使用者描述想完成的工作即可。本 skill 持有從需求到驗收、交付的接續責任：定位同一工作、載入正確 owner 的契約、執行已授權步驟、處理可修復前提，再依結果繼續；不是只列出「下一支 skill」的導航頁，也不由 router 冒充 owner 或跳過驗收。

每一步只讀該步命中的判準檔（路徑相對本 skill 根：Claude `.claude/skills/work-route/`、Codex `.agents/skills/work-route/`），**NEVER** 一次讀完全部 `rules/`。

- 入口. READ 若收到需求（新工作、bug、重構、續跑、狀態查詢），讀取 `rules/需求分流與免package.md`，取處理列與 `work_kind`。
- 第 0 步. READ 若接下來會寫任何檔（含 constitution 修補、免 package、調查證據、package 骨架），讀取 `rules/worktree隔離與work-id.md`，先過 worktree isolation gate。
- 第 1 步. READ 若要續跑既有工作、提出方案或鑄新 work id，讀取 `rules/定位既有工作與鑄id.md`。READ 若要開 package 或改判工作種類，讀取 `rules/工作種類與必要產物.md`。
- 第 2 步. READ 若要載入任何下游 owner，**每一次**先讀取 `rules/上游覆寫-lifecycle落點與doctor.md`，再讀取 `rules/owner載入與代打.md`（owner 位置表、explicit 入口代打、clade overlay、SpecFormula 契約）。READ 若要交棒給 owner，讀取 `owner-routing.md` 決定執行者。
- 第 3 步. READ 若 owner 的輸入前提缺失，或 `vp check`／typecheck／lint／測試失敗，讀取 `rules/前提修復與gate失敗.md`。
- 第 4 步. READ 若要判定 package 的下一步，讀取 `rules/依產物推進.md`，處理第一個未完成項目（先過第 2–3 步），做完回本步。
- 第 5 步. READ 若 tasks 全部完成、要驗收、開 PR、交付或回報，讀取 `rules/驗收交付與回報.md`。

預設持續推進到使用者要求的成果完成，或到必要的人類決策／不可自行解除的外部阻塞。
