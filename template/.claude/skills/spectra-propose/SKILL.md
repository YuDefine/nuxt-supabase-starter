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
---
<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/spectra-propose/
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->


Create a complete Spectra change proposal — from requirement to validated artifacts — in a single workflow.

**Input**: The argument after `/spectra-propose` is the requirement description. Examples:

- `/spectra-propose add dark mode`
- `/spectra-propose fix the login page crash`
- `/spectra-propose improve search performance`

If no argument is provided, the workflow will extract requirements from conversation context or ask.

**Prerequisites**: This skill requires the `spectra` CLI. If any `spectra` command fails with "command not found" or similar, report the error and STOP.

**Steps**

0. **Choose execution platform** （discuss → propose 銜接）

   **Detect handoff intent first（不要重問）：**
   - 若上游 `spectra-discuss` 在 transition 時明示「使用者已選 A」 → 直接走 **A 路徑**
   - 若明示「使用者已選 B」 → skip 這整個 Step 0，直接跳到 Step 1
   - 否則用 **AskUserQuestion** 詢問：
     - **A. Codex（GPT-5.5 xhigh）** — 主線派 Codex 在背景執行 propose
     - **B. Claude Code 繼續做** — 在當前 session 走 Step 1-11
   - If **AskUserQuestion** is unavailable, present as plain text and wait for the user's reply

   ### A 路徑：主線 Claude **自己派 Codex 在背景跑**（**禁止**叫使用者切 CLI、**禁止**「Stop here」）

   依以下順序執行（每一步都是主線 Claude 自己做，不需使用者介入）：

   1. **解析 change name + requirement**：從 argument / discuss artifacts / 對話脈絡萃取，導出 kebab-case `<change-name>` 與一句話 requirement
   2. **Write prompt 檔到 `/tmp/codex-spectra-propose-<change-name>-prompt.md`**，內容固定包含：

      ```
      請以本 repo 的 spectra-propose 流程建立 change `<change-name>`。
      Requirement：<一句話需求>

      讀取以下檔案理解流程後執行：
      - .claude/skills/spectra-propose/SKILL.md（**只執行 Step 1 ~ 11**，**跳過** Step 0 — 已決定由你執行）
      - .claude/rules/ux-completeness.md（必填區塊：Affected Entity Matrix / User Journeys / Implementation Risk Plan）
      - .claude/rules/agent-routing.md
      - 任何 discuss 階段已捕獲的 design.md / spec.md（位置：openspec/changes/<change-name>/，若已存在）

      完成標準：`spectra park <change-name>` 執行成功。
      不要呼叫 /spectra-apply。產出後在 stdout 摘要 artifacts 列表 + `spectra validate` 結果。
      ```
   3. **背景啟動 codex exec**（**Bash** tool 加 `run_in_background=true`）：

      ```bash
      cd <consumer-repo-root> && codex exec \
        --model gpt-5.5 \
        -s workspace-write \
        --skip-git-repo-check \
        -c model_reasoning_effort=xhigh \
        < /tmp/codex-spectra-propose-<change-name>-prompt.md 2>&1
      ```

   4. **立刻**簡短回報給使用者：「已派 Codex GPT-5.5 xhigh 在背景執行 `/spectra-propose <change-name>`（bash job `<id>`，output stream 跟著走）」
   5. **等通知 + Open Questions 主動檢查**：收到 `<task-notification> status=completed` 時**立刻**依序執行：
      1. 用 BashOutput 讀該 job 的完整 stdout（或對應 output 檔）
      2. 簡短摘要：產出哪些 artifacts、`spectra validate` 結果、是否 park 成功
      3. **MUST 掃 design.md 的 Open Questions**（不論前面摘要多漂亮，這步**不能省略**）：
         - 用 Read 讀 `openspec/changes/<change-name>/design.md`
         - 用 grep 找 `## Open Questions`（或同義變體：`## Open Question`、`## 待決問題`、`## Unresolved Questions`）標題
         - 若標題存在且區塊內容非空（不是 `(none)` / `N/A` / `無` / 只剩空 bullet / 只剩註解）：
           - **立刻**用 **AskUserQuestion** 把每一題列給使用者（一次最多 5 題，超過分批問）；題目沿用 design.md 的原句，必要時補一句脈絡讓使用者好答
           - **NEVER** 把「要不要回答 open questions」包成 A/B/C/D 選單裡的一個選項丟給使用者選 — open questions 是 apply 前的硬決策，**MUST** 主動拿到答案
           - **NEVER** 自行假設答案、自行標 wontfix、或推給未來（"晚點再決定"、"apply 時再說"）
           - 若 **AskUserQuestion** 不可用，就用純文字逐題列出並等使用者回覆
         - 拿到答案後：`spectra unpark <change-name>` → 用 Edit 把 design.md 的 `## Open Questions` 段落改為 `## Resolved Questions`，每題下補一行 `**Answer:** <使用者回答>` → `spectra analyze <change-name> --json` 確認沒新 Critical/Warning → `spectra validate <change-name>` → `spectra park <change-name>`
      4. **Open Questions 處理完（或本來就沒有）後**才列出後續可選動作（`/spectra-apply <change-name>` 等）
   6. **NEVER** 沉默等使用者來問進度；通知一到自己讀檔回報
   7. **本 session 不再執行任何 Step 1 ~ 11**（避免雙重生產）— Step 0 A 路徑結束本 skill

   ### B 路徑

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

11. **Park the change and end the workflow**

    Show summary:
    - Change name and location
    - List of artifacts created
    - Validation result

    Then unconditionally execute:

    ```bash
    spectra park "<name>"
    ```

    Inform the user that the change is parked and that running `/spectra-apply <change-name>` when ready will auto-unpark the change and start implementation.

    The propose workflow ENDS here. Do NOT invoke `/spectra-apply`. Do NOT call **AskUserQuestion** to ask whether to park or apply. This behavior is identical across Auto Mode, interactive mode, and any other agent mode — parking is unconditional and does not depend on `AskUserQuestion` availability or UI auto-accept settings.

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
