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
Edit at: <clade-central-repo>
Local edits will be reverted by the next sync.
-->


Implement tasks from a Spectra change.

> **Ownership**（clade fork；cross-phase matrix in `rules/core/spectra-workflow.md`）：apply 負責 code 正確性 + Class B UI view phase refactor invariant（Step 6c / Layer B：無 column 整欄 fallback + 0 個 4xx/5xx）+ Design Review data-sanity（Layer C：client param vs server schema bound）+ pre-handoff 5-維度 cross-check（Step 8a.6 / Layer E.1 主線 + E.2 codex）。**不**負責 user 主觀視覺 / UX 真人驗收（manual review / review-gui 管）。

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

   c. **Pre-fork baseline guard + 自動建 worktree**（idempotent）：

      Spectra-apply 走 **commit-then-fork** — 有 change context，把屬於這條 change 的 baseline 自動 commit 上 main 再 fork，避免 worktree 看不到 main 的 untracked / modified baseline（[[worktree-default]] §1 Pre-fork baseline guard）。

      **c.1 — 偵測 main dirty**：

      ```bash
      node scripts/wt-helper.mjs detect-main-dirty --json
      ```

      解析回傳 `{ modified, untracked, conflicted }`：

      - **conflicted 非空** → STOP，回報 user 解 conflict 再重試（wt-helper 拒絕自動處理 unmerged）
      - **modified + untracked 為空**（clean）→ 跳到 c.4 直接 fork
      - **modified + untracked 非空** → 進 c.2 做 scope filter

      **c.2 — Scope filter（主線自己做，不靠 wt-helper）**：

      把 dirty paths 分成 **scope-in**（屬於這條 change 的 baseline）vs **scope-out**（其他）。三來源 union：

      1. 讀 `.spectra/touched/<change-name>.json`（若存在；spectra-commit 上次 sync 寫入）— 列出的 path 為 scope-in
      2. Grep `openspec/changes/<change-name>/proposal.md` + `openspec/changes/<change-name>/specs/**/*.md`，找 `packages/` / `server/` / `app/` / `supabase/` / `scripts/` 等 module path 提及；任一 dirty path 是它們的子路徑或開頭命中 → scope-in
      3. Fallback：dirty path basename 或開頭跟 change name slug 的 word 命中 → scope-in

      其餘 dirty → scope-out。

      **c.3 — 三情境決策**：

      | 情境 | 行為 |
      | --- | --- |
      | scope-in 非空 + scope-out 為空 | 直接走 c.4，commit-then-fork |
      | scope-in 非空 + scope-out 非空 | 印分類報告給 user（scope-in N 條 / scope-out N 條）後走 c.4，commit **只**包 scope-in；scope-out 留在 main 不動 |
      | scope-in 為空（無論 scope-out 為空或非空、無論三來源是否對得上）| 直接走 c.4 **clean fork**；若 scope-out 非空，印一行通知：`main 有 <N> 條 dirty 不屬於本 change，已留在 main 不動，worktree 從 HEAD fork`。**NEVER** STOP / AskUserQuestion / 要求 user 先 commit/stash —— worktree 隔離已處理 main WIP 對 apply 的影響；同檔衝突是 merge-back 時的事，不在 apply 範圍 |

      **c.4 — Fork（commit-then-fork 或 clean fork）**：

      ```bash
      # 有 scope-in baseline 要 commit
      node scripts/wt-helper.mjs add <change-name> \
        --precheck-baseline <change-name> \
        --baseline-strategy commit \
        --baseline-scope-paths <comma-separated-scope-in-paths>

      # 或：main clean / user 選 (b) cross-session 不動 dirty
      node scripts/wt-helper.mjs add <change-name>
      ```

      Helper 用 change name 當 slug，內部 normalize（lowercase / 空白轉 `-` / collapse 重複 `-`）。commit 策略時 helper 跑 selective stage（`git add -- <scope-paths>`，**禁** `git add -A`）+ commit `baseline: <change-name> pre-fork sync` + fork。Helper 行為與失敗處理見 `plugins/hub-core/skills/wt/SKILL.md`。

      若 helper fail with `Worktree path already exists` → slug 對應 worktree 已存在（前次 session 建過、未清掉），**沿用即可**，視為成功；用 `node scripts/wt-helper.mjs list --json` 抓既有 path。**注意**：既有 worktree 不會再跑 baseline guard，若 main 仍有屬於本 change 的 dirty baseline，必須 user 自己 commit 後 worktree 內 `git pull` 或 cherry-pick。

      其他 helper 錯誤 → 報錯並 STOP，**不要**降級回「在 main 跑」。

   c.5. **Main-side unpark + commit-to-git**（clade fork addition；critical data-safety guardrail，per `docs/pitfalls/2026-05-22-agent-tool-subagent-worktree-bypass.md`）：

      **理由**：spectra v3 `spectra park` 把 artifacts 從 disk 搬進 `.git/spectra-app/spectra.db` SQLite blob（**不在 git tracked file**）；後續 `spectra unpark` 會 restore artifacts 到 cwd 的 worktree disk 並把 SQLite parked 條目刪除。若 unpark 在 Claude Code `Agent` tool dispatched subagent 的 ephemeral cwd（`.claude/worktrees/agent-*/`，session 結束 GC）跑 → artifacts 寫進去就被 GC 清掉、SQLite 也沒了 → **永久遺失**（co-purchase 已撞，99 tasks + 5 specs + proposal 蒸發）。

      因此 **MUST** 在 dispatch subagent **之前**，由主線在 main worktree（**或** Step 0c 剛 fork 出的 session worktree — 兩者都是 persistent disk，非 ephemeral）跑 unpark + commit-to-git，artifacts 落 git tracked file，subagent fork 出去後天然帶過、不再依賴 SQLite blob。

      **執行流程**：

      1. **偵測是否 parked**：

         ```bash
         spectra list --parked --json | jq -r '.parked[]?' | grep -Fx "<change-name>"
         ```

         - 命中（change 在 parked 列表）→ 繼續執行 unpark
         - 未命中 → artifacts 已在 disk / git（可能 propose 階段 Option A 已 commit、或前次 apply session 已處理），跳過此步進 Step 0d

      2. **主線在 main 跑 unpark**（**禁止**在 subagent / ephemeral worktree 跑；本步驟發生在 dispatch 之前，主線 cwd 仍是 main）：

         ```bash
         spectra unpark "<change-name>"
         ```

         Unpark 把 artifacts blob restore 到 main worktree disk 的 `openspec/changes/<change-name>/`。SQLite parked 條目被刪除（這是 unpark 的正常行為）。

      3. **selective stage + commit to git**（讓 artifacts 進入 git tracked，不再依賴 SQLite）：

         ```bash
         git add openspec/changes/<change-name>/
         git commit -m "📝 docs(spectra): unpark artifacts for <change-name> before apply"
         ```

         **禁止** `git add -A` / `git add .`（會撈到 main 上其他 user WIP）；**禁止** `--no-verify`（per `rules/core/commit.md` hard rule）。

      4. **若 Step 0c 已 fork session worktree**：主線在 main 跑完 unpark + commit 後，worktree 是基於 main HEAD fork 的（在 Step 0c.4 建好），尚未看到剛剛 commit 的 artifacts。**MUST** 在 worktree 內同步：

         ```bash
         git -C <worktree-absolute-path> pull --ff-only
         ```

         或等價的 `git -C <wt> fetch && git -C <wt> reset --hard origin/main`（視 consumer workflow_model 而定）。Worktree 拿到 artifacts 之後 subagent dispatch 才看得到。

      5. **若 Step 0c 跑 commit-then-fork（c.4 已 commit baseline）**：unpark 的 commit 是 main 上**繼 baseline 之後**的新 commit；worktree 需要 sync 到 main 最新 HEAD 才看得到 artifacts，方法同 step 4。

      **Failure handling**：

      - `spectra unpark` 失敗（SQLite blob corrupt / change name typo）→ STOP，回報 error，**不要** dispatch subagent；user 解掉 unpark issue 再重試 `/spectra-apply`
      - `git commit` 失敗（pre-commit hook fail / no changes to commit）→
        - `no changes to commit`：artifacts 已在 git，視為成功，繼續
        - hook fail：STOP，回報 hook 拒絕原因，user 修完 artifacts 再重試
      - `git pull --ff-only` 失敗（worktree 有 commit 跟 main 衝突）→ 罕見情境（worktree 是 fresh fork from main，理論上 ff 安全）；STOP，回報並讓 user 手動 sync

      **NEVER**：

      - **NEVER** 在 Agent tool dispatched subagent 內跑 `spectra unpark`（Agent tool 的 cwd 是 ephemeral `.claude/worktrees/agent-*/`，unpark 寫的 artifacts 會被 session GC 清掉 → permanent data loss）
      - **NEVER** 跳過此步直接 dispatch subagent 期望 Step 2 在 subagent 內跑 unpark — Step 2 的 unpark 路徑已標記為 fallback only，主線預先做才是 default
      - **NEVER** 用 `git add -A` / `git add .` stage artifacts — 會把 main 上其他 user WIP 一起 commit
      - **NEVER** 透過 `Skill` tool 或 `Agent` tool 委派此步給 subagent — 必須主線自己跑（subagent 的 cwd 不可信）

   d. **Internally dispatch via `/wt` Form 3**：

      Invoke the Skill tool with `/wt <change-name>: /spectra-apply <change-name>` (Form 3 per `plugins/hub-core/skills/wt/SKILL.md`). `/wt` orchestrates the worktree lifecycle (reuses the one prepared in Step 0c) and spawns a subagent that runs Step 1+ inside it. Subagent reports completion or structured failure back through `/wt`'s normal channel; parent cwd stays on main throughout.

      Wait for the dispatched skill to return, surface its report to the user, and STOP — do **not** re-enter Step 1 in the parent session.

      **Fallback** — if the Skill tool / `/wt` dispatch is unavailable in this environment (rare degradation; e.g., minimal runtime without skill support), emit a status-only message:

      ```
      Worktree at <worktree-absolute-path> ready; please run `/spectra-apply <change-name>` from inside it manually.
      ```

      No `cd … && claude` oneliner under any branch. `<worktree-absolute-path>` 從 wt-helper 輸出抓；`<change-name>` 是 Step 0a 已解析的 name.

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

     **clade fork data-safety guard**（per `docs/pitfalls/2026-05-22-agent-tool-subagent-worktree-bypass.md`）：在 Step 0c.5 規約之下，主線理應已在 dispatch 之前跑過 unpark + commit-to-git。本路徑能命中表示 Step 0c.5 被跳過（罕見：cwd 已在 worktree、Bypass 條件、或主線 skill 邏輯被覆寫）。

     **Detect cwd**：

     ```bash
     git rev-parse --show-toplevel
     git rev-parse --git-dir
     ```

     - 若 cwd 看起來像 ephemeral agent worktree（`git-dir` 路徑含 `.claude/worktrees/agent-` 片段）→ **STOP**，回報：
       ```
       ⚠ spectra unpark must run on main worktree or persistent session worktree, NOT inside Agent tool dispatched subagent.
       This subagent's cwd is `.claude/worktrees/agent-*/`, which Claude Code will GC at session end.
       Running unpark here would write artifacts to a path that disappears → permanent data loss
       (see docs/pitfalls/2026-05-22-agent-tool-subagent-worktree-bypass.md).

       Action: cancel this run; from main session run `/spectra-apply <change>` which will execute
       Step 0c.5 main-side unpark + commit-to-git before dispatching the subagent.
       ```
       **NEVER** 自行嘗試 unpark / 用 AskUserQuestion 給「強制 unpark」選項 — 沒有合法的「在 subagent 內 unpark」路徑。

     - 若 cwd 在 main / `<consumer>-wt/<slug>/` 等 persistent worktree → 繼續以下 fallback 流程：

       Inform the user that this change is currently parked（暫存）.
       Use the **AskUserQuestion tool** to ask whether to continue.
       Two options:
       - **Continue**: Unpark the change and proceed with apply
       - **Cancel**: Stop the workflow

       If the user chooses to continue:

       ```bash
       spectra unpark "<name>"
       ```

       **Post-unpark commit**（clade fork addition；防 SQLite-only state）：unpark 把 artifacts restore 到 cwd worktree disk，SQLite parked 條目被刪。**MUST** 立刻 commit 到 git，避免下次 session 又需重做：

       ```bash
       git add openspec/changes/<name>/
       git commit -m "📝 docs(spectra): unpark artifacts for <name> before apply"
       ```

       **禁止** `git add -A`；commit 失敗（hook reject / no changes）視同 Step 0c.5 同名情境處理（no changes = 視為成功；hook fail = STOP）。

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

   Scan namespaced stashes related to this change before starting work. Catches resume scenarios where the previous session's WIP got auto-stashed by wt-helper / propagate / clade-publish and never reapplied — without this, apply will run on a clean baseline while real WIP rots in stash.

   - Run: `node scripts/stash-reconcile.mjs --slug "<change-name>" --json`
   - Parse stdout JSON. If `entries.length === 0`, continue silently to Step 3.
   - If hits: print one-line summary `⚠ Stash Reconcile: N entries match slug '<change>'`, then use **AskUserQuestion**:
     - **Show full report** — print each entry's `ref`, `namespace.kind`, `createdAt`, file list, and `recommendation.action`/`recommendation.reason`; then re-ask the same question
     - **Apply recommended** — for every entry where `recommendation.action === "apply"`, run `git stash apply <ref>` (safety contract: NEVER `pop` / `drop` here; the stash entries stay intact). Then continue to Step 3.
     - **Ignore and continue** — proceed with apply on current tree without touching stash
     - **Stop cycle** — abort spectra-apply (user will reconcile manually)
   - **Skip condition**: if user passed `--no-reconcile` (or said "不要掃 stash" / "skip reconcile" when invoking the skill), skip this step and print `Stash reconcile: skipped (user --no-reconcile)`.
   - **Failure handling**: if `stash-reconcile.mjs` exits non-zero or JSON parse fails, print the error and continue to Step 3 (reconcile is advisory — do NOT block apply).

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

   Per `agent-routing.md` § Orchestration Residency。Residency 規則上線 6 天 audit 實證：eligible（純非-view + tasks.md 定稿）change 採用率 1/3 — 2 條被主線自做、0 dispatch。「主線自行判斷 residency」已證實不可靠，classify + record 改為機械步驟。**每一條** change 開工都要 classify + record，不是只有看起來像純後端的那條。

   1. **MUST** 跑 classifier 拿 verdict（開工後、動任何 phase 之前）：

      ```bash
      node ~/offline/clade/vendor/scripts/residency-classify.mjs classify --change openspec/changes/<change>
      ```

      stdout JSON：`{verdict: "codex-primary" | "claude-primary", phases: [...]}`。

   2. **MUST 立刻** record decision（決定實際 executor 後、第一個 dispatch / 第一個 Edit 之前）：

      ```bash
      node ~/offline/clade/vendor/scripts/residency-classify.mjs record \
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
        → **主線 Claude Opus 4.8 xhigh 自己做**，**永不**派 codex
        → Design skill is Claude Code first-class; codex tooling weak in this domain
      - **B. UI view phase** — phase 內任一 task 描述/路徑指涉 view 層檔案：`.vue` / `.tsx` / `.jsx` / `app/pages/` / `app/components/` / `pages/` / `components/` / `views/` / `layouts/` / `.css` / `.scss` / Tailwind class 變動，**且**該 phase 沒有摻入非 view 的 frontend / backend 工作（store / hook / API client / type / util / migration / API server）
        → **主線 Claude Opus 4.8 xhigh 自己做**，**永不**派 codex
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

      Worktree workaround（clade TD-015 / spectra ≤2.3.1）：
      你在 session worktree 內跑 `spectra task done` 時，`.spectra/touched/` 會正確寫到當前 worktree ✅，
      但 tasks.md 的 `[ ] → [x]` 翻轉可能寫到 Claude Code system-managed agent worktree（`<consumer>/.claude/worktrees/agent-*/`），
      導致**當前 worktree 的 tasks.md 沒翻**。每跑完一次 `spectra task done`：
      1. `git -C $(pwd) diff -- openspec/changes/<change>/tasks.md` 確認當前 worktree 看得到 `[ ] → [x]`
      2. 若 diff 空 → 手動 Edit tasks.md 把對應行 `- [ ] <task-id>` 改成 `- [x] <task-id>`
      3. **NEVER** 動 `<consumer>/.claude/worktrees/agent-*/` 內任何檔（harness 自管，session 結束會 GC）

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

      Commit Authorization（**MUST**，per `.claude/rules/agent-routing.codex-watch-protocol.md` § Commit Authorization）：
      完成 phase <N> 全部 tasks 後，**MUST** 在 worktree 內 commit 一次（一 phase 一 commit）：

      1. **Commit 前 self-check（任一條命中即 abort、NEVER commit）**：
         - View-layer drift：

           git diff --staged --name-only | grep -E '\.vue$|\.tsx$|\.jsx$|\.css$|\.scss$|app/(pages|components|layouts)/|^(pages|components|layouts|views)/'

           命中 → 回報 "view layer drift: <files>" 並中止
         - Scope discipline：

           git diff --staged --name-only

           對比本 phase 預期落點 — 超出範圍 → 回報 "scope drift: <files>" 並中止
      2. **Selective stage**：`git add -- <each scoped file path>` — **禁止** `git add -A` / `git add .`（會撈到 baseline）
      3. **Commit**：

         git commit -m "🧹 chore: wt <change-name>-phase-<N> — <一行說明>"

         - **MUST** 用 `🧹 chore: wt <change-name>-phase-<N>` format（emoji-conventional commitlint 合規；主線用 `git log main..HEAD` 對齊 phase）
         - **禁止** `--no-verify`（per `rules/core/commit.md` hard rule，hook 擋住代表 phase 內容有問題，必須修而非繞）

      仍禁止：`git push` / `git stash`（中途）/ `git commit --amend` / `/commit` / `/spectra-commit` / 跨 phase 混 commit。

      Acceptance：所有 phase <N> 的 tasks 完成、checkbox 已勾、相關 typecheck / unit test 通過、phase commit 已在 worktree 內成立、`git log main..HEAD` 顯示 `🧹 chore: wt <change>-phase-<N> — ...`。
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

   4. After `<task-notification status=completed>` — codex 已在 worktree 自 commit per § Commit Authorization：
      - BashOutput → read full stdout
      - Read tasks.md → confirm phase <N> all checkboxes are `[x]`
      - **MUST commit boundary check**: `git -C <wt> log main..HEAD --oneline` — confirm exactly one new commit per dispatched phase, format `🧹 chore: wt <change>-phase-<N> — ...`. Multiple commits per phase / missing commit / format mismatch → AskUserQuestion: [1] 主線 squash codex 的 multiple commits / [2] `git -C <wt> reset --soft main` 退 staging 重派 / [3] 中止
      - **MUST view-layer drift double-check**: `git -C <wt> diff main..HEAD --name-only -- '*.vue' '*.tsx' '*.jsx' '*.css' '*.scss' 'app/pages/**' 'app/components/**' 'app/layouts/**' 'pages/**' 'components/**' 'layouts/**' 'views/**'`（codex 自驗應已 abort，此處再驗保險）。**若有任何 view 層檔案被 codex 動過** → AskUserQuestion: [1] `git -C <wt> reset --soft main` 退 staging + 主線剔除 view 改動 + 重派 codex / [2] 接受並由主線自己重跑該 view phase / [3] 中止
      - **Scope discipline cross-check**: `git -C <wt> diff main..HEAD --name-only` vs prompt 內 phase scope 宣告。超出範圍 → AskUserQuestion 處理
      - Sanity check: `pnpm typecheck` (or equivalent), relevant tests
      - **If gaps detected** → AskUserQuestion: [1] 主線在 worktree 內 commit 補丁 / [2] reset 重派 codex / [3] 中止

   5. Move to next phase (re-classify and dispatch or self-execute)

   6. After ALL C 類 phases complete → **主線自己**執行所有 A、B 類 phases（Design Review / UI view），用 `/design improve`, /impeccable skills, /impeccable audit, review-screenshot 等 Claude Code first-class 工具

      **Design Review 期間 MUST 跑 Layer C data-sanity**（clade fork addition）：對本 change 觸及的 paginated query + lookup-resolved column 跑 `node <clade-vendor>/scripts/audit-data-sanity.mjs --consumer-path . --files <touched> --json`。exit 1 `status:"fail"`（PARAM_BOUNDARY，Critical）→ 主線 root-cause 修（client literal 超 server zod bound，如 `perPage:200` vs `max(100)`），**NEVER** 帶病進 handoff。詳見 `/data-sanity` skill。

6c. **Refactor Invariant Check**（clade fork addition；Layer B of pre-handoff quality gates；not in upstream spectra）

   **理由**：a UI-view refactor MUST NOT change observable behavior. <consumer-a> `app-status-badge-extraction`（2026-05-24）做 `UBadge → AppStatusBadge` refactor，但 `attendance/amendments.vue` 的 `useEmployeeListQuery({ perPage: 200 })` 違反 schema `max(100)` → API 400 → `employeeNameMap` empty → 員工 column 整列「-」。Refactor「component substitute + typecheck pass」判定通過，但 page runtime 已壞 — design review / verify:ui / manual review 全沒攔，user 親眼才抓到。Step 6c 是針對這條失效鏈的 mechanical gate。

   **觸發範圍**：每個 **Class B（UI view）phase** 由主線在 Step 7 實作完成後、該 phase commit / 標 tasks done **之前**，跑一次。Class A / Class C phase 不觸發（Class C 已由 codex view-layer guard 擋住 view 改動；Class A 是純設計審查）。Phase 內 touched files 沒有 `.vue` list/table page → script 自動 skip（exit 0），不需主線預判。

   **執行流程**：

   1. **取得 dev server**（per `rules/core/proactive-skills.md` § Dev Server Auto-Spawn）：若本 session 尚未起 dev server，scan free port 3001–3050（避開 3000）`run_in_background` 起，記下 URL；已起則重用。
   2. **收集本 phase touched view files**：`git -C <worktree> diff main..HEAD --name-only -- '*.vue'`（或本 phase commit 的 `.vue` 變更），組成 comma-separated list。
   3. **跑 check**（從 clade central 呼叫，`<clade-vendor>` 解析為 `~/offline/clade/vendor`，與 Step 8a.4 codex-dispatch 同慣例）：

      ```bash
      node <clade-vendor>/scripts/refactor-invariant-check.mjs \
        --consumer-path . \
        --dev-server-url http://localhost:<port> \
        --files <comma-separated-touched-vue-paths> \
        --change <change-name> \
        --json
      ```

   4. **解析 exit code + JSON**：
      - **exit 0 `status: "pass"` / `"skip"`** → 通過，繼續該 phase 的 commit / 標 done。
      - **exit 1 `status: "fail"`**（含 `uniform-column` 或 `network` finding）→ **MUST block phase complete**：主線**自己** root-cause（典型：client query param literal 違反 server zod schema `max/min` → 4xx → lookup map empty → column 全 fallback）。**NEVER** 標 phase done、**NEVER** 寫「等 user 在 manual review 抓」、**NEVER** 把整列 fallback rationalize 成「sample-bearing verification deferred」。修完 re-run 至 pass 才繼續。
      - **`harness-error` finding**（browser-harness 起不來 / dev server 連不上）→ **advisory，不 block**（exit 仍 0）。主線一行告知 user「refactor-invariant-check 因 <reason> 未能驗證 <page>，建議手動 sanity check」，繼續流程。

   5. **False positive 出口**：某 column 真的 intentionally 全空（例「備註」大多 row 空）→ 在該 `.vue` template 加 `<!-- @ui-invariant-allow-empty[<column-header>] -->` 註解，re-run 確認 suppressed。**NEVER** 用 marker 掩蓋真壞掉的 column（lookup-resolved column 全 fallback 是 bug，不是 optional）。

   Phase 1 為 model-driven（SKILL.md 指示）；Phase 3 會把本 check 升級成 `archive-gate.sh` hard gate（master plan 3.1）。

7. **Implement tasks (loop until done or blocked)**

   **Reminder: Track progress by editing checkboxes in the tasks file only. Do not use any built-in task tracker.**

   **Dispatch reminder**: For each phase, follow Step 6b's three-way classification:
   - Class C（Other）→ dispatch codex GPT-5.5 high (phase granularity)
   - Class A（Design Review）→ 主線 self-execute (NEVER dispatch)
   - Class B（UI view: component / page / view / layout / styling）→ 主線 self-execute (NEVER dispatch)；該 phase 實作完成、commit / 標 done **之前** MUST 跑 **Step 6c Refactor Invariant Check**
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
      - `[verify:e2e]`：Playwright config + `e2e/fixtures/index.ts` style three-role fixture 必須存在（propose 階段 `post-propose-manual-review-check.sh` 已對「標 verify:e2e 但 repo 無 e2e infra」印 warn-only advisory；apply 此處為 hard baseline gate，defense in depth）
      - `[verify:api]`：`__test-login` 或等價 session bypass route 必須存在
      - `[verify:ui]`：`supabase/seed.sql` 或專案等價 seed file 必須存在
   3. 缺 baseline → 先判別**該 item 是否真的需要此 channel**（per TD-176）：
      - **Legitimately 需該 channel**（真 persistence journey 需 e2e / 真需 session round-trip）但 infra 缺 → **STOP**，回報 user 補齊 baseline。
      - **Mis-marked**（描述其實是 final-state 顯示 → `[verify:ui]` / API round-trip → `[verify:api]` / 使用者互動 round-trip「建立/編輯/輸入/點/存」→ `[review:ui]`）→ **MUST reclassify marker**（不是補 infra）；判別依 `manual-review.evidence.md` Kind 分類指引。
      - 兩 case 皆 **NEVER**：派 agent 撞錯、或讓 screenshot-review 補 seed。

   **Baseline-exists-but-functional-gap 自接路徑（hard rule，clade fork addition — per [[pitfall-verify-evidence-handoff-instead-of-self-collect]]）**：

   Baseline 確認存在但**功能性缺**（dev-login route 不接 fixture user UUID / 受測 endpoint 需要 role 不符 / seed identifier 對應不到 dev-login allow-list / curl 401 因 cookie missing 等），主線 / subagent **MUST** 依序嘗試以下 self-collect path，**全部失敗才**寫 `deferred` annotation：

   **(a)(b) 執行者 — 預設派背景 codex**：

   (a)(b) 兩層**預設**派背景 codex 執行，主線不 foreground 自跑：

   ```bash
   node ~/offline/clade/vendor/scripts/codex-dispatch.mjs \
     --template ~/offline/clade/vendor/snippets/codex-offload/templates/self-collect-evidence.template.md \
     --var <key>=<value> ...（依 template 變數表填：change name、dev-login route 路徑、fixture UUID、port、table 等） \
     --label 8a-self-collect-<change> --effort medium
   ```

   （背景跑、stdout 單一 JSON evidence；exit 0=ok / 2=(a)(b) 皆業務 fail / 3=機械故障 / 4=quota。exit 2 → 主線依序降到 (c)(d)，**不**重派同一 brief；exit 3/4 → 機械故障，主線 fallback foreground 自跑 (a)(b) 再續 chain。）

   - **(c)(d) 既有路徑不動**：(c) 維持主線自起 dev server + browser-harness；(d) 已走 `codex-dispatch-screenshot-verify.mjs`，**不**改走本 dispatcher
   - **Evidence annotation 寫回 tasks.md 維持主線**（多 session 共用 working tree 的寫入紀律）— codex 只回報 JSON evidence，**NEVER** 讓 codex 直接 Edit tasks.md
   - 主線收到 codex JSON evidence 後 **MUST 抽查至少一項**（重跑一條 curl / SELECT 比對回報值）再寫 annotation — **不信 codex 自報**

   **(a) 擴 dev-login route allow-list**（首選；最持久的治根）：

   - Read consumer 端 `server/routes/auth/_dev-login.get.ts`（或 `__test-login.get.ts`、其他等價 dev-only signin endpoint）
   - 加 fixture user UUID 進 allow-list（env var allow-list / query param verified UUID / `dev_user_id` query 接受）
   - 改完跑 `curl -i 'http://localhost:<port>/auth/_dev-login?user_id=<fixture-uuid>'` 驗證 session cookie 可 mint
   - 後續 verify channel 直接重用該 cookie → 成功則 self-collect 路徑收斂在此

   **(b) service_role direct DB query 證 data shape**（escape hatch；HTTP 路徑無法搭起時）：

   - 用 `@supabase/supabase-js` service_role client（或對應 server 端 service_role 連線）直連 DB 跑 `SELECT` 證明 endpoint 期待回傳的 data shape 正確
   - annotation 寫法 **MUST** 標明走 DB 而非 HTTP（避免後續 audit 誤判 round-trip 已完成）：
     ```text
     (verified-api: <ISO-8601> direct-db-shape table=<table> rows=<n> sha=<sha256-12chars>)
     ```
   - 限制：不能驗證 endpoint 的 authz / RLS / response transform 邏輯；只驗 data shape。authz / transform 必須走 (a)(c)(d) 任一

   **(c) 主線自起 dev server + browser-harness self-login**（OAuth 已設好時）：

   - scan free port（3001-3050，避開 3000）`run_in_background` 起 dev server
   - browser-harness 走 OAuth flow 自手 login（user 已預先在系統 Chrome 登入）
   - final-state screenshot + DOM 觀察
   - 適用：OAuth provider 在 dev 環境可達 + user 已登入過

   **(d) 派 screenshot-review codex（mode: verify）**：

   - 給 codex 完整 brief（含 dev server URL + known route + expected DOM observation + screenshot path）
   - codex 跑 final-state screenshot capture
   - 適用：純 final-state visual evidence、不涉及 mutation / multi-role / form fill

   **四層全失敗才寫 deferred** + handoff user。Annotation **MUST** 註明已嘗試 path 與失敗原因（避免 user 重複試同樣 path）：

   ```text
   （deferred: tried (a) dev-login route 不接 fixture UUID（route 限 E2E test user only）/ (b) service_role 不適用（需驗 RLS）/ (c) OAuth provider unreachable in dev / (d) screenshot-review fail with <reason>。剩需 user 親自跑）
   ```

   完整 recipe + 適用 / 不適用情境見 `vendor/snippets/verify-channels/main-self-collect-fallback-chain.md`。

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

      - Spec pass 後，**MUST** 先確認 Playwright trace zip 真的有產出（`ls -1 test-results/**/trace.zip` 或對應 reporter output 路徑），再 Edit tasks.md 寫：

        ```text
        (verified-e2e: <ISO-8601> spec=e2e/verify/<change>/<topic>.spec.ts trace=<trace-path>)
        ```

      - Trace zip 抓不到（playwright.config 沒開 `trace: 'on'` / per-test 沒 `test.use({ trace: 'on' })`）→ **視同 blocker**，保留 `[ ]`，寫 `（issue: trace not captured — enable trace recording in playwright.config or per-test）`；**NEVER** 寫缺 `trace=` 的降級 annotation（archive-gate 會擋住、review-gui 會印 malformed warning）。
      - Spec fail → 保留 `[ ]`，寫 `（issue: <spec failure summary>）` 或回報 blocker；**NEVER** 寫 `(verified-e2e:)`。

   3. **`[verify:api]` channel — 主線自己跑 HTTP round-trip**

      - Copy/adapt `vendor/snippets/verify-channels/api-roundtrip.template.sh` 或直接用 curl / ofetch 跑等價 request。
      - 通過後，主線 Edit tasks.md 寫：

        ```text
        (verified-api: <ISO-8601> <METHOD> <URL> <STATUS>[ body=<sha256-12chars>])
        ```

      - Request fail / status 不符 → 保留 `[ ]`，寫 `（issue: <METHOD URL expected/actual>）` 或回報 blocker；**NEVER** 寫 `(verified-api:)`。

   4. **`[verify:ui]` channel — 派 verify mode（UI only）**

      **Runtime 選擇**（default codex；Claude subagent fallback）：

      - **Default — codex**：偵測 `command -v codex` 存在且 env `CLADE_FORCE_CLAUDE_SCREENSHOT` 未設 → 呼叫 `node <clade-vendor>/scripts/codex-dispatch-screenshot-verify.mjs --change <name> --consumer-path . --dev-server-url <url> --items-json <items.json>`。Dispatcher 跑完 stdout 印 JSON 摘要（`{"runtime":"codex","change":...,"items":[...],"audit_exit_code":N,"progress_json":"...","review_md":"..."}`），主線解析該 JSON 後對 `items[].status === "PASS"` 的 item 寫 `(verified-ui:)` annotation。Codex 任一 item `status` 不是 `PASS` 時 → 保留 `[ ]` + 寫 issue / blocker（業務結果，**NEVER** fallback Claude — 同一 brief 在 Claude 也會撞同樣業務問題）
      - **Fallback — Claude subagent**：以下任一情境**才** fallback 到 `screenshot-review` subagent（brief copy/adapt 自 `vendor/snippets/verify-channels/ui-final-state-brief.template.md`）：
        - `command -v codex` 不存在
        - env `CLADE_FORCE_CLAUDE_SCREENSHOT=1` 強制退場（debug / 退場用）
        - Dispatcher exit 非 0 **且** stdout 沒印出可 parse 的 JSON 摘要（機械故障，例如 codex auth 失效、subprocess crash）
      - 兩 runtime 走相同的 brief contract（change name、dev server URL、items、Scope）；codex runtime 多了 self-contained guardrails（codex 不會 auto-load `screenshot-review.md`）

      **反 bypass（hard rule — 2026-06-11 audit 實證）**：

      - **NEVER** 派 general-purpose / worktree Claude subagent 自跑 playwright / browser-harness 收 `verify:ui` evidence 來取代本步 dispatcher — 2026-06-11 audit 實證：05-29 dispatcher 修復後 147 條 `(verified-ui:)` annotation **0 次走 codex**、92 個 session 全部走此 bypass 形狀（從未進入本分支）、0 次機械故障 fallback 記錄。需要 `verify:ui` evidence 的**唯一**入口是 `node ~/offline/clade/vendor/scripts/codex-dispatch-screenshot-verify.mjs`
      - **Claude fallback 僅限機械故障**（`command -v codex` 不存在 / dispatcher exit≠0 且 stdout 無 parseable JSON；env `CLADE_FORCE_CLAUDE_SCREENSHOT=1` 為 user 明確設定的 debug 退場，不在此限），且 **MUST** 在 tasks.md 對應 item 留 `UNCERTAIN(dispatcher-error)` 痕跡 — **無此痕跡的 Claude 自拍 evidence 視為違規**（audit 以 annotation × dispatcher 記錄比對抓）

      共用規約：

      - Brief **MUST** 提供 change name、dev server URL、每個 item 的 known URL、**`ready_signal`（structured，見下）**、預期 screenshot path。
      - **主線 MUST 為每個 assertion-bearing verify:ui item 建 `ready_signal`**：從 item 描述的具體可斷言短語抽機械可判 signal（`text` / `text_all` / `text_any` / `selector` / `regex` / `min_rows`），放進 `--items-json` 的 `ready_signal` 欄。agent capture 前 poll 它命中才拍、拍後 cross-check 它仍在才算 PASS（見 `manual-review.data-readiness.md` § `[verify:ui]` ready_signal 契約 + screenshot-review Verify Mode step 2-4）。**理由**：頁面 async query 資料在 `wait_for_load()` 之後才填，無 signal 時 agent 只能盲拍 → 拍到空殼（per <consumer-b> monitoring-slot 2026-05-30 incident）。
      - **建不出 `ready_signal`**（描述只有「畫面正常」「顯示資料」等模糊語、無具體斷言點）→ **NEVER** 硬 dispatch；依 `manual-review.data-readiness.md` § signal-less 分流 reclassify（純主觀視覺 → `[review:ui]`；需互動才出現 → `[verify:e2e]` / `[verify:api]`）。既有未帶 signal 的 grandfather item → agent 走 generic-settle fallback（**不可**當 PASS 充分條件）。
      - Agent scope **MUST** 限於 open known URL + readiness gate poll（≤15s 等 ready_signal）+ final-state screenshot + post-capture cross-check + DOM observation。
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
        ready_signal:
          text_any: ["逾期", "overdue"]
          selector: "[data-testid=asset-loan-overdue-badge]"
          min_rows: 1
        Screenshot path: screenshots/local/<change-name>/#3-final.png

      Scope:
      - Open the known URL, wait for load, **poll ready_signal until present (≤15s)**, capture final-state screenshot, **post-capture cross-check ready_signal still present**, record DOM observation.
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

8a.5. **Manual-Review Pattern Re-check** (clade fork addition — pre-handoff `## 人工檢查` hygiene gate before Step 8b)

   `## 人工檢查` items can drift during Step 7 implementation phases — impl-phase tasks may surface new manual-review items, edit existing ones inline, or paste internal jargon (DB column names / capability flag names / spec heading slugs) into descriptions while the impl context is fresh. Re-run the same enforcement hook that `/spectra-propose` Step 3a uses, so jargon leakage / abstract reference / missing URL etc. doesn't reach the GUI handoff or get baked into the archive history:

   ```bash
   bash scripts/spectra-advanced/post-propose-manual-review-check.sh <change-name>
   ```

   Exit 2 = pattern findings (any of `ABSTRACT_REFERENCE` / `CARD_WITHOUT_UID` / `UI_ITEM_NO_URL` / `MULTI_STEP_NOT_SCOPED` / `REVIEW_UI_BACKEND_ROUNDTRIP` / `INTERNAL_JARGON_LEAKAGE`). Main thread **SHALL** Edit `tasks.md` directly to fix findings inline per hook stdout remediation guidance — do NOT round-trip to `codex` (slow). Reference: `vendor/snippets/manual-review-enforcement/patterns.json` + `rules/core/manual-review.data-readiness.md`.

   Legitimate false positive (e.g., 真機掃 SMS 無 dev replay endpoint, sample inline value `weekly_target=5000`) → add `@no-manual-review-check[<reason>]` trailing marker per `manual-review.md`「`@no-manual-review-check` Marker」, re-run hook to confirm bypass recognized, then proceed.

   Hook exits 0 → proceed to Step 8b silently. Defense in depth: primary catches are propose / ingest / archive — apply Step 8a.5 specifically catches drift introduced during impl phases that bypass all three.

8a.6. **Pre-Manual-Review Self-Analysis** (clade fork addition — Layer E.1 of pre-handoff quality gates; not in upstream spectra)

   The user must not be the **first** to discover trivial UX/data defects in the GUI. <consumer-a> `app-status-badge-extraction`（2026-05-24）handed 9 fabricated `(verified-ui:)` annotations + an all-「-」員工 column straight to the user because nothing between Step 8a and the GUI re-checked the change. Step 8a.6 is that re-check.

   **MUST** before Step 8b handoff, the **main thread** (NOT a subagent — only the main thread has the full change set in view) runs the 5-dimension self-analysis:

   ```
   ~/offline/clade/vendor/snippets/pre-handoff-cross-check/main-self-analysis.template.md
   ```

   1. Read the template, walk all **5 dimensions** (D1 task↔render / D2 evidence↔dom fab guard / D3 list↔fallback / D4 api contract boundary / D5 error tail).
   2. Write the **finding report** (template's bottom block) — every dimension gets explicit `PASS` / `FAIL` / `N/A` + evidence. **No dimension silently skipped.**
   3. For each `FAIL`: edit the relevant `## 人工檢查` item to append `（issue: <summary + where>）`; D2 fabrication findings additionally strip the bad `(verified-ui:)` annotation and restore `[ ]`.
   4. **No finding report written → NO Step 8b handoff.** This is the gate.
   5. **Record the E.1 verdict（telemetry-only，fail-open，不影響 gate）** — finding report 寫完後 **MUST** 落 verdict 到 consumer-local ledger 供 Phase 3.1 soak 評估（E.2 由 dispatcher 自記，主線只記 E.1）：

      ```bash
      node <clade-vendor>/scripts/pre-handoff-ledger.mjs record \
        --consumer-path . --change <change-name> --layer E.1 \
        --status <pass|fail> \
        --findings-json '[{"dimension":"D2","severity":"critical"}, ...]'
      ```

      `--status fail` 當任一 dimension FAIL，否則 `pass`；`--findings-json` 列每個 FAIL 的 `{dimension, severity}`（無 FAIL 給 `[]`）。此 step append-only + fail-open，**NEVER** 因 ledger 寫入失敗而中斷 handoff。此 E.1 record 現由 `archive-gate.sh` **Check 7（Pre-handoff Verdict Presence）機械強制存在** — 缺 E.1 record → archive 被擋 exit 2（fail-open 僅限 ledger 檔尚不存在的 pre-propagation consumer）；soft step 不再可被靜默跳過，soak 才累積得到資料。

   **Layer E.2 — codex cross-model second opinion**（clade fork addition；Phase 2）：E.1 是主線（Claude）自己審；E.1 之後 **MUST** 再派 **codex GPT-5.5** 對同 5 dimension 做獨立 cross-check（per `rules/core/agent-routing.md` 「跨模型」原則 — author model 會 rationalize 過自己的盲點，換個 model 才抓得到）：

   ```bash
   node <clade-vendor>/scripts/codex-dispatch-pre-handoff-check.mjs \
     --change <change-name> --consumer-path . \
     --tasks-file openspec/changes/<change-name>/tasks.md \
     --screenshots-dir screenshots/local/<change-name>
   ```

   - Dispatcher stdout 印 JSON：`{"layer":"E.2","runtime":"codex","status":"pass"|"fail","findings":[{dimension,severity,evidence,suggested_fix}]}`。
   - **merge E.1 + E.2 findings**：兩方任一 `FAIL` → 對應 item 寫 `（issue: <dimension>: <evidence>）` annotation（去重；D2 fabrication 同樣 strip 假 `(verified-ui:)` + restore `[ ]`）。
   - **Fallback**：dispatcher 回 `status:"error"` + `fallback:"claude-subagent"`（codex 不在 / 無 parseable JSON）→ 改派一個 Claude subagent 用 `main-self-analysis.template.md` 同 5 dimension 做 cross-check（**NEVER** 憑記憶補；**NEVER** 跳過 cross-check 直接 handoff）。

   **Level**: Phase 2 仍為 **warning / soft-gate** — E.1 + E.2 都跑、findings 必寫成 `（issue:）`annotation 讓 user 在 review-gui 看到，但**不**hard-block workflow（user 在 GUI 拍板）。Phase 3.1 才把「zero unresolved findings」整進 `archive-gate.sh` 成 hard gate。每次 E.1/E.2 verdict 已落 `<consumer>/.spectra/pre-handoff-ledger.jsonl`（telemetry，gitignored）；Phase 3.1 升 hard gate 的 soak 評估跑 `node <clade-vendor>/scripts/pre-handoff-ledger.mjs report --all-consumers`（出 fire-rate / by-dimension / E.1↔E.2 agreement）。

   **Reuse Step 6c / Layer C**: D3 / D5 是 `refactor-invariant-check.mjs`（Layer B）偵測的；D4 是 `audit-data-sanity.mjs`（Layer C）偵測的。已跑過就 cite 結果，不必重跑。

8b. **Manual review handoff**

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

   - **DEFAULT path**: Reply to the user with something like:
     > Implementation 完成。Step 8a 已處理 verify channels：automatic `[verify:e2e]` / `[verify:api]` items 已寫 annotation 並自動完成；含 `[verify:ui]` / `[review:ui]` 的 `<N>` 項仍待你確認。請在 **clade home**（`~/offline/clade`）執行 `pnpm review` 開本地 GUI 驗收（review-gui 從 clade home 跑會自動聚合所有 consumer + worktree change；consumer 端直接跑會被 clade-only guard 擋下；`pnpm review` dev mode default ON，改 review-gui source 自動 reload）：
     >
     >   cd ~/offline/clade
     >   pnpm review
     >
     > GUI 啟動後直接打開：
     >
     >   http://127.0.0.1:5174/review/<consumer-id>:<change-name>
     >   # 例 co-purchase 的 mvp-financial-layer-bootstrap：
     >   # http://127.0.0.1:5174/review/co-purchase:mvp-financial-layer-bootstrap
     >
     > GUI 會自動配對 `screenshots/local/<change-name>/#<N>-*.png`、conflict-aware 寫回 tasks.md、對 `[verify:e2e]` / `[verify:api]` automatic-only items 自動勾 `[x]`、對 `[verify:ui]` / `[review:ui]` items 顯示 evidence 等你 OK / Issue / Skip。完成後回報，我繼續 Step 9 status。
   - **MUST 直接給 review-gui deep-link**（per `rules/core/proactive-skills.md` § Inline Review-GUI Deep-Link）：訊息 **MUST** 含 `http://127.0.0.1:5174/review/<consumer-id>:<change-name>` 完整 URL（cross-consumer mode 預設啟用，沒 `<consumer-id>:` prefix 會 fallback 到 clade mainEntry → API 404；`<consumer-id>` 從 `~/offline/clade/registry/consumers.json` 對應 entry 抓）。**NEVER** 寫「請在 worktree root 執行」或「請在 main consumer root 執行」當預設措辭——review-gui (`vendor/scripts/review-gui.mts` `listSourceRoots`) 從 clade home 跑時偵測 `vendor/scripts/review-gui.mts` + `consumers.local` 雙標記 → 進 cross-consumer mode，自動聚合所有 consumer + worktree change；consumer 端跑會被 `preflightCladeOnly` guard 擋下、退出 exit 2。**NEVER** 列 dev server URL（`http://localhost:3040/admin/...`）當替代——review-gui 內部已有 final-state screenshot + evidence。若 review 過程發現需要 fresh screenshot 或 user 想 sanity check，**MUST** 由 agent 自起 dev server（per `rules/core/proactive-skills.md` § Dev Server Auto-Spawn：scan free port 3001–3050、避開 3000、`run_in_background`、回報 URL + shellId），**NEVER** 叫 user cd worktree 跑 `pnpm dev`。`5174` 是 `vendor/scripts/review-gui.mts` `DEFAULT_PORT`，找不到時會 fallback 到 5174-5194，由 GUI startup banner 告知 user，主線不必猜。
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
- **Worktree isolation — NEVER halt apply on main's WIP**: Step 0 必須自動把 user 帶進 worktree（用 commit-then-fork 或 clean fork，視 scope 而定）；無論 Step 0c 階段或 apply 進行中，**NEVER** 因 main repo 的 dirty WIP / staged / untracked / 同檔別 session WIP 中斷 apply、AskUserQuestion 要 user clean main、或建議 user 自己處理後重試。worktree 是獨立 working tree，main 的 WIP 不在 worktree 也無法影響它；同檔衝突是 merge-back 時的事，由 `/spectra-commit` + user 決策處理。唯一合法 STOP 是 unmerged conflict（wt-helper 拒絕 fork）或 helper 本身錯誤；user-decision-needed pause **NEVER**。
- **Phase dispatch discipline**（per `agent-routing.md`）:
  - **NEVER** dispatch Design Review phase to codex — Design skill is Claude Code first-class
  - **NEVER** dispatch UI view phase（component / page / view / layout / styling）to codex — UI view 層的視覺 / 互動 / a11y 細節必須跟 Design skill 緊耦合，主線自己做。Frontend 但非 view 的（store / hook / API client / type / util）仍走 codex
  - **NEVER** dispatch with `medium` effort — use `high` minimum
  - **NEVER** dispatch task-by-task — phase granularity only
  - **NEVER** dispatch a codex phase without including the「view-layer guard」instruction in the prompt — without it, codex tends to incidentally touch `.vue` / `.tsx` files
  - **NEVER** dispatch a codex phase without including the「Plan-first」instruction in the prompt — without it, 主線只能從 `git diff` 反推 codex 意圖，cross-check 易漏「漏做的 task」與「踩到 view 層」這類 drift（per `agent-routing.md` Plan-first 條目）
  - **NEVER** skip view-layer drift check after codex completion — `git diff --name-only` filtered by view paths is the primary quality gate
  - **NEVER** auto-fix mixed phases by editing tasks.md mid-apply — that belongs to `/spectra-ingest`; for未開工 mixed phase, STOP and instruct the user to run ingest
  - **NEVER** skip cross-check after codex phase completion — read tasks.md, confirm checkboxes, run typecheck/test, review diff
- If **AskUserQuestion tool** is not available, ask the same questions as plain text and wait for the user's response

**Fluid Workflow Integration**

This skill supports the "actions on a change" model:

- **Can be invoked anytime**: Before all artifacts are done (if tasks exist), after partial implementation, interleaved with other actions
- **Allows artifact updates**: If implementation reveals design issues, suggest updating artifacts - not phase-locked, work fluidly
