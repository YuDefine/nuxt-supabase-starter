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
permission_tier: action
---
<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/spectra-apply/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


Implement tasks from a Spectra change.

> **Ownership**（clade fork；cross-phase matrix in `rules/core/spectra-workflow.md`）：apply 負責 code 正確性 + Class B UI view phase refactor invariant（Step 6c / Layer B：無 column 整欄 fallback + 0 個 4xx/5xx）+ review-rules 機械規則掃描（Step 6d：`patterns.json` multi-line match，補 pre-commit hook 逐行 grep 漏抓的跨行 Vue props）+ Design Review data-sanity（Layer C：client param vs server schema bound）+ pre-handoff 5-維度 cross-check（Step 8a.6 / Layer E.1 主線 + E.2 pi）。**不**負責 user 主觀視覺 / UX 真人驗收（manual review / review-gui 管）。

**Input**: Optionally specify a change name (e.g., `/spectra-apply add-auth`). If omitted, check if it can be inferred from conversation context. If vague or ambiguous you MUST prompt for available changes.

**Task tracking is file-based only.** The tasks file's markdown checkboxes (`- [ ]` / `- [x]`) are the single source of truth for progress. Do NOT use any external task management system, built-in task tracker, or todo tool. When a task is done, edit the checkbox in the tasks file — that is the only way to record progress.

**Prerequisites**: This skill requires the `spectra` CLI. If any `spectra` command fails with "command not found" or similar, report the error and STOP.

**Steps**

0. **Worktree gate**（clade fork addition；not in upstream spectra）

   Spectra-apply writes tracked product code, so per [[worktree-default]] §1 it **MUST** run in an isolated session worktree — multi-session 並行共用單一 working tree 會撞 staging / branch / WIP（見 worktree-default.md 開頭兩次真實事故）。Step 1 之前先 gate：

   a. **Resolve change name early**（用 Step 1 同套規則 — argument > conversation context > `spectra list`）。Step 0 完成後 Step 1 可重用已解析的 name，不必再問。

   b. **偵測 cwd**：

      ```bash
      git rev-parse --git-dir
      ```

      - 若 output 路徑含 `/worktrees/`（或 `git rev-parse --git-common-dir` ≠ `git rev-parse --git-dir`）→ cwd 已在某個 session worktree，**通過**，繼續 Step 1
      - 否則 cwd 在 main，繼續 step c

   c. **Pre-fork baseline guard + 自動建 worktree**（idempotent）：cwd 在 main 時 **MUST** 先完整讀 `references/worktree-setup.md` § Step 0c，依 c.1（detect-main-dirty）→ c.2（scope filter 三來源）→ c.3（三情境決策，scope-in 為空時 **NEVER** STOP / AskUserQuestion / 要求先 commit-stash）→ c.4（wt-helper fork）執行；helper 錯誤（非 already-exists）→ STOP，**不要**降級回「在 main 跑」。

   c.5. **Main-side unpark + commit-to-git**（clade fork addition；critical data-safety guardrail，per `docs/pitfalls/2026-05-22-agent-tool-subagent-worktree-bypass.md`）：

      **MUST** 在 dispatch subagent **之前**，由主線在 main worktree（或 Step 0c 剛 fork 出的 session worktree — 兩者都是 persistent disk）跑 unpark + commit-to-git，讓 artifacts 落 git tracked file，不再依賴 `.git/spectra-app/spectra.db` 的 SQLite blob。

      **執行流程**：**MUST** 完整讀 `references/worktree-setup.md` § Step 0c.5——偵測是否 parked → 主線在 main 跑 `spectra unpark` → selective stage + commit → worktree sync，含 unpark / commit / pull 各自的 failure handling。**NEVER** 憑記憶跑。

      **Skip-condition**：`spectra list --parked --json` 未命中本 change → artifacts 已在 disk / git，直接進 Step 0d。

      **NEVER**：

      - **NEVER** 在 Agent tool dispatched subagent 內跑 `spectra unpark`（Agent tool 的 cwd 是 ephemeral `.claude/worktrees/agent-*/`，unpark 寫的 artifacts 會被 session GC 清掉 → permanent data loss）
      - **NEVER** 跳過此步直接 dispatch subagent 期望 Step 2 在 subagent 內跑 unpark — Step 2 的 unpark 路徑已標記為 fallback only，主線預先做才是 default
      - **NEVER** 用 `git add -A` / `git add .` stage artifacts — 會把 main 上其他 user WIP 一起 commit
      - **NEVER** 透過 `Skill` tool 或 `Agent` tool 委派此步給 subagent — 必須主線自己跑（subagent 的 cwd 不可信）

   c.6. **Environment Readiness Check**（clade fork addition；per `docs/pitfalls/2026-06-28-spectra-apply-dispatches-unready-change.md`）：dispatch 前 **MUST** 依 `references/worktree-setup.md` § Step 0c.6 依序跑三項檢查（DB migration sync（含 dev DB reset 自主協調，**NEVER** 停下問 user）/ dev server cwd 對齊 / auth route smoke test，**NEVER** 帶 token header）——任一紅燈自動修或 STOP；**NEVER** 跳過此步直接 dispatch。全綠印一行 `✅ Environment readiness` 繼續 Step 0d。

   d. **Internally dispatch via `/wt` Form 3**：

      Invoke the Skill tool with `/wt <change-name>: /spectra-apply <change-name>` (Form 3 per `plugins/hub-core/skills/wt/SKILL.md`). `/wt` orchestrates the worktree lifecycle (reuses the one prepared in Step 0c) and spawns a subagent that runs Step 1+ inside it. Subagent reports completion or structured failure back through `/wt`'s normal channel; parent cwd stays on main throughout.

      Wait for the dispatched skill to return, surface its report to the user, and STOP — do **not** re-enter Step 1 in the parent session.

      While waiting: the subagent dispatches and watches its own pi processes (Step 6b Class C, Step 8a verify channels, pre-handoff checks). The parent **MUST NOT** probe those with `ps` / `pgrep` / `/proc` — that output carries no tenant information in either direction, so it produces confident wrong answers rather than none (TD-351; `agent-routing.pi-watch-protocol.md` § 跨 sandbox 可見度約束 v2). Ask via `SendMessage`, or read signals that name the change/phase slug.

      **Fallback** — if the Skill tool / `/wt` dispatch is unavailable in this environment (rare degradation; e.g., minimal runtime without skill support), **NEVER** hand the worktree path or invocation back to the user. If the parent can legally continue in that worktree, continue directly. If a separate interactive session is required, MUST Read `~/offline/clade/vendor/snippets/herdr-session-handoff/README.md`, dispatch the durable change prompt with `herdr-session-handoff.ts`, and return its workspace / tab / pane receipt.

      `<worktree-absolute-path>` 從 wt-helper 輸出抓；`<change-name>` 是 Step 0a 已解析的 name. Transport failure preserves the durable change and reports a blocker; it does not create a manual `cd … && claude` fallback.

   e. **Bypass 條件**：使用者**明確**訊息含「不要 worktree」「在 main 跑」「我知道風險」等字眼時，跳過 Step 0 直接 Step 1。**禁止** agent 自行判斷略過（包括 user 跑 `/spectra-apply` 本身不算明確 bypass — 那只是 invocation，不是 worktree 偏好）。

1. **Select the change**

   If a name is provided, use it. Otherwise:
   - Infer from conversation context if the user mentioned a change
   - Auto-select if only one active change exists
   - If ambiguous, run `spectra list --json` AND `spectra list --parked --json` to get all available changes (including parked ones). Parked changes should be annotated with "(parked)" in the selection list. Use the **AskUserQuestion tool** to let the user select

   Always announce: "Using change: <name>" and how to override (e.g., `/spectra-apply <other>`).

   Then invoke `/rename <name>` (Claude Code built-in slash command) to rename this session after the change — makes concurrent change sessions easy to identify in the session list. If the SlashCommand tool is unavailable in this environment, skip silently.

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

     **clade fork data-safety guard**（per `docs/pitfalls/2026-05-22-agent-tool-subagent-worktree-bypass.md`）：本路徑能命中表示 Step 0c.5 被跳過。先 `git rev-parse --git-dir`，**若路徑含 `.claude/worktrees/agent-`** → **STOP**，回報 `references/worktree-setup.md` § Step 2 parked fallback 的 STOP 訊息全文並交還 parent。**NEVER** 自行嘗試 unpark、**NEVER** 用 AskUserQuestion 給「強制 unpark」選項——沒有合法的「在 subagent 內 unpark」路徑。cwd 在 main / persistent worktree 才續走以下流程。

     Inform the user that this change is currently parked（暫存）.
     Use the **AskUserQuestion tool** to ask whether to continue.
     Two options:
     - **Continue**: Unpark the change and proceed with apply
     - **Cancel**: Stop the workflow

     If the user chooses to continue:

     ```bash
     spectra unpark "<name>"
     ```

     **Post-unpark commit**（clade fork addition；防 SQLite-only state）：unpark 後 **MUST** 立刻把 artifacts commit 進 git（`git add openspec/changes/<name>/` → commit）。**禁止** `git add -A`；`no changes to commit` 視為成功、hook fail 則 STOP。逐字指令見 `references/worktree-setup.md` § Step 2 parked fallback。

     Then mark it as in-progress:

     ```bash
     spectra in-progress add "<name>"
     ```

     This is a silent operation — do not show the output to the user.

     Then re-run `spectra status --change "<name>" --json` and continue normally.

     If there is no AskUserQuestion tool available (non-Claude-Code environment):
     Inform the user that this change is currently parked（暫存）and ask via plain text whether to unpark and continue, or cancel.
     Wait for the user's response. If the user confirms, run `spectra unpark "<name>"` + post-unpark commit + `spectra in-progress add "<name>"`, and continue normally.

   - **If the change is NOT in the parked list**: mark it as in-progress and proceed normally.

     ```bash
     spectra in-progress add "<name>"
     ```

     This is a silent operation — do not show the output to the user.

   Parse the JSON to understand:
   - `schemaName`: The workflow being used (e.g., "spec-driven")
   - Which artifact contains the tasks (typically "tasks" for spec-driven, check status for others)

2.5. **Stash Reconcile (clade fork; not in upstream spectra)**

   Scan namespaced stashes related to this change before starting work — resume 場景下前一 session 的 WIP 可能已被 wt-helper / propagate / clade-publish auto-stash 且從未 reapply。

   - Run: `node scripts/stash-reconcile.ts --slug "<change-name>" --json`
   - Parse stdout JSON. If `entries.length === 0`, continue silently to Step 3.
   - If hits: print one-line summary `⚠ Stash Reconcile: N entries match slug '<change>'`, then use **AskUserQuestion**:
     - **Show full report** — print each entry's `ref`, `namespace.kind`, `createdAt`, file list, and `recommendation.action`/`recommendation.reason`; then re-ask the same question
     - **Apply recommended** — for every entry where `recommendation.action === "apply"`, run `git stash apply <ref>` (safety contract: NEVER `pop` / `drop` here; the stash entries stay intact). Then continue to Step 3.
     - **Ignore and continue** — proceed with apply on current tree without touching stash
     - **Stop cycle** — abort spectra-apply (user will reconcile manually)
   - **Skip condition**: if user passed `--no-reconcile` (or said "不要掃 stash" / "skip reconcile" when invoking the skill), skip this step and print `Stash reconcile: skipped (user --no-reconcile)`.
   - **Failure handling**: if `stash-reconcile.ts` exits non-zero or JSON parse fails, print the error and continue to Step 3 (reconcile is advisory — do NOT block apply).

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

3d. **Drift dormancy check** (passive trigger for stale changes)

When the change has been dormant for more than 5 days AND the change directory has had zero commits in the past 3 days, surface a drift report before tasks begin — the change is likely out-of-sync with the current codebase.

Detect dormancy from `.openspec.yaml` `created` and `git log -1 --format=%at -- docs/specs/changes/<name>/`:

- **Both conditions met**: run `spectra drift <change-name>`, display the report, then use the **AskUserQuestion tool**:
  - **Continue with apply** — proceed to tasks (recommended for Light drift)
  - **Refresh first** — pause apply, run `/spectra-ingest <change-name>` to update artifacts, then resume
  - **Stop** — end the workflow
- **Either condition not met**: silently continue, no output.

The trigger is guidance only — it MUST NOT block apply from proceeding when the user chooses to continue. Hard-blocking on dormancy would punish legitimate "I came back after a long weekend" cases.

(Threshold reasoning: AI-assisted commits are daily-cadence. ≥5 days dormant + ≥3 days no commit ≈ genuine stagnation, not normal pacing.)

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

6a. **Residency Classify + Record（機械前置，MUST — 任何 phase dispatch 決策前）**

   Per `agent-routing.md` § Orchestration Residency。「主線自行判斷 residency」已由 audit 證實不可靠（上線 6 天 eligible change 採用率 1/3），所以 classify + record 是機械步驟。**每一條** change 開工都要 classify + record，不是只有看起來像純後端的那條。

   1. **MUST** 跑 classifier 拿 verdict（開工後、動任何 phase 之前）：

      ```bash
      node ~/offline/clade/vendor/scripts/residency-classify.ts classify --change openspec/changes/<change>
      ```

      stdout JSON：`{verdict: "codex-primary" | "claude-primary", phases: [...]}`。每個 `phases[]` 另帶 additive `execution`：Class C 的 `prescan` eligibility、mechanical shadow candidate 與 authoritative `effective` row；這些欄位**不**改 residency verdict。

      現行 `execution.rolloutStage` 固定為 `shadow`：`mechanical.eligible=true` 只把 effective Sol implementation 記進 `shadow-luna-candidate` cohort，**NEVER** 直接授權 Luna mutation。Machine-readable marker 的唯一格式、完整 predicate 與 prescan／implementation recipe 在 Step 6b reference。

   2. **MUST 立刻** record decision（決定實際 executor 後、第一個 dispatch / 第一個 Edit 之前）：

      ```bash
      node ~/offline/clade/vendor/scripts/residency-classify.ts record \
        --consumer-path . --change <change> \
        --verdict <classifier verdict> --executor <codex|claude> [--reason <text>]
      ```

      - verdict=`codex-primary` 而決定 executor=`claude` → `--reason` **必填**（record 入口會擋）
      - 機械 sweep（無正式 tasks.md，residency 進入條件 B）→ classifier 用不上，直接 `record --verdict codex-primary --executor codex`
      - Record 落 `<consumer>/.spectra/residency-ledger.jsonl`

   3. **依 verdict 走對應路徑**：verdict=`codex-primary` 且 executor=codex → 走 `agent-routing.md` § Orchestration Residency 的 **change 粒度單次 dispatch + notification-only**，**不要**落到 Step 6b 逐 phase 派工；verdict=`claude-primary`（或帶正當 `--reason` 留主線）→ 續走 Step 6b Phase Dispatch。

   **後果（機械強制，同 Check 7 / E.1 先例）**：`archive-gate.sh` **Check 8** 會機械驗 residency record 存在 — 缺 record → archive 被擋 exit 2。正當例外（user 明確指示主線自做等）在 tasks.md 加 bypass marker `<!-- residency-decision: intentional, reason: ... -->`。

6b. **Phase Dispatch Decision**（per `agent-routing.md`）

   Before implementing tasks, decide dispatch model **per phase**（`## N. <phase>` section in tasks.md）:

   1. **Read tasks.md** and identify all `## N.` phase sections
   2. **For each phase, classify into one of three categories**（依序判定，命中即停）:
      - **A. Design Review phase** — title contains "Design Review" OR phase body references `/design improve` / `/impeccable audit` / `/impeccable *` / `review-screenshot` / `/design *`
        → **主線 Claude Opus 5 xhigh 自己做**，**永不**派 pi
        → Design skill is Claude Code first-class; pi tooling weak in this domain
      - **B. UI view phase** — phase 內任一 task 描述/路徑指涉 view 層檔案：`.vue` / `.tsx` / `.jsx` / `app/pages/` / `app/components/` / `pages/` / `components/` / `views/` / `layouts/` / `.css` / `.scss` / Tailwind class 變動，**且**該 phase 沒有摻入非 view 的 frontend / backend 工作（store / hook / API client / type / util / migration / API server）
        → **主線 Claude Opus 5 xhigh 自己做**，**永不**派 pi——UI view 實作在 `agent-routing.md` § 派不派 的不外派清單，**NEVER** 派 Pi 任一 model、**NEVER** 派 Claude subagent
        → **NEVER** 因為 phase 大、時間晚、非 view phase 的 dispatch 管線現成就轉派——那條管線是 C 類專用
        → 實作完、該 phase commit / 標 done **之前**，照跑 Step 6c / 6d 檢查與 Design Review gate
        → frontend 但非 view 的工作（store / hook / API client / type / util）不在此範圍，走 C 類
      - **C. Other phase** — 上述兩類以外（schema / migration / API server / CLI / 純 backend / frontend 但非 view 的 store / hook / API client / type / util / unit test / docs）
        → **派 background Pi，統一走泛用 dispatcher 的 `spectra-phase-implementation` row（Sol high）**
        → Phase 粒度避免大量 Pi round-trip；model／effort／origin 由 dispatcher receipt 與 ledger 鎖定
        → **在 Form 3 / Form 4 下這一步由 worktree subagent 自己派**，per `agent-routing.md` § Dispatch 入口「pi MUST 由該層編排者在其自身 sandbox 內直接 Bash 派」。准入條件是**該 subagent 自跑完整 Pi Watch Protocol**（notification-only + 安全網 fallback），做不到就退回薄中介禁令。主線對這些 pi **零探針**（TD-351）
   3. **Mixed-phase fallback**（A、B 都不是純 view、又混雜 view 與非 view 工作）:
      - **看該 phase 是否已開工**（任一 task `[x]`，或 git history 顯示 phase 內檔案已被改）:
        - **已開工** → **主線整個 phase 自己做**（safety fallback；不重切、不派 pi；該 phase 內的 pi 工作量由主線吸收）
        - **未開工** → **STOP**，回覆使用者:
          ```
          phase `<N>. <title>` 同時混雜 UI view 與非 UI 工作，違反新版 Phase Dispatch 規則。
          請改跑 `/spectra-ingest <change-name>` 把 UI view tasks 與其他 tasks 切成獨立 phase 後再 `/spectra-apply`。
          ```
          **NEVER** 主線自行修改 tasks.md phase 結構 — 該交給 `/spectra-ingest`，避免 propose / apply / ingest 邊界混淆
   4. **NEVER** dispatch Phase Dispatch（Step 6b）with `medium` effort — schema drift / cross-file refactor / enum exhaustiveness require `high` minimum。Step 8a 系列收集工作允許 `medium`
   5. **NEVER** dispatch task-by-task — phase-level only

   **C 類 phase dispatch 執行**：**每一個** C 類 phase 派工前 **MUST** 完整讀 `references/pi-phase-dispatch.md`——classifier execution 欄位、eligible Luna read-only prescan、shadow-only marker、共用 template／output schema、background Pi dispatcher invocation、Pi Watch Protocol，以及 notification 後的 **MUST checks**（commit boundary / view-layer drift double-check / scope cross-check / gate replay）。**NEVER** 憑記憶派工、退回 raw `codex exec`、自行覆寫 classifier 或跳過 post-notification checks；主線收報後 re-classify 下一個 phase。

   6. After ALL C 類 phases complete → **本次 apply session 內 MUST 完成**所有 A、B 類 phases：**每一個 B 類 phase** 依 Step 6b 的 B 類派工形狀派 `--model grok-xai` 實作（瑣碎 UI 修照 Step 6b 主線直做），收回後主線跑 Step 6c / 6d；**A 類（Design Review）主線自己做**——**直接 invoke Skill tool** 跑 `/design improve`、`/impeccable audit`、`review-screenshot` 等 Claude Code first-class skill，完整跑完該 phase 所有 tasks 並標 `[x]`。

      **Hard rule — Design Review 內含完成義務**：
      - **MUST** 在 apply flow 內自行 invoke 並完成 Design Review phase 的全部工作（`/design improve` → `/impeccable audit` → screenshot），**不是**停下來告訴 user「接手 session 請跑 /design improve」
      - **MUST** 完成後才進 Step 8（Final check）— Design Review 是 apply 的一部分，不是 apply 之外的獨立步驟
      - **NEVER** 在 Output On Completion 或 status 中把 Design Review 列為「待做」或「下一步由 user 跑」
      - **NEVER** 因為 Design Review 需要 dev server / screenshot 而停下 — 主線有 proactive dev server spawn 能力（per `rules/core/proactive-skills.md`），自己起 server、自己截圖、自己完成
      - **例外**：user 明確說「Design Review 我自己做」「跳過 design」才可不做

      **Design Review 期間 MUST 跑 Layer C data-sanity**（clade fork addition）：對本 change 觸及的 paginated query + lookup-resolved column 跑 `node <clade-vendor>/scripts/audit-data-sanity.ts --consumer-path . --files <touched> --json`。exit 1 `status:"fail"`（PARAM_BOUNDARY，Critical）→ 主線 root-cause 修（client literal 超 server zod bound，如 `perPage:200` vs `max(100)`），**NEVER** 帶病進 handoff。詳見 `/data-sanity` skill。

6c. **Refactor Invariant Check**（clade fork addition；Layer B of pre-handoff quality gates；not in upstream spectra）

   **理由**：refactor 不得改變 observable behavior；失效鏈實證見 `references/ui-phase-gates.md` § Step 6c 理由。

   **觸發範圍**：每個 **Class B（UI view）phase** 由主線在該 phase 實作完成後、commit / 標 tasks done **之前**，跑一次。Class A / Class C phase 不觸發（Class C 已由 pi view-layer guard 擋住 view 改動；Class A 是純設計審查）。Phase 內 touched files 沒有 `.vue` list/table page → script 自動 skip（exit 0），不需主線預判。

   **執行流程**：

   1. **取得 dev server**（per `rules/core/proactive-skills.md` § Dev Server Auto-Spawn）：若本 session 尚未起 dev server，scan free port 3001–3050（避開 3000）`run_in_background` 起，記下 URL；已起則重用。
   2. **收集本 phase touched view files**：`git -C <worktree> diff main..HEAD --name-only -- '*.vue'`（或本 phase commit 的 `.vue` 變更），組成 comma-separated list。
   3. **跑 check**（從 clade central 呼叫，`<clade-vendor>` 解析為 `~/offline/clade/vendor`，與 Step 8a.4 pi-dispatch 同慣例）：

      ```bash
      node <clade-vendor>/scripts/refactor-invariant-check.ts \
        --consumer-path . \
        --dev-server-url http://localhost:<port> \
        --files <comma-separated-touched-vue-paths> \
        --change <change-name> \
        --json
      ```

   4. **解析 exit code + JSON**：
      - **exit 0 `status: "pass"` / `"skip"`** → 通過，繼續該 phase 的 commit / 標 done。
      - **exit 1 `status: "fail"`**（含 `uniform-column` 或 `network` finding）→ **MUST block phase complete**：主線**自己** root-cause（典型：client query param literal 違反 server zod schema `max/min` → 4xx → lookup map empty → column 全 fallback）。**NEVER** 標 phase done、**NEVER** 寫「等 user 在 manual review 抓」、**NEVER** 把整列 fallback rationalize 成「sample-bearing verification deferred」。修完 re-run 至 pass 才繼續。
      - **`harness-error` finding**（agent-browser 起不來 / dev server 連不上）→ **advisory，不 block**（exit 仍 0）。主線一行告知 user「refactor-invariant-check 因 <reason> 未能驗證 <page>，建議手動 sanity check」，繼續流程。

   5. **False positive 出口**：某 column 真的 intentionally 全空（例「備註」大多 row 空）→ 在該 `.vue` template 加 `<!-- @ui-invariant-allow-empty[<column-header>] -->` 註解，re-run 確認 suppressed。**NEVER** 用 marker 掩蓋真壞掉的 column（lookup-resolved column 全 fallback 是 bug，不是 optional）。


6d. **Review Rules Check**（clade fork addition；not in upstream spectra）

   **理由**：pre-commit hook 逐行 grep 漏抓跨行 Vue props；實證見 `references/ui-phase-gates.md` § Step 6d 理由。

   **觸發範圍**：每個 **Class B（UI view）phase** 由主線在 Step 6c 之後、該 phase commit / 標 tasks done **之前**，跑一次。Class A / Class C phase 不觸發。Phase 內 touched files 沒有 `.vue` → skip。

   **執行流程**：

   1. **收集本 phase touched `.vue` files**：`git -C <worktree> diff main..HEAD --name-only -- '*.vue'`，若空 → skip。
   2. **跑 review-rules multi-line scan**：內嵌 node 腳本全文見 `references/ui-phase-gates.md` § Step 6d multi-line scan（讀 `vendor/review-rules/patterns.json`，展平 Vue tag 後 match，stderr 印 `[rule-id] file:line`）。

   3. **解析 exit code**：
      - **exit 0** → 通過，繼續 commit / 標 done。
      - **exit 1** → **MUST block phase complete**：主線依 stderr 的 `[rule-id]` 修正（如 `size="xs"` → 移除 size prop）。修完 re-run 至 exit 0 才繼續。

7. **Implement tasks (loop until done or blocked)**

   **Reminder: Track progress by editing checkboxes in the tasks file only. Do not use any built-in task tracker.**

   **Dispatch reminder**: For each phase, follow Step 6b's three-way classification:
   - Class C（Other）→ 以泛用 dispatcher 的 `spectra-phase-implementation` row dispatch Pi Sol high（phase granularity）
   - Class A（Design Review）→ 主線 Opus 5 xhigh self-execute：**MUST invoke Skill tool** 跑 `/design improve` + `/impeccable audit` 完成全部 tasks（per Step 6b §6 hard rule；NEVER 停下叫 user 自己跑）
     - 這兩支是 Claude Code 內建 skill，不知道 clade Routing Table 存在。它們內文若叫起 `Agent`（含省略 `model` 而繼承主線 Opus 的形狀），照樣會被 PreToolUse:Agent gate default-deny 攔下（per [[agent-routing]] § Routing Table，TD-513）。攔下時 **MUST** 照 block message 走 dispatch／waive／fallback；Design Review 本身仍是主線自己做，**NEVER** 把它變成外派
   - Class B（UI view: component / page / view / layout / styling）→ 主線 Opus 5 xhigh self-execute，永不派 pi（形狀見 Step 6b B 類）。該 phase 實作完、commit / 標 done **之前** MUST 跑 **Step 6c Refactor Invariant Check** + **Step 6d Review Rules Check**
   - Mixed phase（UI view + 非 view 摻同 phase）→ 已開工主線吸收、未開工 STOP 提示 `/spectra-ingest`

   For each pending task:
   - Show which task is being worked on
   - Re-read the sections of design and spec files that are relevant to this task's scope — do not rely on memory from earlier in the conversation, as context may have been compressed
   - **Read the Implementation Contract for this task before editing any source file.** If `design.md` exists and contains an `## Implementation Contract` section (or contract content under another heading the design uses), read the part of it that covers this task's scope. The contract names the observable behavior, interface or data shape, failure modes, acceptance criteria, and scope boundaries you must satisfy. Treat the contract as the durable handoff — it is what the task will be measured against, regardless of who started the change.
   - **Detect unclear or path-only tasks before writing code.** A task is unclear if it:
     - only names files to edit ("edit `foo.rs`", "update `bar.svelte`") with no behavior, contract, or verification target;
     - is vague ("handle edge cases", "wire it up", "make it work");
     - conflicts with the implementation contract (asks for behavior the contract excludes, or omits behavior the contract requires).
       When this happens, pause. Either update the artifact (design or tasks) so the task names a concrete behavior and verification target, or report the blocker and wait for guidance. Do NOT silently guess against unclear requirements.
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
        - **追溯鍵**（clade fork addition）：從 Example 導出的 test **MUST** 帶一行標記
          `// spec: <change-name> :: <Example heading 逐字>`（comment 語法依該 test 檔語言；
          heading 逐字複製，含 CJK 與標點，只有前後空白會被正規化）。Example table → `test.each`
          時標記寫在 `test.each` 之前一行，整張表算一個鍵。
          `tdd: true` 的專案，沒有標記的 Example 會在 `/spectra-verify` 判 **CRITICAL 擋 archive**
          （`tdd` 未開則是 WARNING）。轉寫 pattern 見 `vendor/snippets/bdd-traceability/README.md`。
          **NEVER** 靠「test 用了 example 的相同輸入值」當追溯證據——那是文字啟發式，值被抽成
          constant 或寫法不同就 miss。
   - Make the code changes required
   - Keep changes minimal and focused
   - **Verify before marking done** — re-read the task description from the tasks file AND the relevant Implementation Contract content from design.md. For each requirement stated in the task description and each contract item that covers this task's scope, confirm it is addressed by your changes. Confirm the verification target named by the task (test name, CLI invocation, analyzer check, or manual assertion) actually passes. If any contract item, task requirement, or verification target is missing or failing, implement/fix it now. Do not mark the task complete until every part of the description is covered and the contract for this task is satisfied.
   - Mark task complete by running: `spectra task done --change "<name>" <task-id>`
     This command marks the checkbox in tasks.md AND records which files were modified for this task.

     **Worktree workaround (clade TD-015 / spectra ≤2.3.1)**: when running inside a session worktree (path `<consumer>-wt/<slug>/`), `spectra task done` writes `.spectra/touched/<change>.json` to the current worktree ✅ but its `tasks.md` checkbox flip can land in the Claude Code system-managed agent worktree (`<consumer>/.claude/worktrees/agent-*/`) instead. Workaround:
       1. After `spectra task done`, **MUST** verify `git -C $(pwd) diff -- openspec/changes/<change>/tasks.md` shows the `[ ] → [x]` flip in the current worktree.
       2. If diff is empty → mirror-flip manually with Edit (change `- [ ] <task-id>` to `- [x] <task-id>` on the matching line). The `.spectra/touched/` write already happened, so this is a UI-only sync.
       3. **NEVER** touch `<consumer>/.claude/worktrees/agent-*/`; that's Claude Code harness state — let it GC at session end.
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

7.5. **Gate Chain Pass — iterate-until-green**（clade fork addition — per [[verify-gate-chain]]）

   **觸發**：ALL phases（A + B + C）完成後、Step 8 Final check 之前。

   跑 consumer 的 gate chain（`.claude/rules/local/verify-commands.md` 定義的 L0–L2 指令）：

   ```bash
   # 依序跑。任一 non-zero 即 FAIL
   vp check          # L0 — 或 consumer 定義的替代
   pnpm typecheck    # L1
   pnpm test --run   # L2
   ```

   **全 PASS** → 進 Step 8。

   **任一 FAIL** → iterate-until-green 迴圈（max 5 輪）：

   1. 讀 error output 全文
   2. 分類 error（確定性 / 環境 / 不確定——定義見 [[verify-gate-chain]]）
   3. 修正確定性 error（Edit/Write）
   4. 重跑 gate chain
   5. 同一 error 連續 2 輪不收斂 → 提前 escalation

   **5 輪仍 FAIL** → Output On Pause，附最後一輪 error 全文，escalation_action = ASK。

   **Skip-condition**：consumer 的 `verify-commands.md` 不存在 → 退回既有行為（只跑 `spectra instructions apply --json` 確認 state）。不 block apply 流程。

8. **Final check**

   After completing all tasks AND Step 7.5 gate chain PASS, re-run:

   ```bash
   spectra instructions apply --change "<name>" --json
   ```

   Confirm `state: "all_done"`. If not, review remaining tasks and complete them.

8.5. **Notion ticket status sync — 進行中**（clade fork addition — per [[spectra-notion-coupling]]）

   **Skip-condition**（任一成立即 silent skip）：consumer-meta `notion.ticketWorkflow !== true`；或本 change 的 `proposal.md` 頂部無 `> **Notion ticket**:` 連結。不適用時**不要**硬湊 ticket。

   兩條件都成立時，**MUST**（impl 已 all_done = `/spectra-apply` 真的開工過，符合 REFERENCE.md §3 `→ 進行中` 觸發）：

   1. 從 `proposal.md` 頂部抓 ticket `page_id`，從 consumer-meta `notion.dataSourceId` 抓 data source。
   2. `notion-fetch collection://<dataSourceId>` 重撈 schema 校對 property key（中文 + 全形空格 + `>=`，憑記憶必錯）。
   3. 確認該 change 有 active claim（per [[work-claims]]）。
   4. ticket 狀態若停在 `未開始` / `需確認` → 依 `~/.claude/skills/_notion-<consumer-b>-board/REFERENCE.md §3` 授權表推 `→ 進行中`；已是 `進行中` / `驗收中` → no-op。

   - **NEVER** 在此推 `驗收中`（需 git tag，archive → `/commit` 發版後才有；見 spectra-archive Step 8 + [[spectra-notion-coupling]]）。
   - **NEVER** 碰客戶側轉移（`驗收中→完成` 等）或 `發布日期` / `驗收日期` / `名稱` / `驗收完成` 欄位。

8a. **Verify Channel Pass**（Step 8b 前 hard gate）

   **Model allocation**（收集與判定是兩個角色，各自一個檔位；**NEVER** 合寫成一句，那會讓檔位判不出來）：

   | 角色 | 範圍 | 檔位 |
   | --- | --- | --- |
   | **收集**（輸出不是 gate） | Step 8a 全部（含 8a.5 / 8a.6 / 8a.7）跑 verify channel、截圖、hook、sweep | **Pi Grok-4.6 low**（`--model grok-xai`） |
   | **判定（gate）** | 截圖收集完成後分析每張截圖是否匹配對應要求（防止亂截圖搪塞） | **pi GPT-5.6-sol xhigh** |

   Read `tasks.md` `## 人工檢查` 找未勾 `[verify:e2e]` / `[verify:api]` / `[verify:ui]` / `[verify:<a>+<b>]` / deprecated `[verify:auto]` items。**MUST** 先處理完所有 verify channels 才進 Step 8b。

   **Skip-condition**：`## 人工檢查` 沒任何未勾 `verify:*` item → 直接跳 Step 8b。

   Cookbook 與範本入口：`vendor/snippets/verify-channels/README.md`。

   **Pre-verify baseline check + 自接路徑**：dispatch 任何 verify channel 前 **MUST** 完整讀 `references/verify-channels.md` § Pre-verify——per-channel baseline 檢查、mis-marked item reclassify（TD-176）、以及 baseline 存在但功能性缺時的 (a)(b)(c)(d) self-collect chain（預設派背景 pi，per [[pitfall-verify-evidence-handoff-instead-of-self-collect]]）。**四層全失敗才**寫 `deferred` annotation 且 MUST 註明已嘗試 path；主線收 pi JSON evidence 後 **MUST 抽查至少一項**再寫 annotation。

   **執行流程**：**MUST** 完整讀 `references/verify-channels.md` § 執行流程，逐 channel 執行——`[verify:e2e]` 主線寫 Playwright spec、`[verify:api]` 主線跑 HTTP round-trip、`[verify:ui]` 走 pi dispatcher + **Screenshot Match Analysis gate**（收集 medium / 判斷 xhigh 分離）、multi-marker 依 `e2e → api → ui`、deprecated `[verify:auto]` 視為 `[verify:api+ui]`。evidence 一律走 `evidence-store.ts` 寫入（payload 進 sidecar，短 marker 貼 tasks.md）。

   **反 bypass（hard rule — 2026-06-11 audit 實證）**：

   - **NEVER** 派 general-purpose / worktree / 臨時 Claude subagent 自跑 playwright / agent-browser 收 `verify:ui` evidence — 唯一入口是 `screenshot-review` 這支具名 agent（`Agent` tool，`subagent_type: screenshot-review`）。本條擋的是「繞過具名 agent」，**NEVER** 因 2026-08-22 收回 Pi 外派而讀成放寬
   - **NEVER** 派 Pi 任一 model 收本 channel 的 evidence（2026-08-22 起）——`pi-dispatch-screenshot-verify.ts` 已 fail-closed、`pi-routing-policy.ts` 對該 table-row 直接 throw；理由見 [[review-gui-surface]] § 為什麼只准 Claude subagent
   - **NEVER** 跳過 Screenshot Match Analysis 直接寫 `(verified-ui:)` annotation — 收集與判斷分離是防搪塞的核心機制

   **Guardrails**：
   - **NEVER** 要求 user 在 GUI 確認 `[verify:e2e]` / `[verify:api]` automatic-only items；annotation pass 後 helper 自動 done。
   - **NEVER** 對含 `[verify:ui]` 的 item 代勾 `[x]`；final-state screenshot 需要 user eye。
   - **NEVER** 在沒有成功 evidence 時寫 `(verified-<channel>:)` annotation。
   - **NEVER** 派 screenshot-review agent 負責 mutation / form fill / multi-role login；改用 `verify:e2e` 或 `verify:api`。

8a.5. **Manual-Review Pattern Re-check** (clade fork addition — pre-handoff `## 人工檢查` hygiene gate before Step 8b)

   **理由**：`## 人工檢查` items 會在 Step 7 implementation 期間漂移；失效鏈實證見 `references/pre-handoff-checks.md` § Step 8a.5 理由。跑與 `/spectra-propose` Step 3a 同一支 enforcement hook：

   ```bash
   bash scripts/spectra-advanced/post-propose-manual-review-check.sh <change-name>
   ```

   Exit 2 = pattern findings (any of `ABSTRACT_REFERENCE` / `CARD_WITHOUT_UID` / `UI_ITEM_NO_URL` / `MULTI_STEP_NOT_SCOPED` / `REVIEW_UI_BACKEND_ROUNDTRIP` / `INTERNAL_JARGON_LEAKAGE`). Main thread **SHALL** Edit `tasks.md` directly to fix findings inline per hook stdout remediation guidance — do NOT round-trip to `pi` (slow). Reference: `vendor/snippets/manual-review-enforcement/patterns.json` + `rules/core/manual-review.data-readiness.md`.

   Legitimate false positive (e.g., 真機掃 SMS 無 dev replay endpoint, sample inline value `weekly_target=5000`) → add `@no-manual-review-check[<reason>]` trailing marker per `manual-review.md`「`@no-manual-review-check` Marker」, re-run hook to confirm bypass recognized, then proceed.

   Hook exits 0 → proceed to Step 8b silently.

8a.6. **Pre-Manual-Review Self-Analysis** (clade fork addition — Layer E.1 of pre-handoff quality gates; not in upstream spectra)

   **理由**：user **NEVER** 該是第一個在 GUI 發現 trivial UX / data defect 的人；實證見 `references/pre-handoff-checks.md` § Step 8a.6 理由。

   **Model allocation**（收集與判定是兩個角色，各自一個檔位；**NEVER** 合寫成一句）：

   | 角色 | 範圍 | 檔位 |
   | --- | --- | --- |
   | **收集**（輸出不是 gate） | E.1 五維 evidence 收集 | **Pi Grok-4.6 medium（`--model grok-xai`）** |
   | **判定（gate）** | E.1 對收集結果做五維判定 | **pi GPT-5.6-sol xhigh** |
   | **判定（gate）** | E.2 cross-model second opinion（另起 session 獨立審） | **pi GPT-5.6-sol xhigh** |

   **MUST** before Step 8b handoff 先派 **Pi Grok-4.6 medium（`--model grok-xai --table-row spectra-prehandoff-collect`）** 跑 5-dimension 收集（template 見下）。
   收集回來後 **MUST** 另派 **pi GPT-5.6-sol xhigh** 對收集結果做 5-dimension 判定——判定是 gate，**NEVER** 與收集併在同一次 dispatch：

   **E.1 + E.2 執行**：**MUST** 完整讀 `references/pre-handoff-checks.md` § Step 8a.6 執行——E.1（pi medium 收集 5-dimension evidence → pi xhigh 判定 → 主線寫 finding report、FAIL 補 `（issue:）` / strip 假 annotation → `pre-handoff-ledger.ts record`）與 E.2（`pi-dispatch-pre-handoff-check.ts` cross-model 獨立審；fallback Claude subagent，**NEVER** 憑記憶補、**NEVER** 跳過 cross-check 直接 handoff）。**No finding report written → NO Step 8b handoff — this is the gate**；E.1 record 由 `archive-gate.sh` Check 7 機械強制。

   **Level**：Phase 2 為 **warning / soft-gate**——E.1 + E.2 都 MUST 跑、findings MUST 寫成 `（issue:）` annotation 讓 user 在 review-gui 看到，但**不** hard-block workflow。升 hard gate 的 rollout 狀態與 soak 評估指令見 `references/pre-handoff-checks.md` § Step 8a.6 rollout 狀態。

   **Reuse Step 6c / Layer C**: D3 / D5 是 `refactor-invariant-check.ts`（Layer B）偵測的；D4 是 `audit-data-sanity.ts`（Layer C）偵測的。已跑過就 cite 結果，不必重跑。

8a.7. **Screenshot Staleness Sweep + Auto-reshoot** (clade fork addition — mechanical gate before Step 8b handoff)

   **理由**：後續步驟的 commit 會讓先前截圖 mtime < last UI commit → review-gui 顯示 ⚠ 截圖過時；把「重拍 stale」從 behavioral rule 升成 mechanical gate。失效鏈見 `references/pre-handoff-checks.md` § Step 8a.7 理由。

   **觸發條件**：`## 人工檢查` 含至少一個 `[verify:ui]` item 且 `screenshots/local/<change>/` 目錄存在。否則 silent skip。

   **執行流程**：**MUST** 依 `references/pre-handoff-checks.md` § Step 8a.7 執行——`audit-screenshot-staleness.ts` → LEGACY 清理 → STALE 重拍（pi medium + Screenshot Match Analysis）→ 重跑 audit 至 `stale` 為 0（最多 2 輪）→ selective commit 更新截圖。

   **Skip 條件**：
   - 無 `screenshots/local/<change>/` 目錄（純 backend change）
   - `## 人工檢查` 無 `[verify:ui]` item
   - audit 回傳 0 stale + 0 legacy（首次就乾淨）

   **NEVER**：
   - 跳過本 step 直接進 8b — stale 截圖到 review-gui 是已驗證的 user-friction 源
   - 讓 user 在 review-gui 看到 stale warning 後手動 relay 回 Claude session 重拍

8b. **Manual review handoff**

   **MUST** 先跑 `bash scripts/spectra-advanced/pre-handoff-readiness-check.sh <change-name>`。Exit 2 = NOT READY — 修完 blockers 再重跑直到 exit 0。Exit 0 才進 handoff message。

   **Notion 專案層同步**（clade fork addition；per [[spectra-notion-coupling]] § 專案層）：readiness check 通過後、送出 handoff message **之前**，consumer 的 `.claude/consumer-meta.json` 若有 `notion.projectWorkflow: true` 則 **MUST** 執行：

   ```bash
   node ~/offline/clade/vendor/scripts/notion-sync.ts handoff --consumer-path . --change <change-name> --json
   ```

   本指令會依 tasks.md 現況**補正全部** Task 狀態——Step 7 的實作期間 phase 勾選會漂移，這是唯一一次全面對齊的機會。`needsDecision` 非空 → **MUST** 逐條 `AskUserQuestion` 後帶答案重跑；**NEVER** 因為判定不了就略過不提。未啟用 `projectWorkflow` → script 自行 exit 0。

   When tasks.md still contains unchecked items in the `## 人工檢查` section (typical at this point — implementation tasks `[x]` but manual-review items `[ ]`), **MUST** hand off to the local manual-review GUI rather than walking through items inline in chat.

   **Pre-handoff evidence-missing self-collect**（hard rule，clade fork addition — per [[pitfall-verify-evidence-handoff-instead-of-self-collect]]）：

   走 review-gui handoff message **之前**，**MUST** 對每個 `## 人工檢查` 未勾且帶 `[verify:*]` marker 的 item（含 `[verify:e2e]` / `[verify:api]` / `[verify:ui]` / verify multi-marker）跑：

   1. **解析 item 描述抽 URL + expected observation + screenshot path**（若 description 模糊到無法抽 → 標 `（issue: pre-handoff self-collect 無法解析 item description；need clarification）`，跳該 item）
   2. **依 Step 8a Baseline-exists-but-functional-gap 自接路徑 (a)(b)(c)(d) 順序嘗試 self-collect**（subagent 寫 `deferred` 回來時若沒附「已嘗試 (a)(b)(c)(d)」紀錄 → 主線 **MUST** 自己再跑一輪 (a)(b)(c)(d)，**NEVER** 把 subagent 的 deferred 直接 forward 給 user）
   3. **成功** → 寫對應 `(verified-e2e:)` / `(verified-api:)` / `(verified-ui:)` annotation（review-gui auto-check helper 會自動勾 `[x]`）
   4. **失敗** → 保留 `[ ]` + 寫 `（deferred: tried (a)(b)(c)(d), <reason>; 需 user 親自跑）` annotation，註明已嘗試 path 避免 user 重複試

   跑完一輪後**仍有** evidence-missing items → 才走以下 DEFAULT path review-gui handoff message。

   **Default flow** = 「主線已自跑一輪 self-collect、剩下真需要 user 拍板（真機 / 視覺主觀 / production 授權 / OAuth-only path 不可達）的才 surface」。
   **NEVER** 在主線未嘗試 self-collect 一輪的情況下丟整批 evidence-missing 給 user 自己點 review-gui「📋 補 evidence prompt」按鈕（per [[manual-review]] § review-gui 補 evidence prompt 路徑分類：補 prompt 是 fallback 不是 default）。

   **Mechanical readiness gate（per [[review-gui-surface]] MUST 9）**：handoff message 之前 **MUST** 跑 script 確認 `bucket=ready`：

   ```bash
   node ~/offline/clade/vendor/scripts/check-review-readiness.ts \
     --repo . --change <change-name>
   ```

   - **exit 0** → 可發 handoff message
   - **exit 1** → 讀 `bucket` + blocking 數據，auto-triage（dispatch fix / self-collect / triage）後**重跑 script**
   - **exit 2** → STOP，回報 script 失敗

   **NEVER** 自判 bucket、NEVER 跳過 script — Claude 自判已 9 次證明不可靠。

   - **DEFAULT path**（**MUST** script exit 0 才發）：handoff message 措辭 **MUST** 照 `references/pre-handoff-checks.md` § Step 8b DEFAULT message 範本（主線從 clade home 啟動 review GUI並確認 ready + review-gui deep-link + GUI 行為說明）。
   - **MUST 直接給 review-gui deep-link**（per `rules/core/proactive-skills.md` § Inline Review-GUI Deep-Link）：訊息 **MUST** 含 `http://127.0.0.1:5174/review/<consumer-id>:<change-name>` 完整 URL（`<consumer-id>` 從 `~/offline/clade/registry/consumers.json` 抓；缺 prefix 會 fallback 到 clade mainEntry → API 404）。**NEVER** 寫「請在 worktree root / main consumer root 執行」當預設措辭、**NEVER** 列 dev server URL 當替代、**NEVER** 叫 user cd worktree 跑 `pnpm dev`——需要 fresh screenshot 時由 agent 自起 dev server（per `rules/core/proactive-skills.md` § Dev Server Auto-Spawn）。cross-consumer mode 偵測、`preflightCladeOnly` guard、port fallback 的機制說明見 `references/pre-handoff-checks.md` § Step 8b review-gui deep-link 機制。
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

**Completion evidence gate**（clade fork addition — 輸出「Implementation Complete」前 MUST 逐格自查；每格附「實跑命令＋輸出摘尾」，貼不出證據＝該格未完成，不准宣告完成）：

- [ ] `spectra instructions apply --change "<name>" --json` 回傳 `state: "all_done"`（貼該欄位輸出行）
- [ ] typecheck / test / lint 全綠（貼各命令與最後幾行輸出；worktree 內實跑，不引用歷史結果）
- [ ] Step 8a verify-channel annotations 已寫入 tasks.md（貼其中一條 annotation 行）

三格證據放進下方 Output On Completion 的 `### Evidence` 段。

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

### Evidence
- spectra state: `"state": "all_done"`（<實跑輸出行>）
- gate chain: L0 `vp check` PASS / L1 `pnpm typecheck` PASS / L2 `pnpm test --run` PASS（<每項指令的最後一行 output>）
- iterations: <gate chain 跑了幾輪，首輪即 PASS 則寫 "1/5 (first-pass green)">
- annotations: <tasks.md 其中一條 (verified-*) annotation 行>

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
- **Worktree isolation — NEVER halt apply on main's WIP**: Step 0 必須自動把 user 帶進 worktree（用 commit-then-fork 或 clean fork，視 scope 而定）；無論 Step 0c 階段或 apply 進行中，**NEVER** 因 main repo 的 dirty WIP / staged / untracked / 同檔別 session WIP 中斷 apply、AskUserQuestion 要 user clean main、或建議 user 自己處理後重試。worktree 是獨立 working tree，main 的 WIP 不在 worktree 也無法影響它；同檔衝突是 merge-back 時的事，由 `/spectra-commit` + user 決策處理。唯一合法 STOP 是 unmerged conflict（wt-helper 拒絕 fork）或 helper 本身錯誤；user-decision-needed pause **NEVER**。
- **Phase dispatch discipline**（per `agent-routing.md`）:
  - **NEVER** dispatch Design Review phase to pi — Design skill is Claude Code first-class
  - **NEVER** dispatch UI view phase（component / page / view / layout / styling）to any runtime — Pi 任一 model 與 Claude subagent 都算。實作與品質判定（Step 6c / 6d、Design Review）都留主線 Opus（per Step 6b B 類）。Frontend 但非 view 的（store / hook / API client / type / util）仍走 sol
  - **NEVER** dispatch **Phase Dispatch（Step 6b）** with `medium` effort — use `high` minimum。Step 8a 系列的收集工作允許 `medium`（見 Step 8a Model allocation）
  - **NEVER** dispatch task-by-task — phase granularity only
  - **NEVER** dispatch a pi phase without including the「view-layer guard」instruction in the prompt — without it, pi tends to incidentally touch `.vue` / `.tsx` files
  - **NEVER** dispatch a pi phase without including the「Plan-first」instruction in the prompt — without it, 主線只能從 `git diff` 反推 pi 意圖，cross-check 易漏「漏做的 task」與「踩到 view 層」這類 drift（per `agent-routing.md` Plan-first 條目）
  - **NEVER** skip view-layer drift check after pi completion — `git diff --name-only` filtered by view paths is the primary quality gate
  - **NEVER** auto-fix mixed phases by editing tasks.md mid-apply — that belongs to `/spectra-ingest`; for未開工 mixed phase, STOP and instruct the user to run ingest
  - **NEVER** skip cross-check after pi phase completion — read tasks.md, confirm checkboxes, run typecheck/test, review diff
- If **AskUserQuestion tool** is not available, ask the same questions as plain text and wait for the user's response

**Fluid Workflow Integration**

This skill supports the "actions on a change" model:

- **Can be invoked anytime**: Before all artifacts are done (if tasks exist), after partial implementation, interleaved with other actions
- **Allows artifact updates**: If implementation reveals design issues, suggest updating artifacts - not phase-locked, work fluidly
