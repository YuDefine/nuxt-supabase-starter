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
   - If ambiguous, run `spectra list --json` AND `spectra list --parked --json` to get all available changes (including parked ones). Parked changes should be annotated with "(parked)" in the selection list. Use the **request_user_input 工具** to let the user select

   Always announce: "Using change: <name>" and how to override (e.g., `/spectra-apply <other>`).

   Then invoke `/rename <name>` (AI Agent built-in slash command) to rename this session after the change — makes concurrent change sessions easy to identify in the session list. If the SlashCommand tool is unavailable in this environment, skip silently.

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
     Use the **request_user_input 工具** to ask whether to continue.
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

     If there is no request_user_input 工具 available (non-Claude-Code environment):
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
- **`"critical"`**: display missing files with their source artifact, then use the **request_user_input 工具** to ask the user:

  ```
  ⚠ Preflight: missing files detected
  - <path> (referenced in <source artifact>)
  - ...
  These files are referenced in the change artifacts but no longer exist on disk.
  ```

  Options: "Continue anyway" / "Stop"
  If the user chooses "Stop", end the workflow.

  If there is no request_user_input 工具 available:
  Display the same information as plain text and ask whether to continue or stop.
  Wait for the user's response.

If the `preflight` field is absent (blocked or all_done states), skip this step.

3c. **Artifact quality check**

Run `spectra analyze <change-name> --json` to check cross-artifact consistency (Coverage, Consistency, Ambiguity, Gaps).

- **Zero findings**: silently continue.
- **Warning/Suggestion only**: display a one-line summary (e.g., "⚠ Artifact analysis: 2 warnings found") and continue automatically.
- **Critical findings**: display each Critical finding (summary + location + recommendation), then use the **request_user_input 工具**:
  - **Fix and continue** — fix the artifact issues inline, then proceed
  - **Continue anyway** — skip fixes and start implementation
  - **Stop** — end the workflow

  If there is no request_user_input 工具 available, present options as plain text and wait for the user's response.

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
        → Design skill is AI Agent first-class; codex tooling weak in this domain
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

      Plan-first（**MUST**，per `.claude/rules/agent-routing.md` Plan-first 條目）：
      在動任何 Edit / Write / Bash 寫入動作之前，先在 stdout 最開頭輸出一段 `## Plan` section，包含：
      - **要動的具體檔案**（每條一行的相對路徑；對應到 phase <N> 內每個 task 的預期落點）
      - **每個檔案打算做什麼變動**（一句話 — 例如 schema 加哪欄 / API 加哪 endpoint / store 加哪個 action / migration 寫什麼）
      - **預期影響範圍**（typecheck / 哪些 unit test 會被觸發 / 是否需要 migration / runtime 行為改變）
      - **task → 檔案對應表**（每個 task ID 對應到哪些檔案，若某 task 不需要改檔請標 `(no file change — verification only)`）
      Plan 寫完後**立刻**繼續執行，**不要**停下來等確認。Plan 是事前公開思路給主線 cross-check，不是 review gate；主線會用 plan vs. `git diff` 對齊抓「漏做的 task」與「踩到 view 層」這類 drift。

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
      - **MUST view-layer drift check**: `git diff --name-only HEAD~? -- '*.vue' '*.tsx' '*.jsx' '*.css' '*.scss' 'app/pages/**' 'app/components/**' 'pages/**' 'components/**' 'views/**' 'layouts/**'`（取自上次 codex dispatch 之前 commit 為 base；若無 commit 用 working tree diff）。**若有任何 view 層檔案被 codex 動過** → request_user_input: [1] 主線 revert view 改動 + 重派 codex（剝除 view 改動）/ [2] 接受並由主線自己重跑該 view phase / [3] 中止
      - **If gaps detected** → request_user_input: [1] 主線補齊 / [2] 重派 codex / [3] 中止

   5. Move to next phase (re-classify and dispatch or self-execute)

   6. After ALL C 類 phases complete → **主線自己**執行所有 A、B 類 phases（Design Review / UI view），用 `/design improve`, /impeccable skills, /impeccable audit, review-screenshot 等 AI Agent first-class 工具

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

8a. **Verify Channel Pass**（Step 8b 前 hard gate）

   Read `tasks.md` `## 人工檢查` 找未勾 `[verify:e2e]` / `[verify:api]` / `[verify:ui]` / `[verify:<a>+<b>]` / deprecated `[verify:auto]` items。**MUST** 先處理完所有 verify channels 才進 Step 8b。

   **Skip-condition**：`## 人工檢查` 沒任何未勾 `verify:*` item → 直接跳 Step 8b。

   Cookbook 與範本入口：`vendor/snippets/verify-channels/README.md`。

   **Pre-verify baseline check（dispatch 前必做）**：

   1. 主線先 grep / read dev-login route：

      ```bash
      find server packages -path '*/server/routes/auth/_dev-login.get.ts' -o -path '*/server/routes/auth/__test-login.get.ts' 2>/dev/null
      ```

   2. 依 channel 補查：
      - `[verify:e2e]`：Playwright config + `e2e/fixtures/index.ts` style three-role fixture 必須存在
      - `[verify:api]`：`__test-login` 或等價 session bypass route 必須存在
      - `[verify:ui]`：`supabase/seed.sql` 或專案等價 seed file 必須存在
   3. 缺 baseline → **STOP**，回報 user 補齊 baseline；**NEVER** 降級 channel、派 agent 撞錯、或讓 screenshot-review 補 seed。

   **執行流程**：

   1. **解析未勾 verify items 並依 `kinds` 分類**

      - 單一 `[verify:e2e]` / `[verify:api]` / `[verify:ui]` 依該 channel 執行。
      - Multi-marker 依 `e2e → api → ui` 順序逐 channel 執行。
      - Deprecated `[verify:auto]` **MUST** resolution as `[verify:api+ui]`；同時記錄 deprecation warning，後續 archive-gate 也會 warn。

   2. **`[verify:e2e]` channel — 主線自己寫 Playwright spec**

      - Copy/adapt `vendor/snippets/verify-channels/e2e-spec.template.ts`。
      - Spec path **MUST** 是 `e2e/verify/<change>/<topic>.spec.ts`。
      - 跑：

        ```bash
        pnpm test:e2e:verify <change>
        ```

      - Spec pass 後，主線 Edit tasks.md 寫：

        ```text
        (verified-e2e: <ISO-8601> spec=e2e/verify/<change>/<topic>.spec.ts trace=<trace-path>)
        ```

      - Spec fail → 保留 `[ ]`，寫 `（issue: <spec failure summary>）` 或回報 blocker；**NEVER** 寫 `(verified-e2e:)`。

   3. **`[verify:api]` channel — 主線自己跑 HTTP round-trip**

      - Copy/adapt `vendor/snippets/verify-channels/api-roundtrip.template.sh` 或直接用 curl / ofetch 跑等價 request。
      - 通過後，主線 Edit tasks.md 寫：

        ```text
        (verified-api: <ISO-8601> <METHOD> <URL> <STATUS>[ body=<sha256-12chars>])
        ```

      - Request fail / status 不符 → 保留 `[ ]`，寫 `（issue: <METHOD URL expected/actual>）` 或回報 blocker；**NEVER** 寫 `(verified-api:)`。

   4. **`[verify:ui]` channel — 派 screenshot-review `mode: verify`（UI only）**

      - Copy/adapt `vendor/snippets/verify-channels/ui-final-state-brief.template.md`。
      - Brief **MUST** 提供 change name、dev server URL、每個 item 的 known URL、expected DOM observation、預期 screenshot path。
      - Agent scope **MUST** 限於 open known URL + wait for load + final-state screenshot + DOM observation。
      - Agent **NEVER** 做 mutation / form fill / click sequences / multi-role login switching / seed repair。
      - PASS 後，主線 Edit tasks.md 寫：

        ```text
        (verified-ui: <ISO-8601> screenshot=screenshots/local/<change>/#<id>-final.png[ dom=<obs>])
        ```

      - FAIL / UNCERTAIN → 保留 `[ ]`，寫 issue 或回報 blocker；**NEVER** 寫 `(verified-ui:)`。

      Brief 範例：

      ```text
      mode: verify
      Channel: verify:ui
      Change: <change-name>
      Dev server URL: http://localhost:<port>

      Items:
      - #3 [verify:ui]
        Description: /asset-loans 顯示 overdue badge + top-sort
        Known URL: http://localhost:<port>/asset-loans
        Expected DOM observation: overdue badge visible, overdue rows sorted first
        Screenshot path: screenshots/local/<change-name>/#3-final.png

      Scope:
      - Open the known URL, wait for load, capture final-state screenshot, record DOM observation.
      - Do NOT click, fill forms, submit mutations, switch roles, repair seed, or patch network.
      ```

   5. **Multi-marker completion semantics**

      - 每個 channel 完成就寫對應 annotation；同一 line 可同時有 `(verified-e2e:)` / `(verified-api:)` / `(verified-ui:)`，順序 **MUST** 是 e2e → api → ui。
      - 最後一個 channel 完成且 item 不含 `verify:ui` / `review:ui` 時，呼叫 review-gui auto-check helper `autoCheckCompletedAutomaticItems(...)`，自動 flip `[x]`。
      - item 含 `verify:ui` 或 `review:ui` 時，checkbox **MUST** 保持 `[ ]`，等 user 在 review GUI 確認。

   6. **Deprecated `[verify:auto]` alias**

      - Alias resolution：視為 `[verify:api+ui]`。
      - 主線先跑 API channel，再派 UI channel。
      - 新 tasks **NEVER** author `[verify:auto]`；若 Step 8a 碰到它，只做 backward-compatible execution 並保留 deprecation warning。

   7. **Exit**

      - 所有 automatic-only items 完成 annotations 後，呼叫 `autoCheckCompletedAutomaticItems(...)` 讓 review-gui helper 自動勾 `[x]`。
      - 所有含 `verify:ui` 的 items 保持未勾，進 Step 8b 由 user GUI 確認 visual evidence。

   **Guardrails**：
   - **NEVER** 要求 user 在 GUI 確認 `[verify:e2e]` / `[verify:api]` automatic-only items；annotation pass 後 helper 自動 done。
   - **NEVER** 對含 `[verify:ui]` 的 item 代勾 `[x]`；final-state screenshot 需要 user eye。
   - **NEVER** 在沒有成功 evidence 時寫 `(verified-<channel>:)` annotation。
   - **NEVER** 派 screenshot-review agent 負責 mutation / form fill / multi-role login；改用 `verify:e2e` 或 `verify:api`。

8b. **Manual review handoff**

   When tasks.md still contains unchecked items in the `## 人工檢查` section (typical at this point — implementation tasks `[x]` but manual-review items `[ ]`), **MUST** hand off to the local manual-review GUI rather than walking through items inline in chat.

   - **DEFAULT path**: Reply to the user with something like:
     > Implementation 完成。Step 8a 已處理 verify channels：automatic `[verify:e2e]` / `[verify:api]` items 已寫 annotation 並自動完成；含 `[verify:ui]` / `[review:ui]` 的 `<N>` 項仍待你確認。請在 consumer repo root 執行 `pnpm review:ui` 開本地 GUI 驗收 — `[verify:ui]` 項顯示 final-state screenshot + DOM observation 等你點 OK；`[review:ui]` 項顯示人工驗收 evidence。完成後回報，我繼續 Step 9 status。
   - Wait for the user to complete the GUI flow and report back. Do NOT proceed to Step 9 / propose archive until the user signals manual review is done.
   - **NEVER** default to `request_user_input` chat dialog walking items one-by-one — it burns tokens, ignores the screenshot pool, and contradicts `rules/core/manual-review.md` 標準流程.

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
  - **NEVER** dispatch Design Review phase to codex — Design skill is AI Agent first-class
  - **NEVER** dispatch UI view phase（component / page / view / layout / styling）to codex — UI view 層的視覺 / 互動 / a11y 細節必須跟 Design skill 緊耦合，主線自己做。Frontend 但非 view 的（store / hook / API client / type / util）仍走 codex
  - **NEVER** dispatch with `medium` effort — use `high` minimum
  - **NEVER** dispatch task-by-task — phase granularity only
  - **NEVER** dispatch a codex phase without including the「view-layer guard」instruction in the prompt — without it, codex tends to incidentally touch `.vue` / `.tsx` files
  - **NEVER** dispatch a codex phase without including the「Plan-first」instruction in the prompt — without it, 主線只能從 `git diff` 反推 codex 意圖，cross-check 易漏「漏做的 task」與「踩到 view 層」這類 drift（per `agent-routing.md` Plan-first 條目）
  - **NEVER** skip view-layer drift check after codex completion — `git diff --name-only` filtered by view paths is the primary quality gate
  - **NEVER** auto-fix mixed phases by editing tasks.md mid-apply — that belongs to `/spectra-ingest`; for未開工 mixed phase, STOP and instruct the user to run ingest
  - **NEVER** skip cross-check after codex phase completion — read tasks.md, confirm checkboxes, run typecheck/test, review diff
- If **request_user_input 工具** is not available, ask the same questions as plain text and wait for the user's response

**Fluid Workflow Integration**

This skill supports the "actions on a change" model:

- **Can be invoked anytime**: Before all artifacts are done (if tasks exist), after partial implementation, interleaved with other actions
- **Allows artifact updates**: If implementation reveals design issues, suggest updating artifacts - not phase-locked, work fluidly
