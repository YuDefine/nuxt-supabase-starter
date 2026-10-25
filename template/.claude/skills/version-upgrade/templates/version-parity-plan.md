# 跨環境版本對齊 rollout plan：{{TOOL_SCOPE}}

- 產出時間：{{GENERATED_AT}}
- SoT：`registry/toolchain.json`（{{SOT_TARGETS}}）
- 矩陣指令：`{{MATRIX_COMMAND}}`
- 承載工作：{{WORK_ID}}

## 量測摘要

| 工具 | 量得到格數 | aligned | drift | unpinned | 另列：undeclared | 另列：unmeasurable | 另列：no-target |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| {{TOOL_NAME}} | {{MEASURED_CELLS}} | {{ALIGNED_CELLS}} | {{DRIFT_CELLS}} | {{UNPINNED_CELLS}} | {{UNDECLARED_CELLS}} | {{UNMEASURABLE_CELLS}} | {{NO_TARGET_CELLS}} |

## 待收斂項目

<!-- 每列一個「工具 × 層 × consumer」；升級路徑取跨環境版本對齊判準 Rule 2 第一個命中的序位；不寫 consumer 端實作步驟 -->

| 工具 | 層 | consumer | 現值 | 目標 | 升級路徑 | 驗收 | 狀態 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| {{TOOL_NAME}} | {{LAYER}} | {{CONSUMER}} | {{CURRENT_VALUE}} | {{TARGET_VALUE}} | {{UPGRADE_PATH}} | {{ACCEPTANCE_CHECK}} | {{ROW_STATUS}} |

## 補宣告與補量測

<!-- undeclared／unmeasurable 的格：要補的宣告面與歸屬（clade registry 由 clade worktree 補；consumer-meta 由 consumer 補） -->

- {{DECLARATION_GAP}}

## 待拍板

<!-- no-target、序位 5、blocked 列：一律同步 flow ask；沒有就寫「無」 -->

- {{DECISION_ITEM}}

## 收斂紀錄

<!-- 每次重跑矩陣追加一行，狀態欄同步更新 -->

- {{RERUN_DATE}}：{{RERUN_RESULT}}
