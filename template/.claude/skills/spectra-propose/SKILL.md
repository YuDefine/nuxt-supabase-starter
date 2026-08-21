---
name: spectra-propose
description: "Create a change proposal with all required artifacts"
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
Source: plugins/hub-core/skills/spectra-propose/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


Create a complete Spectra change proposal — from requirement to validated artifacts — in a single workflow.

> **Ownership**（clade fork；cross-phase matrix in `rules/core/spectra-workflow.md`）：propose 負責 manual-review item data-readiness — sample key inline + **該 key 是否真的會在 target UI render**（Layer A `VERIFY_UI_SAMPLE_KEY_DISPLAY_CHECK` + reverse page-grep）。**不**負責 runtime 正確性 / 視覺 / 資料形狀（apply Step 6c/Layer B、Design Review/Layer C、verify、manual review 各自接棒）。

**Input**: The argument after `/spectra-propose` is the requirement description. Examples:

- `/spectra-propose add dark mode`
- `/spectra-propose fix the login page crash`
- `/spectra-propose improve search performance`

If no argument is provided, the workflow will extract requirements from conversation context or ask.

**Prerequisites**: This skill requires the `spectra` CLI. If any `spectra` command fails with "command not found" or similar, report the error and STOP.

**Pre-flight: dirty main 不擋 propose**（clade fork addition；not in upstream spectra）

Main worktree 的 staged / modified / untracked / unmerged **完全不影響**本 skill 啟動或執行。**NEVER**：

- 反射性建議 user 先 `git commit` / `git stash` 再跑 propose
- 用 `AskUserQuestion` 問 staged 內容代表什麼意圖
- 跳過 Step 11 `wt-helper add` 想避開「dirty fork 風險」

**理由與 anti-pattern 警示**：Step 1–10 只寫 `openspec/changes/<change-name>/`（零 git 寫操作）、Step 11 `wt-helper add` 不帶 `--precheck-baseline` 直接 fork main HEAD——完整 rationale 見 [[worktree-default]] §1「Pre-flight guard 不適用範圍：spectra-propose」。

**唯一 path collision 例外**：若 user 的 staged / WIP **就在** `openspec/changes/<change-name>/` 子目錄裡（重跑同名 change 的場景），先 `git diff openspec/changes/<change-name>/` inspect、跟 user 對齊是否覆蓋。**這是 path collision，不是 main dirty 的一般情況。**

**Steps**

0. **Dispatch 路徑選擇（三選一選單）**

   **先跑 § Elicitation gate 的 Part 1（4 問），再跳選單。** 那 4 問問的是 requirement 本身，與走哪條 dispatch 路徑無關；跳過它，A / B / C 三條路徑會用同一份有洞的 requirement 起草。

   本 skill 的 draft 階段有三條可選路徑。**Step 0 開頭 MUST 用 AskUserQuestion 跳三選一選單**讓使用者選（除非使用者已明確指定路徑，見下方捷徑）：

   - **A. Pi flow（預設 / 推薦，選單第一項）** — Pi GPT-5.6-sol max draft + 主線 Claude Fable 5 xhigh cross-check。draft + cross-check 比擇一穩，wall-clock 最短。
   - **B. 三模型交叉 pipeline** — Claude Fable 5 xhigh draft → Pi GPT-5.6-sol max review（fresh session、只出 findings、不改檔）→ 主線 Claude Fable 5 xhigh final check。三模型交叉（Fable draft + Pi review + Fable final）比擇一穩，wall-clock 較長（多一層背景等待）。
   - **C. 純 Claude** — 主線 Claude Fable 5 xhigh 直接走 Step 1~11（含 Step 8 補 7 步 Design Review check）。

   選單寫法：option A label 標「(預設/推薦)」並排第一（使用者按 Enter 即走現狀）。

   **明確指定捷徑（跳過選單，直接走對應選項）**：使用者訊息已明確指定路徑時**不問選單**：
   - 「不要派 pi」「不要派 codex」「我要純 Claude propose」「直接你做」→ **選項 C**
   - 「用 Fable」「走 Fable pipeline」「Fable 起草」「三模型交叉」「Fable draft+review」→ **選項 B**
   - 「用 pi」「用 codex」「現有流程」「照舊」→ **選項 A**

   選定後依對應選項段落執行。**選項 A / B 在 Step 0 內完成整個 draft + check，本 session 不再執行 Step 1~11**；只有**選項 C** 才往下跑 Step 1~11。

   ---

   ### 選項 A：Pi flow（Pi draft + 主線 cross-check）

   選 A 後 **MUST** 完整讀 `references/dispatch-option-a.md` 並依序執行：

   - **Phase 0a**：解析 change name + requirement → 寫 draft prompt 檔（範本含 Plan-first / Phase Purity / Manual Review Kind Marker / Backend-only 規約 / FIXTURES sample / 語言遵循 / **NEVER park**）→ 背景 Pi dispatcher（max effort）→ notification-only watch（**NEVER** 短輪詢）。
   - **Phase 0b**（收到 completed 通知**立刻**跑，step 1–10）：讀 stdout → `post-propose-check.sh` → `post-propose-manual-review-check.sh` → **Check 7 hard gate（`--check7-only` MUST exit 0 才續行，NEVER 跳過）** → `design-inject.sh` → 補 Design Review 7 步 → Manual Review Marker Hygiene（Rule 1–6，Rule 6 = 結構化 entry 落盤）→ 語言遵循 check → **掃 design.md Open Questions（非空 MUST 立刻 AskUserQuestion 逐題問，NEVER 自行假設答案）** → `spectra analyze` / `validate` → commit artifacts → 回報。
   - 修補一律主線自己 Edit，**NEVER** 丟回 pi。

   ---

   ### 選項 B：三模型交叉 pipeline（Fable draft → Pi review → 主線 Fable final check）

   選 B 後 **MUST** 完整讀 `references/dispatch-option-b.md` 並依序執行三段背景 pipeline：

   - **Phase B-0a**：沿用選項 A draft prompt 範本寫 `-draft-prompt.md` → 背景 `claude -p --model claude-fable-5 --effort xhigh` → notification-only watch。
   - **Phase B-0b**：Fable draft 完成 → 寫 `-review-prompt.md`（**只出 findings、禁止改檔**）→ 背景 Pi review（max）。
   - **Phase B-0c**：主線整合 findings + 跑選項 A Phase 0b step 3–9 全套 cross-check，主線自己 Edit 修。

   ---

   ### Elicitation gate（A / B / C 通用，MUST）

   Spectra 保證「寫下來的規格被實作、不漂」，**不**保證規格本身完整。缺的那條需求不會出現在
   任何 diff、任何測試、任何 traceability 報表裡 —— 它只在上線後以事故的形式出現。本 gate 是
   規格成形**之前**唯一的攔截點，三條路徑都 MUST 走。

   **Part 1 — Pre-draft 4 問（起草任何 Scenario 之前）**

   對 requirement 逐題問，答案逐字寫進 `design.md` 的 Open Questions 或直接寫成 Scenario：

   1. **分次累計上界** —— 這個需求裡有沒有「可對同一 entity 重複寫入的 amount / quantity /
      count」？有的話，歷史聚合量的上界是什麼？（對應 [[testing-anti-patterns]] Anti-Pattern 7）
   2. **重複執行冪等** —— 同一個動作被送兩次（重試、使用者連點、webhook redelivery），
      第二次的正確行為是什麼？
   3. **併發雙送** —— 兩個請求同時通過檢查再同時寫入，會發生什麼？誰負責序列化？
   4. **時間邊界** —— 這個規則在期別交界、時區換日、資料補登（backdate）時怎麼算？

   **答不出來 = spec gap，不是可以先擱著的細節。** MUST 把該題原文放進 design.md 的
   Open Questions 浮給 spec owner，**NEVER** 自己發明一個上界 / 一套冪等語義然後把它寫成
   Scenario —— 那是把猜測釘成契約，之後每一份測試與 review 都會以它為準。

   四題全部「本需求不適用」時 MUST 逐題寫出為什麼不適用，**NEVER** 整段略過不留痕跡。

   **Part 2 — Post-draft QA 視角 agent（spec deltas 寫完、`spectra validate` 之前）**

   派**一個** fresh-context subagent，任務只有一個：對草稿 spec 問「那如果⋯⋯呢」。

   ```
   Agent({ subagent_type: 'general-purpose', model: <與主線同檔或更高>,
           prompt: <spec delta 檔路徑 + 上面 4 問 + 「只輸出你想到而 spec 沒回答的情境，
                    一條一行；NEVER 改任何檔；NEVER 評論寫得好不好」> })
   ```

   機制沿用 [[checker-subagent]]，但往前移到規格階段：checker 檢查「實作有沒有照 spec」，
   本 agent 檢查「spec 有沒有漏掉該規範的情境」。三條紀律照搬：

   - **MUST 是新開的 subagent**，**NEVER** 用繼承主線對話的 fork 型（`/subtask`、
     `subagent_type: 'fork'`）—— 主線的起草敘事整份附過去，fresh context 當場失效
   - **MUST 顯式帶 model 檔位**，NEVER 靠繼承
   - 它 **NEVER 改檔**；回來的每一條由主線判定「補進 spec」或「明確標為 out of scope」，
     兩者都要留痕跡，**NEVER** 靜默丟棄

   **為什麼由 agent 扮**：Three Amigos 需要 PM / 開發 / 測試三個視角互相追問，而 fleet 多數
   專案是一個人 + agent，另外兩角不存在 —— 等真人對話這條路是空的。這不保證想得到該想的，
   但把機率從「一個人埋頭寫」提升到「有人專門唱反調」。

   ### 禁止事項（重點重申，A / B / C 通用）

   - **NEVER** 跳過 Step 0 選單（除非使用者**明確**指定路徑 — 見上方 § 明確指定捷徑）。預設**MUST**跳三選一選單
   - **NEVER** 派 draft（pi）後不跑 cross-check / final check（post-propose-check + design-inject + 主線補 Design Review 7 步 + spectra analyze）
   - **NEVER** 把 cross-check / final check 的修補工作丟回 pi（太慢、來回成本高）— 主線**自己** Edit 修
   - **NEVER** 沉默等使用者來問進度；通知一到自己讀檔 + 續跑後續 phase
   - **NEVER** 派 draft（pi）而 prompt 漏掉 Plan-first 段落 — 必須在動筆前先輸出 `## Plan`（要動哪些檔 / 每檔寫什麼 / phase 切分），主線後續 check 才有對齊基準

   **選項 B 專屬 NEVER**：

   - **NEVER** 把 Phase B-0a 的 draft prompt（`-draft-prompt.md`）與 Phase B-0b 的 review prompt（`-review-prompt.md`）混用 — draft 會寫檔，review 只出 findings、禁止改檔
   - **NEVER** 在 Phase B-0b 派 Pi review 前，讓 artifacts 處於 parked 狀態（artifacts 在 SQLite blob、不在 disk，Pi 讀不到）。正常流程不會 park；若 draft 違規 park 了，先 `spectra unpark`
   - **NEVER** 讓 Pi review 階段改檔 — review prompt 必含「禁止 Edit / Write、只輸出 findings」；實際修補由主線 Phase B-0c 做

   **選 A / B 時本 session 不再執行任何 Step 1 ~ 11**（避免雙重生產）— Step 0 結束本 skill。

   ### 選項 C：純 Claude 路徑（使用者選 C 或明確要求時）

   continue to Step 1 below.

1. **Determine the requirement source**

   a. **Argument provided** (e.g., "add dark mode") → use it as the requirement description, skip to deriving the change name below.

   b. **Plan file available**:
   - Check if the conversation context mentions a plan file path (plan mode system messages include the path like `~/.claude/plans/<name>.md`)
   - If found, check if the file exists at `~/.claude/plans/`
   - If a plan file is found, use the **AskUserQuestion tool** to ask:
     - Option 1: Use the plan file
     - Option 2: Use conversation context
   - If conversation context has no relevant discussion, mention this when presenting the choice
   - If the user picks the plan file → read it and extract:
     - `plan_title` (H1 heading) → use as requirement description
     - `plan_context` (Context section) → use as proposal Why/Motivation content
     - `plan_stages` (numbered implementation stages) → use for artifact creation
     - `plan_files` (all file paths mentioned) → use for Impact section
   - If the user picks conversation context → fall through to (c)

   c. **Conversation context** → attempt to extract requirements from conversation history
   - If context is insufficient, use the **AskUserQuestion tool** to ask what they want to build

   From the resolved description, derive a kebab-case change name (e.g., "add dark mode" → `add-dark-mode`).
   Do not keep archive-style date prefixes in active change names. If the source name starts with `YYYY-MM-DD-`, strip that date prefix before running `spectra new change`; archived change names and directories are historical references, not active names to reuse.

   **IMPORTANT**: Do NOT proceed without understanding what the user wants to build.

2. **Classify the change type**

   Based on the requirement, classify the change into one of three types:

   | Type     | When to use                                                         |
   | -------- | ------------------------------------------------------------------- |
   | Feature  | New functionality, new capabilities                                 |
   | Bug Fix  | Fixing existing behavior, resolving errors                          |
   | Refactor | Architecture improvements, performance optimization, UI adjustments |

   This determines the proposal template format in step 5.

3. **Scan existing specs for relevance**

   Before creating the change, check if any existing specs overlap:
   1. Use the **Glob tool** to list all files matching `openspec/specs/*/spec.md`
   2. Extract directory names as the spec identifier list
   3. Compare against the user's description to identify related specs (max 5 candidates)
   4. For each candidate (max 3), read the first 10 lines to retrieve the Purpose section
   5. If related specs are found, display them as an informational summary

   **IMPORTANT**:
   - If related specs are found, display them but do NOT stop or ask for confirmation — continue to the next step
   - If no related specs are found, silently proceed without mentioning the scan

4. **Create the change directory**

   ```bash
   spectra new change "<name>" --agent claude
   ```

   If a change with that name already exists, suggest continuing the existing change instead of creating a new one.

5. **Write the proposal**

   **IMPORTANT — file path rules for the `## Impact` section:**
   - All file paths SHALL be written relative to the project root (e.g., `src/lib/foo.ts`, `src-tauri/crates/core/src/bar.rs`, `docs/specs/specs/auth/spec.md`).
   - Do NOT use relative fragments (e.g., `parser/mod.rs`, `core/mod.rs`) — preflight rejects them as non-anchored paths.
   - Do NOT wrap shell commands in backticks inside artifact text (e.g., `` `git mv a.rs b.rs` ``) — preflight's backtick extractor will otherwise mis-parse the command as a file reference.
   - When referring to a file without naming its concrete path, use descriptive prose (e.g., "Parser 入口檔") rather than a backticked path fragment.

   Get instructions:

   ```bash
   spectra instructions proposal --change "<name>" --json
   ```

   Generate the proposal content based on change type (see formats below), then write it via CLI:

   ```bash
   spectra new artifact proposal --change "<name>" --stdin <<'ARTIFACT_EOF'
   <proposal content>
   ARTIFACT_EOF
   ```

   If the command fails with a validation error, fix the content and retry.

   Use the following format based on change type:

   ### Feature

   ```markdown
   ## Why

   <!-- Why this functionality is needed -->

   ## What Changes

   <!-- What will be different -->

   ## Non-Goals (optional)

   <!-- Scope exclusions and rejected approaches. Required when design.md is skipped. -->

   ## Capabilities

   ### New Capabilities

   - `<capability-name>`: <brief description>

   ### Modified Capabilities

   (none)

   ## Impact

   - Affected specs: <new or modified capabilities>
   - Affected code:
     - New: <paths to be created, relative to project root>
     - Modified: <paths that already exist>
     - Removed: <paths to be deleted>
   ```

   ### Bug Fix

   ```markdown
   ## Problem

   <!-- Current broken behavior -->

   ## Root Cause

   <!-- Why it happens -->

   ## Proposed Solution

   <!-- How to fix -->

   ## Non-Goals (optional)

   <!-- Scope exclusions and rejected approaches. Required when design.md is skipped. -->

   ## Success Criteria

   <!-- Expected behavior after fix, verifiable conditions -->

   ## Impact

   - Affected code:
     - Modified: <paths that already exist>
     - New: <paths to be created, relative to project root>
     - Removed: <paths to be deleted>
   ```

   ### Refactor / Enhancement

   ```markdown
   ## Summary

   <!-- One sentence description -->

   ## Motivation

   <!-- Why this is needed -->

   ## Proposed Solution

   <!-- How to do it -->

   ## Non-Goals (optional)

   <!-- Scope exclusions and rejected approaches. Required when design.md is skipped. -->

   ## Alternatives Considered (optional)

   <!-- Other approaches considered and why not -->

   ## Impact

   - Affected specs: <affected capabilities>
   - Affected code:
     - Modified: <paths that already exist>
     - New: <paths to be created, relative to project root>
     - Removed: <paths to be deleted>
   ```

5.5. **UI/UX Spec Source** (UI scope only) <!-- clade fork addition；not in upstream spectra -->

   **Trigger**: proposal `## Impact` 含 `.vue` / `pages/` / `components/` / `app/` 路徑，或 `## Affected Entity Matrix` 含 Surfaces 欄。非 UI / bug fix / pure backend → 跳過此步直接進 Step 6。

   **目的**：在生成 design.md 前，先把 spec 級 UX 需求準備好，融入 design.md 的 UX section（不獨立檔案）。視覺細節（typography / color / motion / craft）禁止在此階段決策，等 apply craft 階段介入。

   **三種情境**：

   - **新 surface / 新 capability**（proposal 含 New Capability + 新增 `.vue`/`pages/` 路徑）→ 跑 `/impeccable teach` 產 Design Context（users / brand / aesthetic / a11y），結果暫存待 Step 7 融入 design.md
   - **延伸既有 surface**（modified capability + 現有 page/component 變更）→ 從 `PRODUCT.md` / `DESIGN.md` / 既有 component 萃取 Design Context，引用既有 docs 路徑
   - **bug fix / 純非 UI** → 不該到這步（trigger 不符），回 Step 6

   **spec 級 reference**（必含於後續 design.md UX section）：

   - `interaction-design.md` — 互動模式、state、affordance、error handling
   - `ux-writing.md` — voice/tone、文案規則、error message 標準
   - `responsive-design.md` — 斷點、觸控目標、breakpoint constraint
   - `spatial-design.md`（部分）— 資訊架構、layout grid 大方向（不到 px）

   **視覺細節**（**禁止**在 propose 階段決策；等 apply craft 階段）：

   - `typography.md` / `color-and-contrast.md` / `motion-design.md` / `craft.md`

   Step 7 生成 design.md 時將融入上述 Design Context + spec 級 reference 至 UX section。

6. **Get the artifact build order**

   ```bash
   spectra status --change "<name>" --json
   ```

   Parse the JSON to get:
   - `applyRequires`: array of artifact IDs needed before implementation
   - `artifacts`: list of all artifacts with their status and dependencies

7. **Create remaining artifacts in sequence**

   Loop through artifacts in dependency order (skip proposal since it's already done):

   a. **For each artifact that is `ready` (dependencies satisfied)**:
   - **Check if the artifact is optional**: If the artifact is NOT in the dependency chain of any `applyRequires` artifact (i.e., removing it would not block reaching apply), it is optional. Get its instructions and read the `instruction` field. If the instruction contains conditional criteria (e.g., "create only if any apply"), evaluate whether any criteria apply to this change based on the proposal content. If none apply, skip the artifact and show: "⊘ Skipped <artifact-id> (not needed for this change)". Then continue to the next artifact.
   - Get instructions:
     ```bash
     spectra instructions <artifact-id> --change "<name>" --json
     ```
   - The instructions JSON includes:
     - `context`: Project background (constraints for you - do NOT include in output)
     - `rules`: Artifact-specific rules (constraints for you - do NOT include in output)
     - `template`: The structure to use for your output file
     - `instruction`: Schema-specific guidance
     - `outputPath`: Where to write the artifact
     - `dependencies`: Completed artifacts to read for context
     - `locale`: The language to write the artifact in (e.g., "Japanese (日本語)"). If present, you MUST write the artifact content in this language. Exception: spec files (specs/\*_/_.md) MUST always be written in English regardless of locale, because they use normative language (SHALL/MUST).
   - Read any completed dependency files for context
   - Generate the artifact content using `template` as the structure
   - <!-- clade fork addition；not in upstream spectra -->
     **UI scope supplement**: 若 Step 5.5 已產出 Design Context（artifact = `design`），於 design.md template 結構內補一個 `## UX Spec` section，包含：(1) Design Context（users / brand / aesthetic / a11y）；(2) spec 級 reference 對應的具體 UX 規格（interaction / ux-writing / responsive / spatial）；(3) 明確聲明「視覺細節（typography/color/motion）由 apply craft 階段決策，不在此規範」。spec 檔（specs/\*.md）永遠英文且只放 SHALL/MUST 規範語句，不在此補 UX context；tasks.md 不補（既有 Check 6 Design Review 7 步覆蓋 tasks 端）
   - Apply `context` and `rules` as constraints - but do NOT copy them into the file
   - Write the artifact via CLI (the CLI handles directory creation and format validation):

     For **design** or **tasks**:

     ```bash
     spectra new artifact <artifact-id> --change "<name>" --stdin <<'ARTIFACT_EOF'
     <content>
     ARTIFACT_EOF
     ```

     For **specs** (one command per capability):

     ```bash
     spectra new artifact spec <capability-name> --change "<name>" --stdin <<'ARTIFACT_EOF'
     <delta spec content>
     ARTIFACT_EOF
     ```

     If the command fails with a validation error, fix the content and retry.

   - Show brief progress: "✓ Created <artifact-id>"

   b. **Continue until all `applyRequires` artifacts are complete**
   - After creating each artifact, re-run `spectra status --change "<name>" --json`
   - Check if every artifact ID in `applyRequires` has `status: "done"`
   - Stop when all `applyRequires` artifacts are done

   c. **If an artifact requires user input** (unclear context):
   - Use **AskUserQuestion tool** to clarify
   - Then continue with creation

8. **Inline Self-Review** (before CLI analysis)

   After creating all artifacts, scan them manually. Fix issues inline, then proceed to the CLI analyzer.

   **Check 1: No Placeholders**

   These patterns are artifact failures — fix each one before proceeding:
   - "TBD", "TODO", "FIXME", "implement later", "details to follow"
   - Vague instructions: "Add appropriate error handling", "Handle edge cases", "Write tests for the above"
   - Delegation by reference: "Similar to Task N" without repeating specifics
   - Steps describing WHAT without HOW: "Implement the authentication flow" (what flow? what steps?)
   - Empty template sections left unfilled
   - Weasel quantities: "some", "various", "several" when a specific number or list is needed

   **Check 2: Internal Consistency**
   - Does every capability in the proposal have a corresponding spec?
   - Does the design reference only capabilities from the proposal?
   - Do tasks cover all design decisions, and nothing outside proposal scope?
   - Are file paths consistent across proposal Impact, design, and tasks?

   **Check 3: Scope Check**
   - More than 15 pending tasks → consider decomposing into multiple changes
   - Any single task would take more than 1 hour → split it
   - Touches more than 3 unrelated subsystems → consider splitting

   **Check 4: Ambiguity Check**
   - Are success/failure conditions testable and specific?
   - Are boundary conditions defined (empty input, max limits, error cases)?
   - Could "the system" refer to multiple components? Be explicit.

   **Check 5: Durable Handoff Review** (run BEFORE the CLI analyzer)

   This change has to survive being parked or handed to another agent. Reject and fix any of the following:
   - **File-path-only tasks**: a task whose entire description is "edit file X" with no behavior, contract, or verification target. File paths are locator context — the task SHALL still describe what is observably true when complete.
   - **Line-number-coupled instructions**: design or tasks content that points to "line 42" / "the function on lines 80-95" as the only way to identify the work. Source line numbers drift; name the function, command, struct, or behavior instead.
   - **Vague acceptance criteria**: success conditions like "works correctly", "behaves as expected", "handles edge cases" without naming the observable behavior or the verification target (test name, CLI invocation, analyzer rule, manual assertion).
   - **Missing scope boundaries on non-trivial work**: design lacking explicit "in scope" / "out of scope" lines for any change that touches more than one subsystem or introduces new behavior. Trivial artifact-only edits MAY skip this; runtime, build, or tooling effects MUST NOT.

   Fix every failure inline using the existing context before running the CLI analyzer. If a failure cannot be fixed without new input from the user, surface it explicitly rather than papering over it.

   **Check 6: Design Review 7-step template (UI scope only)**

   If `tasks.md` references any `.vue` / `pages/` / `components/` / `layouts/` files:
   - tasks.md **MUST** contain a `## N. Design Review` section before `## 人工檢查` (with N = last functional section number + 1)
   - The section **MUST** have all 7 checkboxes (N.1 through N.7) covering: PRODUCT.md/DESIGN.md check, /design improve + Fidelity Report, DRIFT fix loop, canonical-order targeted impeccable skills, /impeccable audit Critical = 0, review-screenshot, Fidelity confirmation
   - Verify by running `bash scripts/spectra-advanced/post-propose-check.sh <change-name>` and acting on its FINDINGS
   - If anything is missing, fix tasks.md inline now — do NOT let an incomplete Design Review section through. Archive gate will block it later anyway.

   **Check 7: Fixtures / Seed Plan (UI scope + Affected Entity Matrix)**

   If `tasks.md` has UI scope **AND** `proposal.md` contains `## Affected Entity Matrix` (= entity-level changes that surface in UI):
   - tasks.md **MUST** contain a `## N. Fixtures / Seed Plan` section before `## Design Review` (with N = last functional section number + 1)
   - Either include at least one `- [ ]` task line per entity-with-Surfaces (entity name, minimum row count, target seed file path) **OR** an explicit `**Existing seed sufficient**` declaration with one-line justification
   - Detected seed-file conventions (in order): `supabase/seed.sql` / `db/seed.sql` / `prisma/seed.ts` / `drizzle/seed.ts`
   - Reason: UI pages displaying empty data on dev/staging make `review-screenshot` worthless. Fixtures are part of feature completeness, not a review-time afterthought.
   - Verify by running `bash scripts/spectra-advanced/post-propose-check.sh <change-name>` and acting on Check 7 FINDINGS
   - Full template + exemption rules see `ux-completeness.md` 「必填 Fixtures / Seed Plan」section

   **Check 8: Phase Purity (UI view vs 非 view 必須切成獨立 phase)**

   If `tasks.md` includes UI view scope (any task references `.vue` / `.tsx` / `.jsx` / `app/pages/` / `app/components/` / `pages/` / `components/` / `views/` / `layouts/` / `.css` / `.scss`):
   - For each functional `## N. <title>` phase in tasks.md (excluding `## N. Design Review` and `## N. Fixtures / Seed Plan`):
     - **MUST NOT** mix view-layer file references with non-view work (schema / migration / API server / store / hook / API client / type / util / 純 backend)
     - 一個 phase 要嘛純 view 工作（component / page / view / layout / styling），要嘛純非 view 工作；混雜 phase 違規
   - Verify by running `bash scripts/spectra-advanced/post-propose-check.sh <change-name>` and acting on Check 4c FINDINGS
   - If a mixed phase is detected, **MUST** split inline now into independent phases — do NOT defer to ingest. spectra-apply Phase Dispatch 規則仰賴 phase purity；混雜 phase 在 apply 時會被擋下要求重 ingest，propose 階段就修掉成本最低
   - Reason: spectra-apply 把 UI view phase 留在主線 Opus（永不外派）、其他 phase 派給 Pi sol high；phase 混雜會破壞 dispatch 邊界，要嘛讓 Pi 碰 view 層、要嘛讓主線吞下原本可以 offload 的 mechanical 工作

   **Check 9: Manual Review Marker Hygiene** (applies to **every** change, not only backend-only)

   Verify **every** rule from Step 5.5 Manual Review Marker Hygiene Check（Rule 1–6，定義在 `references/dispatch-option-a.md`）。下列是逐條驗收清單，**不是** Step 5.5 的完整替代——條文以 Step 5.5 為準：

   1. **Every `## 人工檢查` item line MUST carry a legal leading marker** (right after `#N` / `#N.M`, before the description): `[review:ui]` / `[discuss]` / `[verify:e2e]` / `[verify:api]` / `[verify:ui]` / verify multi-marker `[verify:<a>+<b>]` or `[verify:<a>+<b>+<c>]`. Default Kind Derivation Rule is a fallback for legacy in-flight items only — newly authored content **MUST** be explicit. Default fallback does NOT cover any `verify:*` channel.
   2. **New `[verify:auto]` is forbidden**. If pi draft contains `[verify:auto]`, main thread **MUST** inline replace it: pure API → `[verify:api]`; mutation + visual → `[verify:api+ui]`; persistence / full journey → `[verify:e2e]`.
   3. **Evidence-collection items MUST be marked `[discuss]` or `[verify:api]`**. SSH / `docker exec` / `psql` / `\d <table>` / `SELECT FROM` / controlled drift fabrication / migration existence verification / 商業判斷類「分布是否符合預期」→ `[discuss]`; reproducible HTTP / `curl` round-trip → `[verify:api]`.
   4. **Real user round-trip items MUST use the strongest explicit channel**: persistence / reload / full journey → `[verify:e2e]`; HTTP status / backend contract → `[verify:api]`; final-state visual only → `[verify:ui]`; mutation + visual → `[verify:api+ui]`; human-only allowlist → `[review:ui]`.
   5. **Multi-marker cannot mix verify channels with human/discuss kinds**. `[verify:api+ui]` is valid; `[verify:api+review:ui]` and `[verify:api+discuss]` are invalid.
   6. **每一個**需要特定身分或特定 URL 才看得到的 item（`[review:ui]` / `[verify:ui]` / `[verify:e2e]`，以及任何描述裡出現登入身分的項），**MUST** 在 propose 當下就把入口落盤成結構化 entry，**NEVER** 只寫進中文散文等 GUI 用 regex 考古：

      ```bash
      node ~/offline/clade/scripts/manual-entry.ts --repo <repo> --change <change> \
        --item '#4' --url '<要驗收那一頁的絕對 URL>' --login-as <role> [--login-email <email>] [--viewport 390]
      node ~/offline/clade/scripts/manual-entry.ts --repo <repo> --change <change> --list   # 對帳
      ```

      欄位語義、四種形狀的範本、三條 NEVER 見 cookbook `~/offline/clade/vendor/snippets/manual-review-entry/`。**`--migrate` 是既有 change 的遷移路徑，NEVER 當新 change 的正規路徑**——它產出的 `source: 'derived'` 標記本身就代表「這筆是考古來的、可能不準」。落盤後 `audit-manual-executability.ts` 對該 item 不再報 `PROSE-ONLY-ENTRY`。

   When a violation is detected, the main thread Edit tasks.md inline (do NOT round-trip back to pi). For backend-only changes specifically:

   - Pure technical evidence items (SSH / psql / `\d` / `SELECT` / drift fabrication / migration existence verify) **MUST** be moved out of `## 人工檢查` into `## N. Backend Verification Evidence` section (位置：最後一個功能區塊之後、`## 人工檢查` 之前；N = 上一個功能區塊序號 + 1) — apply Claude self-runs them and pastes evidence under each task.
   - `## 人工檢查` retains only `[discuss]` items in three categories plus reproducible `[verify:api]` HTTP round-trips:
     1. **Production 授權型** — deploy 前 final go/no-go ack、production-only 破壞性操作授權
     2. **商業判斷型** — Claude 無法自動判斷「結果是否合理」的觀察項
     3. **Production 觀察型** — deploy 後 N 小時 / N 天的 production-only soak window 觀察
   - 若三類都沒有，`## 人工檢查` **MUST** 寫成固定文字（archive gate 視為合法）：
     ```
     _本 change 為 backend-only，所有驗證由 apply 階段 Claude 自跑（見 `## N. Backend Verification Evidence`）；deploy 前無使用者人工檢查項目。_
     ```

   For **user-facing** changes: evidence-collection items can stay in `## 人工檢查` but **MUST** be marked `[discuss]` or `[verify:api]` — Claude proactively prepares `[discuss]` evidence during spectra-archive Step 2.5, and main thread runs `[verify:api]` during spectra-apply Step 8a.

   Reason: forcing users to SSH + psql + curl is not "manual review" — it's evidence collection Claude can automate or discuss. Forcing users to manually round-trip automatable flows is also wasted attention — apply Step 8a runs explicit verify channels. Real `[review:ui]` items are reserved for things genuinely requiring a human (email inbox, physical devices, subjective judgment). Mixing dilutes the user's attention.

   Full 規約 (含 Item Kind Marker schema、verify channel cookbook、Backend Verification Evidence 模板、反面範例、違反回報格式) 見 `manual-review.md` 「Item Kind Marker」+ `vendor/snippets/verify-channels/README.md` + `ux-completeness.md` 「必填 Backend-only Manual Review 規約」

   **Check 10: Artifact language convention**

   ```bash
   grep -lE "繁體|繁中|不要使用簡體" CLAUDE.md .claude/rules/*.md 2>/dev/null
   ```

   If the grep matches (consumer enforces 繁體中文):
   - All artifacts (`proposal.md` / `design.md` / `tasks.md` / `specs/**/*.md`) **MUST** be written in 繁體中文.
   - Code identifiers, file paths, technical names (e.g., `audit_signed_chain`, `business_keys_drift`, `PostgREST`), SQL blocks, shell commands, and inline `code` remain untranslated.
   - OpenSpec / Spectra 制式英文標題（如 `## Why`、`## What Changes`、`## Non-Goals`、`## Affected Entity Matrix`、`## User Journeys`、`## Implementation Risk Plan`）保留英文，body 內容必須繁中。
   - If pi draft produced English artifacts despite the convention, fix inline now — main thread Edit 翻譯，**不要**回 pi 重 draft.
   - Reason: pi GPT-5.6-sol 在 prompt 已有繁中指示時仍可能默認輸出英文；主線 cross-check 是最後一道翻譯把關。違反語言慣例會讓使用者在 review/manual-check 階段卡關。

---

## Rationalization Table

| What You're Thinking                                          | What You Should Do                                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| "The requirements are clear enough, no need for discuss"      | Fine if true — but check you're not skipping because you're lazy                      |
| "This artifact isn't needed for this change"                  | Check `applyRequires` — if it's in the dependency chain, create it                    |
| "The spec doesn't need scenarios, the requirement is obvious" | Obvious to you now. Write scenarios for the implementer who doesn't have your context |
| "I'll keep the design brief, code will be self-explanatory"   | Design exists so implementers don't reverse-engineer intent. Be specific              |
| "This is a small change, skip the scope check"                | Small changes touching 5 subsystems aren't small. Check                               |
| "The placeholder is fine for now, I'll fill it in later"      | There is no "later" — implementation is next. Fill it in now                          |

---

8b. **Elicitation gate Part 2（QA 視角 agent）**

   依上方 § Elicitation gate Part 2 派一個 fresh-context subagent 對 spec deltas 問
   「那如果⋯⋯呢」。回來的每一條 MUST 補進 spec 或明確標為 out of scope，兩者都留痕跡；
   **NEVER** 靜默丟棄，**NEVER** 用繼承主線對話的 fork 型 subagent。

9. **Analyze-Fix Loop** (max 2 iterations)
   1. Run `spectra analyze <change-name> --json`
   2. Filter findings to **Critical and Warning only** (ignore Suggestion)
   3. If no Critical/Warning findings → show "Artifacts look consistent ✓" and proceed
   4. If Critical/Warning findings exist:
      a. Show: "Found N issue(s), fixing... (attempt M/2)"
      b. Fix each finding in the affected artifact
      c. Re-run `spectra analyze <change-name> --json`
      d. Repeat up to 2 total iterations
   5. After 2 attempts, if findings remain:
      - Show remaining findings as a summary
      - Proceed normally (do NOT block)

10. **Validation**

    ```bash
    spectra validate "<name>"
    ```

    If validation fails, fix errors and re-validate.

11. **Commit artifacts and end the workflow**（clade fork：不 park，見 `docs/decisions/2026-07-31-propose-does-not-park.md`）

    Show summary:
    - Change name and location
    - List of artifacts created
    - Validation result

    **Notion 專案層同步**（clade fork addition；per [[spectra-notion-coupling]] § 專案層）

    consumer 的 `.claude/consumer-meta.json` 若有 `notion.projectWorkflow: true`，commit artifacts 之前 **MUST** 執行：

    ```bash
    node ~/offline/clade/vendor/scripts/notion-sync.ts propose --consumer-path . --change "<name>" --json
    ```

    - `needsDecision` 非空 → **MUST** 逐條用 `AskUserQuestion` 問使用者（典型是 Class 3 (d)：新 Story 找不到唯一相符的 Epic），拿到答案後帶 `--epic <id>` 或 `--create-epic "<name>"` 重跑同一指令。**NEVER** 因為判定不了就略過不提。
    - 建出的 Story 標題是從 Capability 描述草擬的客戶語言（Class 2），**MUST** 在 summary 標明「標題為草擬，可直接在 Notion 改」。
    - consumer 未啟用 `projectWorkflow` → script 自行 exit 0，不需另外判斷。

    **NEVER 執行 `spectra park`**（2026-07-31 起；決策見 `docs/decisions/2026-07-31-propose-does-not-park.md`）

    Change 在 propose 完成後**維持 active**。Park 的成文契約是「future work pending」
    （per `spectra-archive/SKILL.md` Hard rules），與「剛 propose 完、apply worktree 已備妥、
    下一步就是開工」是不同狀態；由 **user 在決定擱置某張 change 時顯式** `spectra park <name>`。

    移除理由的完整論證見 decision doc：不 park 就沒有 unpark，整類 ghost-park 永久遺失在主路徑上消失。

    **NEVER** 因為「保持 active list 乾淨」自行加回 park —— 一張 apply worktree 已備妥的 change
    出現在 `spectra list` / ROADMAP / review-gui scan 是**準確**的，它確實是 pending work。

    **Pre-handoff: 自動準備 apply 用 worktree**（clade fork addition；not in upstream spectra）

    Per [[worktree-default]] §1, spectra-apply 必須在 isolated session worktree 跑（會寫 tracked product code）。Propose 結束時主動建好對應 worktree，user 才能一鍵接續 apply，不必再手動 `/wt`。

    ```bash
    node scripts/wt-helper.ts add "<change-name>"
    ```

    Helper 行為與失敗處理見 `plugins/hub-core/skills/wt/SKILL.md`。若 helper fail with `Worktree path already exists`（slug 已存在，例如同名 change 之前建過、user 重跑 propose）→ 沿用既有 worktree 即可，視為成功；用 `node scripts/wt-helper.ts list --json` 抓既有 path。其他 helper 錯誤 → 報錯但**仍**繼續吐下方 handoff message，附上錯誤摘要讓 user 手動處理。

    **Handoff message**：

    Output a single status line:

    ```
    Change `<change-name>` ready (active, artifacts committed). Apply worktree ready at `<worktree-absolute-path>`. Run `/spectra-apply <change-name>` from any session to begin — apply skill handles worktree dispatch internally.
    ```

    `<worktree-absolute-path>` 從 wt-helper 輸出抓。Worktree dispatch 由 `/spectra-apply` 內部處理；user 不需 `cd`，從 main 直接跑 `/spectra-apply` 即可。

    **Commit artifacts 到 git（clade fork addition；無條件執行，不問）**

    Artifacts 在 disk 上（本 skill 不 park），**MUST** 在 main worktree（**禁止**在 subagent /
    ephemeral worktree）把它們 commit 進 git：

    ```bash
    # 目錄是 untracked，`--only` 不吃 untracked pathspec，所以先 add 再 --only commit
    # （per rules/core/commit.md § Untracked file 例外）
    git add openspec/changes/<change-name>/
    # MUST 用 git commit --only -- <paths>，per rules/core/commit.md § Ad-hoc commit hard rule
    # NEVER 用裸 git add + git commit 兩段法（multi-session 共用 working tree 會吞別 session 已 staged 的內容；
    # 見 docs/pitfalls/2026-05-24-consumer-ad-hoc-commit-eats-other-session-staged.md）
    git commit --only -m "📝 docs(spectra): propose artifacts for <change-name>" -- openspec/changes/<change-name>/
    ```

    Commit 後 **MUST** verify scope：`git show --stat HEAD | tail -3` 確認 changed files 都在
    `openspec/changes/<change-name>/` 路徑底下；若含其他路徑（代表撞 multi-session staged race 或
    `--only` 沒生效）→ **STOP** + 走 [`rules/core/commit.md`](../../../../rules/core/commit.md)
    § Recovery from mixed commit。

    **為什麼無條件、不問**：舊版把它做成 AskUserQuestion 二擇一（commit vs 維持 parked），是因為
    park 會把 artifacts 移進 SQLite blob、產生遺失窗口，所以要 user 對風險知情。**現在不 park，
    那個窗口不存在**，commit 純粹是「把工作產出落庫」的常規動作，沒有需要 user 權衡的取捨。

    **NEVER** 因為「artifacts 還在 disk 上不會丟」就跳過 commit —— disk 不是版本控制，
    worktree cleanup / `db:reset` / 誤刪都會帶走它們，而 `/spectra-apply` 從 main fork 的 worktree
    看得到的只有 committed 內容。

    If you are currently in Codex Plan Mode, also remind the user to switch the session to normal mode before running `/spectra-apply`. This is only a reminder: do NOT try to use ExitPlanMode or EnterPlanMode, do NOT ask whether to switch modes, and do NOT invoke apply.

    The propose workflow ENDS here. Do NOT invoke `/spectra-apply`. Do NOT call **AskUserQuestion** to ask whether to park, commit, or apply — none of the three is a user decision at this point: park is not executed at all (per `docs/decisions/2026-07-31-propose-does-not-park.md`), the artifact commit is unconditional, and apply is the user's next explicit invocation. This behavior is identical across Auto Mode, interactive mode, and any other agent mode, and does not depend on `AskUserQuestion` availability or UI auto-accept settings.

**Artifact Creation Guidelines**

- Follow the `instruction` field from `spectra instructions` for each artifact type
- Read dependency artifacts for context before creating new ones
- Use `template` as the structure for your output file - fill in its sections
- **IMPORTANT**: `context` and `rules` are constraints for YOU, not content for the file
  - Do NOT copy `<context>`, `<rules>`, `<project_context>` blocks into the artifact
  - These guide what you write, but should never appear in the output
- **Parallel task markers (`[P]`)**: When creating the **tasks** artifact, first read `.spectra.yaml`. If `parallel_tasks: true` is set, add `[P]` markers to tasks that can be executed in parallel. Format: `- [ ] [P] Task description`. A task qualifies for `[P]` if it targets different files from other pending tasks AND has no dependency on incomplete tasks in the same group. When `parallel_tasks` is not enabled, do NOT add `[P]` markers.

**Guardrails**

- Create all artifacts needed for implementation. Optional artifacts (those not in the `applyRequires` dependency chain) may be skipped if their inclusion criteria don't apply.
- Always read dependency artifacts before creating a new one
- If context is critically unclear, ask the user - but prefer making reasonable decisions to keep momentum
- If a change with that name already exists, suggest continuing that change instead
- Verify each artifact file exists after writing before proceeding to next
- **NEVER** write application code or implement features during this workflow
- **NEVER** skip the artifact workflow to write code directly
- **NEVER** reinterpret requirements by ignoring the proposal file
- **NEVER** invoke `/spectra-apply` — this workflow ends after artifact creation. The user decides when to start implementation
- If **AskUserQuestion tool** is not available, ask the same questions as plain text and wait for the user's response
