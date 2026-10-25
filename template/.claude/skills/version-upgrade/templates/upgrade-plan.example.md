# 版本升級計畫：routine.consumer（某 consumer）

- 產出時間：2026-10-21 10:30 +08:00
- route：`routine.consumer`（`mode_route.py` 輸出；複選時每段一份計畫檔）
- 盤點指令：`uv run …/scripts/inventory.py --cwd ~/offline/<consumer-id>-wt/upgrade-deps-20261021`
- worktree：`~/offline/<consumer-id>-wt/upgrade-deps-20261021`
- 承載工作：W-2026-10-21-<consumer-id>-deps
- 續跑：`uv run <skill 根目錄>/scripts/mode_route.py --plan <本檔> --cwd <worktree>`；`狀態` 欄是 `pending`／`in-progress`／`blocked` 的第一列就是續跑起點

## 逐項（Phase B–D／K）

| item | kind | 現版 → 目標版 | 分類 | 狀態 | checkpoint | 證據 |
| --- | --- | --- | --- | --- | --- | --- |
| vue 家族（vue、@vue/compiler-sfc） | npm | 3.5.30 → 3.5.44 | bugfix | done | `3f2a9c1` | typecheck 0 errors（主線重跑） |
| @types/node | npm | 20.11.0 → 20.19.4 (capped to Node 20) | bugfix | done | `8b1d0e7` | typecheck 0 errors |
| @pinia/colada 家族（@pinia/colada、@pinia/colada-nuxt） | npm | 0.17.1 → 0.19.0 | adaptation | in-progress | - | first-pass 派出 |
| actions/checkout | action | v5 → v7.0.1 | adaptation | pending | - | - |
| supabase/setup-cli | action | v1 → v3.0.1 | adaptation | pending | - | - |
| old-lib | npm | 2.1.0（deprecated → @scope/new-lib） | deprecated | blocked | - | 等 user 選換或留 |

## 收尾

- 全部列結案後填：落地 commit／PR、CI run、未升項目與理由
