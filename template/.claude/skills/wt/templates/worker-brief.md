routing-row: {{ROUTING_ROW}}

<!--
  `routing-row:` 必須是第一行，值是 Phase 2 第 1 步選定的 routing table 列名（例：`non-ui-implementation`）。
  `sonnet-implementer` 與 routing gate 依這一行放行，NEVER 省略。
  本 brief 交給 in-process subagent 時當 prompt 原文；交給 Herdr child 或 Pi dispatcher 時寫成檔案，
  路徑用 `/tmp/wt-<slug>-brief.md`，再以 `--prompt-file`／`--brief` 傳入。
-->

# Worker brief：{{SLUG}}

- 工作目錄：`{{WORKTREE_PATH}}`
- 分支：`{{SESSION_BRANCH}}`
- work id：`{{WORK_ID}}`
- 任務 brief：`{{WORKTREE_PATH}}/WORKTREE-BRIEF.md`

## 開工前先讀 worker 契約

開始任何讀寫之前，先讀 `{{WORKER_CONTRACT_PATH}}`，整份照做；寫入範圍、commit、push／draft PR、WORKTREE-BRIEF 更新與完成回報格式都以該檔為準，本 brief 不重述。

<!--
  `{{WORKER_CONTRACT_PATH}}` 填 worker 在這棵樹裡實際讀得到的 `wt` skill 規則路徑，派工前先確認存在。
  依序取第一個存在者：
  - consumer（Claude Code）：`.claude/skills/wt/rules/worker契約.md`
  - consumer（Codex）：`.agents/skills/wt/rules/worker契約.md`
  - clade home：`capabilities/core/skills/wt/rules/worker契約.md`
  三者都不存在時填 clade home 的絕對路徑 `~/offline/clade/capabilities/core/skills/wt/rules/worker契約.md`。
  NEVER 把契約條文抄進本 brief；`rules/worker契約.md` 是唯一正本。
-->

{{PI_INLINE_DIRECTIVES}}

<!--
  `{{PI_INLINE_DIRECTIVES}}` 只在載體是 Pi dispatcher、且任務會寫 code／改檔時填，其餘載體刪掉這一行：
  Pi 不會順著指標去讀契約檔，所以 MUST 逐字貼入 `agent-routing.pi-watch-protocol` 的
  § Plan-first 與 § Commit Authorization 兩個 code block（正本在該協定，貼的是派工當下的原文，NEVER 改寫或摘要）。
  調查類 Pi 列（純讀不寫）不貼。
-->

## 任務

{{TASK_SECTION}}

<!--
  `{{TASK_SECTION}}` 依任務性質三擇一，只保留一種寫法：

  一般任務：
    {{TASK_DESCRIPTION_VERBATIM}}

  在本樹呼叫下游 skill：
    以 Skill tool 呼叫 `{{DOWNSTREAM_SKILL_NAME}}`，args 為 `{{DOWNSTREAM_SKILL_ARGS}}`，在本樹內把該 skill 跑完。

  接續中斷的任務：
    這棵樹上一個 session 中斷了，你是接手者。WORKTREE-BRIEF.md 的 Progress 記錄已完成與未完成的項目，
    從下一個未勾選項接續，不要重頭來過，也不要重新冷讀整個 repo。
    目前 git 狀態：
      {{GIT_LOG_MAIN_TO_HEAD}}
      {{GIT_STATUS_SHORT}}
-->

## Context

- 要讀的規則與文件：{{RULES_AND_DOCS_TO_READ}}
- 要動的檔案與現況：{{FILES_TO_TOUCH_WITH_CURRENT_STATE}}
- 已排除的做法：{{REJECTED_APPROACHES}}

<!--
  thin brief 由主線預消化：檔案路徑、要遵守的規則、已知現況與已排除方案。
  NEVER 只給任務名稱就讓 worker 自己冷 grep 整個 repo。沒有已排除的做法時寫「無」。
-->

## Git Baseline

建樹當下 `git -C {{WORKTREE_PATH}} status --porcelain` 的輸出如下；這些路徑是 baseline，不屬於本任務 scope：

```text
{{GIT_STATUS_PORCELAIN_AT_DISPATCH}}
```

<!-- 輸出為空時，code block 內寫 `（乾淨，無 baseline）`。接續既有樹時填 `（接續：baseline 見 WORKTREE-BRIEF；樹內未 commit 的改動屬於本任務，列在任務段）`，NEVER 把前一位 worker 未 commit 的成果標成 baseline。 -->

## Scope guard

本任務只允許寫入以下路徑：

- {{ALLOWED_PATH_1}}
- {{ALLOWED_PATH_N}}

## View-layer guard

本任務不允許修改以下 view-layer 路徑：{{VIEW_LAYER_FORBIDDEN_GLOBS}}

<!--
  只有非 UI 任務（routing row 不是 `ui-view-implementation`）才保留本節；UI view 任務整節刪除。
  預設 glob：`*.vue`、`*.tsx`、`*.jsx`、`*.css`、`*.scss`、`app/pages/**`、`app/components/**`、
  `app/layouts/**`、`pages/**`、`components/**`、`layouts/**`、`views/**`。
-->

## 驗收標準

- {{ACCEPTANCE_CRITERION_1}}
- {{ACCEPTANCE_CRITERION_N}}
- 驗證指令：`{{VERIFY_COMMAND}}`

<!-- 驗收標準由主線寫定，NEVER 留給 worker 自己決定什麼叫完成。 -->
