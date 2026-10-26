---
slug: {{SLUG}}
branch: {{SESSION_BRANCH}}
consumer: {{CONSUMER_NAME}}
created: {{CREATED_ISO_DATE}}
base_sha: {{BASE_SHA}}
status: in-progress
last_updated: {{LAST_UPDATED_ISO_DATETIME}}
---

<!--
  寫在 worktree 根目錄 `WORKTREE-BRIEF.md`。本檔已由 wt-helper 寫進 repo 共用的 `.git/info/exclude`（TD-347：不是 per-worktree 的 `$GIT_DIR/info/exclude`），
  不進 git：NEVER `git add` 它、NEVER 把它加進 `.gitignore`。
  - `branch`：`wt-helper.ts add` 輸出的 `Branch:` 值（`session/<YYYY-MM-DD-HHMM>-<slug>`）。
  - `base_sha`：`git -C <worktree-path> rev-parse HEAD` 的輸出。
  - `status` 只用 `in-progress`／`done`／`blocked`／`failed` 四個值；建立時固定 `in-progress`。
  - 接續既有 worktree 時不重寫本檔，只更新 `last_updated`。
-->

# Task

{{TASK_DESCRIPTION_VERBATIM}}

<!-- 照呼叫端交來的任務原文逐字貼上，不改寫、不摘要。 -->

# Context

- work id：{{WORK_ID}}
- 下游 skill：{{DOWNSTREAM_SKILL_INVOCATION}}
- 允許路徑：{{ALLOWED_PATHS}}
- 要讀的規則與文件：{{RULES_AND_DOCS_TO_READ}}
- 要動的檔案與現況：{{FILES_TO_TOUCH_WITH_CURRENT_STATE}}
- 驗收標準：{{ACCEPTANCE_CRITERIA}}
- backing service：{{BACKING_SERVICE_STATUS_LINE}}

<!--
  主線預消化過的 thin brief，與 worker brief 的 Context 段同一份內容；存在這裡是為了跨 session 接續。
  沒有下游 skill 時，「下游 skill」寫「無」。
  「backing service」逐字貼 `wt-helper.ts add` 輸出的 `backing-service: …` 那一行；狀態不是 `ready` 時把緊接的
  「補建：…」那一行的指令接在後面。`add` 沒印這一行（此 consumer 沒有 per-worktree backing service）時寫「無」。
-->

# Progress

- [ ] {{PLANNED_STEP_1}}
- [ ] {{PLANNED_STEP_2}}
- [ ] {{PLANNED_STEP_N}}

<!--
  能事先拆就拆成具體步驟；任務太模糊無法事先拆時，只寫一條 `- [ ] Complete task`，由 worker 邊做邊細化。
-->

# Recovery

接手這棵 worktree 的新 session 依序做：

1. 先讀 `{{WORKER_CONTRACT_PATH}}`，照其中的 worker 契約工作。
2. 跑 `git log main..HEAD --oneline`，看已完成的 commit。
3. 跑 `git status --short`，看尚未 commit 的工作。
4. 從上方 Progress 下一個未勾選項接續；Context 已是消化過的上下文，不要從頭冷讀整個 repo。

<!--
  `{{WORKER_CONTRACT_PATH}}` 填這棵樹裡實際讀得到的 `wt` skill `rules/worker契約.md` 路徑，
  寫入前先確認檔案存在。依序取第一個存在者：
  consumer 的 `.claude/skills/wt/rules/worker契約.md` → `.agents/skills/wt/rules/worker契約.md`
  → clade home 的 `capabilities/core/skills/wt/rules/worker契約.md`
  → 都不存在時填絕對路徑 `~/offline/clade/capabilities/core/skills/wt/rules/worker契約.md`（與 worker-brief 模板同一份順序）。
-->
