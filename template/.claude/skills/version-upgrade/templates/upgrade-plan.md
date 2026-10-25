# 版本升級計畫：{{ROUTE}}（{{SCOPE_TARGET}}）

- 產出時間：{{GENERATED_AT}}
- route：`{{ROUTE}}`（`mode_route.py` 輸出；複選時每段一份計畫檔）
- 盤點指令：`{{INVENTORY_COMMAND}}`
- worktree：{{WORKTREE_PATH}}
- 承載工作：{{WORK_ID}}
- 續跑：`uv run <skill 根目錄>/scripts/mode_route.py --plan <本檔> --cwd <worktree>`；`狀態` 欄是 `pending`／`in-progress`／`blocked` 的第一列就是續跑起點

<!-- 狀態值只用：pending、in-progress、blocked、done、skipped、failed。前三個算未完成；mode_route.py 只認「狀態」這個欄名 -->

## 逐項（Phase B–D／K）

<!-- 每列一個 item 或家族（rules/批次分組判準.md）；分類取 rules/changelog分類判準.md；Phase C 每做完一列 MUST 立刻更新本列 -->

| item | kind | 現版 → 目標版 | 分類 | 狀態 | checkpoint | 證據 |
| --- | --- | --- | --- | --- | --- | --- |
| {{ITEM}} | {{KIND}} | {{FROM}} → {{TO}} | {{CATEGORY}} | {{ROW_STATUS}} | {{CHECKPOINT_SHA}} | {{EVIDENCE}} |

## Fleet（Phase F／F-routine）

<!-- Phase F：每個 hit consumer 一列，skipped 也列；Phase F-routine：每個 consumer 一列，checkpoint 欄填該 consumer 回報的計畫檔路徑 -->

- target：{{PKG}}@{{TARGET_VERSION}}（release-age 擋下的 latest：{{HELD_BACK_LATEST}}）
- release／advisory：{{RELEASE_OR_ADVISORY_URL}}

| item | kind | 現版 → 目標版 | 分類 | 狀態 | checkpoint | 證據 |
| --- | --- | --- | --- | --- | --- | --- |
| {{CONSUMER_ID}} | consumer | {{FROM}} → {{TO}} | {{CATEGORY}} | {{ROW_STATUS}} | {{CHECKPOINT_OR_PLAN_PATH}} | {{EVIDENCE}} |

## 收尾

- 全部列結案（done／skipped／failed）後填：落地 commit／PR、CI run、未升項目與理由
