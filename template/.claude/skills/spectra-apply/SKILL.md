---
name: spectra-apply
description: "Implement or resume tasks from a Spectra change"
effort: xhigh
license: MIT
compatibility: Requires spectra CLI.
metadata:
  author: spectra
  version: "1.0"
  generatedBy: "Spectra"
---
<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/spectra-apply/
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->


Implement tasks from a Spectra change.

**Input**: Optionally specify a change name (e.g., `/spectra-apply add-auth`). If omitted, check if it can be inferred from conversation context. If vague or ambiguous you MUST prompt for available changes.

**Task tracking is file-based only.** The tasks file's markdown checkboxes (`- [ ]` / `- [x]`) are the single source of truth for progress. Do NOT use any external task management system, built-in task tracker, or todo tool. When a task is done, edit the checkbox in the tasks file — that is the only way to record progress.

**Prerequisites**: This skill requires the `spectra` CLI. If any `spectra` command fails with "command not found" or similar, report the error and STOP.

**Steps**

1. **Select the change**

   If a name is provided, use it. Otherwise:
   - Infer from conversation context if the user mentioned a change
   - Auto-select if only one active change exists
   - If ambiguous, run `spectra list --json` AND `spectra list --parked --json` to get all available changes (including parked ones). Parked changes should be annotated with "(parked)" in the selection list. Use the **AskUserQuestion tool** to let the user select

   Always announce: "Using change: <name>" and how to override (e.g., `/spectra-apply <other>`).

2. **Check status to understand the schema**

   ```bash
   spectra status --change "<name>" --json
   ```

   **If the command fails**: show the error and STOP.

   **If the command succeeds**, check whether the change is parked (status can succeed even for parked changes):

   ```bash
   spectra list --parked --json
   ```

   Look for the change name in the `parked` array of the JSON output.
   - **If the change IS in the parked list** (it's parked):
     Inform the user that this change is currently parked（暫存）.
     Use the **AskUserQuestion tool** to ask whether to continue.
     Two options:
     - **Continue**: Unpark the change and proceed with apply
     - **Cancel**: Stop the workflow

     If the user chooses to continue:

     ```bash
     spectra unpark "<name>"
     ```

     Then mark it as in-progress:

     ```bash
     spectra in-progress add "<name>"
     ```

     This is a silent operation — do not show the output to the user.

     Then re-run `spectra status --change "<name>" --json` and continue normally.

     If there is no AskUserQuestion tool available (non-Claude-Code environment):
     Inform the user that this change is currently parked（暫存）and ask via plain text whether to unpark and continue, or cancel.
     Wait for the user's response. If the user confirms, run `spectra unpark "<name>"`, then set `spectra in-progress add "<name>"`, and continue normally.

   - **If the change is NOT in the parked list**: mark it as in-progress and proceed normally.

     ```bash
     spectra in-progress add "<name>"
     ```

     This is a silent operation — do not show the output to the user.

   Parse the JSON to understand:
   - `schemaName`: The workflow being used (e.g., "spec-driven")
   - Which artifact contains the tasks (typically "tasks" for spec-driven, check status for others)

3. **Get apply instructions**

   ```bash
   spectra instructions apply --change "<name>" --json
   ```

   This returns:
   - Context file paths (varies by schema)
   - Progress (total, complete, remaining)
   - Task list with status
   - Dynamic instruction based on current state

   **Handle states:**
   - If `state: "blocked"` (missing artifacts): show message, suggest using `/spectra-propose` to create the change artifacts first
   - If `state: "all_done"`: congratulate, suggest archive
   - Otherwise: proceed to implementation

3b. **Preflight check**

If the apply instructions JSON includes a `preflight` field, act on its `status`:

- **`"clean"`**: silently continue — no output needed.
- **`"warnings"`**: display a brief summary, then continue automatically:
  ```
  ⚠ Preflight warnings:
  - Drifted files (modified after change was created): <list paths>
  - Change is <N> days old
  Continuing...
  ```
  Only show the lines that are relevant (skip drifted if none, skip staleness if not stale).
- **`"critical"`**: display missing files with their source artifact, then use the **AskUserQuestion tool** to ask the user:

  ```
  ⚠ Preflight: missing files detected
  - <path> (referenced in <source artifact>)
  - ...
  These files are referenced in the change artifacts but no longer exist on disk.
  ```

  Options: "Continue anyway" / "Stop"
  If the user chooses "Stop", end the workflow.

  If there is no AskUserQuestion tool available:
  Display the same information as plain text and ask whether to continue or stop.
  Wait for the user's response.

If the `preflight` field is absent (blocked or all_done states), skip this step.

3c. **Artifact quality check**

Run `spectra analyze <change-name> --json` to check cross-artifact consistency (Coverage, Consistency, Ambiguity, Gaps).

- **Zero findings**: silently continue.
- **Warning/Suggestion only**: display a one-line summary (e.g., "⚠ Artifact analysis: 2 warnings found") and continue automatically.
- **Critical findings**: display each Critical finding (summary + location + recommendation), then use the **AskUserQuestion tool**:
  - **Fix and continue** — fix the artifact issues inline, then proceed
  - **Continue anyway** — skip fixes and start implementation
  - **Stop** — end the workflow

  If there is no AskUserQuestion tool available, present options as plain text and wait for the user's response.

4. **Read context files**

   Read the files listed in `contextFiles` from the apply instructions output.
   The files depend on the schema being used:
   - **spec-driven**: proposal, specs, design, tasks
   - Other schemas: follow the contextFiles from CLI output

5. **Check project preferences**

   Read `.spectra.yaml` in the project root.
   If `tdd: true` is set, apply TDD discipline throughout implementation:
   - For each task, write a failing test FIRST, then implement to make it pass
   - Fetch TDD instructions by running `spectra instructions --skill tdd`, then follow the Red-Green-Refactor cycle
   - For bug fixes, reproduce the bug with a failing test before fixing

   If `audit: true` is set, apply sharp-edges discipline throughout implementation:
   - When designing APIs or interfaces, evaluate through 3 adversary lenses (Scoundrel, Lazy Developer, Confused Developer)
   - When adding configuration options, verify defaults are secure and zero/empty values are safe
   - When accepting parameters, check for type confusion and silent failures
   - Fetch audit instructions by running `spectra instructions --skill audit`, follow the discipline checklist (not the standalone 3-agent workflow)

   If `parallel_tasks: true` is set, check whether consecutive pending tasks have `[P]` markers (format: `- [ ] [P] Task description`). You SHALL dispatch consecutive `[P]` tasks as parallel agents. Only fall back to sequential when tasks have a data dependency (one task's output is another's input) or when tasks modify overlapping regions of the same file. Targeting the same file alone is NOT a reason to skip parallel dispatch — if the modified regions are disjoint, dispatch in parallel. If the environment does not support parallel execution, ignore `[P]` markers and execute tasks sequentially.

6. **Show current progress**

   Display:
   - Schema being used
   - Progress: "N/M tasks complete"
   - Remaining tasks overview
   - Dynamic instruction from CLI

6b. **Phase Dispatch Decision**（per `agent-routing.md`）

   Before implementing tasks, decide dispatch model **per phase**（`## N. <phase>` section in tasks.md）:

   1. **Read tasks.md** and identify all `## N.` phase sections
   2. **For each phase, classify into one of three categories**（依序判定，命中即停）:
      - **A. Design Review phase** — title contains "Design Review" OR phase body references `/design improve` / `/impeccable audit` / `/impeccable *` / `review-screenshot` / `/design *`
        → **主線 Claude Opus 4.7 xhigh 自己做**，**永不**派 codex
        → Design skill is Claude Code first-class; codex tooling weak in this domain
      - **B. UI view phase** — phase 內任一 task 描述/路徑指涉 view 層檔案：`.vue` / `.tsx` / `.jsx` / `app/pages/` / `app/components/` / `pages/` / `components/` / `views/` / `layouts/` / `.css` / `.scss` / Tailwind class 變動，**且**該 phase 沒有摻入非 view 的 frontend / backend 工作（store / hook / API client / type / util / migration / API server）
        → **主線 Claude Opus 4.7 xhigh 自己做**，**永不**派 codex
        → UI view 層的視覺 / 互動 / a11y 細節需要與 Design skill 緊耦合；frontend 但非 view 的工作（store / hook / API client / type / util）不在此範圍，走 C 類
      - **C. Other phase** — 上述兩類以外（schema / migration / API server / CLI / 純 backend / frontend 但非 view 的 store / hook / API client / type / util / unit test / docs）
        → **派 background codex GPT-5.5 high**（**不要** medium）
        → Phase 粒度避免大量 codex round-trip
   3. **Mixed-phase fallback**（A、B 都不是純 view、又混雜 view 與非 view 工作）:
      - **看該 phase 是否已開工**（任一 task `[x]`，或 git history 顯示 phase 內檔案已被改）:
        - **已開工** → **主線整個 phase 自己做**（safety fallback；不重切、不派 codex；該 phase 內的 codex 工作量由主線吸收）
        - **未開工** → **STOP**，回覆使用者:
          ```
          phase `<N>. <title>` 同時混雜 UI view 與非 UI 工作，違反新版 Phase Dispatch 規則。
          請改跑 `/spectra-ingest <change-name>` 把 UI view tasks 與其他 tasks 切成獨立 phase 後再 `/spectra-apply`。
          ```
          **NEVER** 主線自行修改 tasks.md phase 結構 — 該交給 `/spectra-ingest`，避免 propose / apply / ingest 邊界混淆
   4. **NEVER** dispatch with `medium` effort — schema drift / cross-file refactor / enum exhaustiveness require `high` minimum
   5. **NEVER** dispatch task-by-task — phase-level only

   **Codex phase dispatch template**（C 類專用，per `agent-routing.md` 「Codex 派工的標準流程」+「Spectra Apply Phase Dispatch」）:

   1. Write prompt to `/tmp/codex-spectra-apply-<change>-phase-<N>-prompt.md`，內容固定包含：

      ```
      [DELEGATED-BY-CLAUDE-CODE]

      請執行本 repo 的 spectra-apply phase <N>（<phase-title>）的全部 tasks。

      Change: <change-name>
      Phase: <N>. <phase-title>
      Tasks（請依序完成並用 `spectra task done <change> <task-id>` 標記）：

      <每個 task 的編號 + 描述，從 tasks.md 抓>

      讀取以下檔案了解上下文：
      - openspec/changes/<change-name>/proposal.md
      - openspec/changes/<change-name>/design.md
      - openspec/changes/<change-name>/specs/*/spec.md
      - openspec/changes/<change-name>/tasks.md
      - .claude/rules/（相關 rule，例如 server-api / pinia-store / supabase-* / development）

      View-layer guard（**MUST**）：
      禁止修改 view 層檔案：
      - 副檔名：`.vue` / `.tsx` / `.jsx` / `.css` / `.scss`
      - 目錄：`app/pages/` / `app/components/` / `pages/` / `components/` / `views/` / `layouts/`
      若 task 需要 view 層改動，回報 "view layer change required, defer to main thread" 並跳過該 task（不要勾 checkbox），主線會自己處理。

      Acceptance：所有 phase <N> 的 tasks 完成、checkbox 已勾、相關 typecheck / unit test 通過、git diff 對應預期變更。
      不要動 phase <N> 以外的 tasks。不要碰 ## Design Review 區塊（主線會自己做）。
      不要呼叫 /spectra-archive。
      ```

   2. Background bash:

      ```bash
      cd <consumer-repo-root> && codex exec \
        --model gpt-5.5 \
        --dangerously-bypass-approvals-and-sandbox \
        --skip-git-repo-check \
        -c model_reasoning_effort=high \
        < /tmp/codex-spectra-apply-<change>-phase-<N>-prompt.md 2>&1
      ```

   3. Inform user briefly + start Codex Watch Protocol（見 `agent-routing.md`）

   4. After `<task-notification status=completed>`:
      - BashOutput → read full stdout
      - Read tasks.md → confirm phase <N> all checkboxes are `[x]`
      - Sanity check: `pnpm typecheck` (or equivalent), relevant tests, `git diff` review
      - **MUST view-layer drift check**: `git diff --name-only HEAD~? -- '*.vue' '*.tsx' '*.jsx' '*.css' '*.scss' 'app/pages/**' 'app/components/**' 'pages/**' 'components/**' 'views/**' 'layouts/**'`（取自上次 codex dispatch 之前 commit 為 base；若無 commit 用 working tree diff）。**若有任何 view 層檔案被 codex 動過** → AskUserQuestion: [1] 主線 revert view 改動 + 重派 codex（剝除 view 改動）/ [2] 接受並由主線自己重跑該 view phase / [3] 中止
      - **If gaps detected** → AskUserQuestion: [1] 主線補齊 / [2] 重派 codex / [3] 中止

   5. Move to next phase (re-classify and dispatch or self-execute)

   6. After ALL C 類 phases complete → **主線自己**執行所有 A、B 類 phases（Design Review / UI view），用 `/design improve`, /impeccable skills, /impeccable audit, review-screenshot 等 Claude Code first-class 工具

7. **Implement tasks (loop until done or blocked)**

   **Reminder: Track progress by editing checkboxes in the tasks file only. Do not use any built-in task tracker.**

   **Dispatch reminder**: For each phase, follow Step 6b's three-way classification:
   - Class C（Other）→ dispatch codex GPT-5.5 high (phase granularity)
   - Class A（Design Review）→ 主線 self-execute (NEVER dispatch)
   - Class B（UI view: component / page / view / layout / styling）→ 主線 self-execute (NEVER dispatch)
   - Mixed phase（UI view + 非 view 摻同 phase）→ 已開工主線吸收、未開工 STOP 提示 `/spectra-ingest`

   For each pending task:
   - Show which task is being worked on
   - Re-read the sections of design and spec files that are relevant to this task's scope — do not rely on memory from earlier in the conversation, as context may have been compressed
   - Before writing code, check:
     1. **Reuse** — search adjacent modules and shared utilities for existing implementations before writing new code
     2. **Quality** — derive values from existing state instead of duplicating; use existing types and constants over new literals
     3. **Efficiency** — parallelize independent async operations; avoid unnecessary awaits; match operation scope to actual need
     4. **No Placeholders in artifacts** — if the design or spec for this task contains placeholder language (TBD, TODO, "add appropriate handling"), pause and fix the artifact first or flag to the user. Do not implement against vague requirements.
     5. **Examples as verification** — if the spec for this task's scope includes `##### Example:` blocks, use them as concrete test cases:
        - When TDD is enabled: derive the first failing test directly from the example's GIVEN/WHEN/THEN values
        - When TDD is not enabled: after implementing, verify the code handles the example's input→output correctly
        - Example tables map to parameterized tests — one test per row
          Do NOT invent additional test values beyond what the spec examples provide without reason. The examples ARE the agreed specification.
   - Make the code changes required
   - Keep changes minimal and focused
   - **Verify before marking done** — re-read the task description from the tasks file. For each requirement stated in the description, confirm it is addressed by your changes. If any requirement is missing, implement it now. Do not mark the task complete until every part of the description is covered.
   - Mark task complete by running: `spectra task done --change "<name>" <task-id>`
     This command marks the checkbox in tasks.md AND records which files were modified for this task.
   - Continue to next task

   **Parallel task dispatch**: When consecutive `[P]`-marked tasks are found and `parallel_tasks: true` is configured (see Step 5), dispatch them as parallel agents in a single message. If any `[P]` task fails, pause and report.

   **Pause if:**
   - Task is unclear → ask for clarification
   - Implementation reveals a design issue → suggest updating artifacts
   - Error or blocker encountered → report and wait for guidance
   - User interrupts

---

## Rationalization Table

| What You're Thinking                                               | What You Should Do                                                                                                                            |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| "This task looks done, I'll mark it complete"                      | Re-read the task description first. Check whether your diff covers every part of it. Incomplete tasks marked done are the #1 source of rework |
| "This task is trivial, I don't need to re-read the design"         | Re-read. Context compression loses details. 30s of reading saves 30min of rework                                                              |
| "I already know how this works, skip the code search"              | Search anyway. Someone may have added a utility since you last looked                                                                         |
| "The test is obvious, I'll add it after implementation"            | If TDD is enabled, test first. If not, still write it before marking done                                                                     |
| "This is just a small refactor, no test needed"                    | Small refactors are how regressions sneak in. Write the test                                                                                  |
| "The artifact says X but Y makes more sense"                       | Pause and suggest updating the artifact. Don't silently deviate                                                                               |
| "I'll fix this other thing I noticed while I'm here"               | Finish current task first. Address the other thing separately                                                                                 |
| "The example values are just illustrations, I'll pick better ones" | Use the spec example values exactly. They were chosen deliberately                                                                            |

---

8. **Final check**

   After completing all tasks, re-run:

   ```bash
   spectra instructions apply --change "<name>" --json
   ```

   Confirm `state: "all_done"`. If not, review remaining tasks and complete them.

8b. **Manual review handoff**

   When tasks.md still contains unchecked items in the `## 人工檢查` section (typical at this point — implementation tasks `[x]` but manual-review items `[ ]`), **MUST** hand off to the local manual-review GUI rather than walking through items inline in chat.

   - **DEFAULT path**: Reply to the user with something like:
     > Implementation 完成，剩 `<N>` 項 `## 人工檢查`。請在 consumer repo root 執行 `pnpm review:ui` 開本地 GUI 驗收 — 自動依 `#N` / `#N.M` 檔名配對截圖、鍵盤 OK / Issue / SKIP、conflict-aware 寫回 tasks.md。完成後回報，我繼續 Step 9 status。
   - Wait for the user to complete the GUI flow and report back. Do NOT proceed to Step 9 / propose archive until the user signals manual review is done.
   - **NEVER** default to `AskUserQuestion` chat dialog walking items one-by-one — it burns tokens, ignores the screenshot pool, and contradicts `rules/core/manual-review.md` 標準流程.

   **Fallback to chat-based confirmation only when**:
   - Consumer lacks the `review:ui` script (offer to run `pnpm hub:check` or propagate from clade first)
   - User explicitly says "skip the GUI, just confirm in chat"
   - Pure-backend change with 1–2 yes/no items and zero screenshot evidence needed

   Once manual review is complete (all `## 人工檢查` items resolved with user confirmation), proceed to Step 9.

9. **On completion or pause, show status**

   Display:
   - Tasks completed this session
   - Overall progress: "N/M tasks complete"
   - If all done: suggest archive
   - If paused: explain why and wait for guidance

**Output During Implementation**

```
## Implementing: <change-name> (schema: <schema-name>)

Working on task 3/7: <task description>
[...implementation happening...]
✓ Task complete

Working on task 4/7: <task description>
[...implementation happening...]
✓ Task complete
```

**Output On Completion**

```
## Implementation Complete

**Change:** <change-name>
**Schema:** <schema-name>
**Progress:** 7/7 tasks complete ✓

### Completed This Session
- [x] Task 1
- [x] Task 2
...

All tasks complete! You can archive this change with `/spectra-archive`.
```

**Output On Pause (Issue Encountered)**

```
## Implementation Paused

**Change:** <change-name>
**Schema:** <schema-name>
**Progress:** 4/7 tasks complete

### Issue Encountered
<description of the issue>

**Options:**
1. <option 1>
2. <option 2>
3. Other approach

What would you like to do?
```

**Guardrails**

- Keep going through tasks until done or blocked
- Always read context files before starting (from the apply instructions output)
- If task is ambiguous, pause and ask before implementing
- If implementation reveals issues, pause and suggest artifact updates
- Keep code changes minimal and scoped to each task
- Update task checkbox immediately after completing each task
- Pause on errors, blockers, or unclear requirements - don't guess
- Use contextFiles from CLI output, don't assume specific file names
- **No external task tracking** — do not use any built-in task management, todo list, or progress tracking tool; the tasks file is the only system
- **Phase dispatch discipline**（per `agent-routing.md`）:
  - **NEVER** dispatch Design Review phase to codex — Design skill is Claude Code first-class
  - **NEVER** dispatch UI view phase（component / page / view / layout / styling）to codex — UI view 層的視覺 / 互動 / a11y 細節必須跟 Design skill 緊耦合，主線自己做。Frontend 但非 view 的（store / hook / API client / type / util）仍走 codex
  - **NEVER** dispatch with `medium` effort — use `high` minimum
  - **NEVER** dispatch task-by-task — phase granularity only
  - **NEVER** dispatch a codex phase without including the「view-layer guard」instruction in the prompt — without it, codex tends to incidentally touch `.vue` / `.tsx` files
  - **NEVER** skip view-layer drift check after codex completion — `git diff --name-only` filtered by view paths is the primary quality gate
  - **NEVER** auto-fix mixed phases by editing tasks.md mid-apply — that belongs to `/spectra-ingest`; for未開工 mixed phase, STOP and instruct the user to run ingest
  - **NEVER** skip cross-check after codex phase completion — read tasks.md, confirm checkboxes, run typecheck/test, review diff
- If **AskUserQuestion tool** is not available, ask the same questions as plain text and wait for the user's response

**Fluid Workflow Integration**

This skill supports the "actions on a change" model:

- **Can be invoked anytime**: Before all artifacts are done (if tasks exist), after partial implementation, interleaved with other actions
- **Allows artifact updates**: If implementation reveals design issues, suggest updating artifacts - not phase-locked, work fluidly
