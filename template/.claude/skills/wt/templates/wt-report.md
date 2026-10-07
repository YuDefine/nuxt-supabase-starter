## wt 回報：{{INVOCATION_SUMMARY}}

### Routing

Routing: {{TASK_LABEL}} → {{ROUTING_ROW}} / {{MODEL}} / {{EFFORT}} / {{CARRIER}}

<!--
  每個任務一行，沿用 Phase 2 第 1 步派工前已回報的那一行，原樣列出。
  `{{CARRIER}}` 只用 `in-process subagent`、`Herdr child`、`Pi dispatcher`、`主線` 四個值；
  判不進任何一列、由主線自己在樹內做的任務，row 寫 `—`，model／effort 寫主線實際的 model 與 effort。
-->

### 任務狀態

{{STATUS_ICON}} {{TASK_LABEL}} ({{SLUG}}) [{{EXECUTOR_TAG}}]: {{OUTCOME}} — {{CHANGE_STATS}}，branch `{{SESSION_BRANCH}}`
   {{ONE_LINE_SUMMARY}}
   下一步：{{NEXT_STEP}}

<!--
  每個任務一段，第一行固定格式，後兩行縮排三格。
  - `{{STATUS_ICON}}`：✅ 通過驗收／❌ 失敗或未通過／⏸️ 保留待處理。
  - `{{EXECUTOR_TAG}}`：實際執行者，寫成 `<載體>` 或 `<載體>:<細分>`，例：`sonnet-implementer`、`herdr:cc2`、`pi:analyze`、`主線`。
  - `{{OUTCOME}}`：`committed`、`ready`、`findings`、`fail`、`blocked` 之一。
  - `{{CHANGE_STATS}}`：commit 任務寫 `<N> files, <M> commits`；調查任務寫 `<N> findings，已寫入 WORKTREE-BRIEF.md # Findings`；失敗寫錯誤尾段一句話。
  - `{{NEXT_STEP}}`：已進就緒池寫 `已 batch ready，等批次觸發`；保留的寫重派／換載體／待人處置的具體動作。
-->

### 保留中的 worktree

- `{{RETAINED_WORKTREE_PATH}}`（`{{SESSION_BRANCH}}`）：{{RETAIN_REASON}}

<!-- 每棵保留中的樹一行，沒有任何保留時整節只寫一行 `- 無`。 -->

### 就緒池

Ready {{READY_COUNT}} / Blocked {{BLOCKED_COUNT}}（`batch status --trigger auto --workflow {{WORKFLOW_MODEL}}`）：{{BATCH_TRIGGER_RESULT}}

<!--
  計數取自本輪最後一次 `wt-helper.ts batch status` 的輸出，NEVER 自己數。
  `{{BATCH_TRIGGER_RESULT}}` 寫 `未達門檻，繼續開發` 或 `已觸發，已呼叫 /commit`。
-->
