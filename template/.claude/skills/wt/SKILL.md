---
name: wt
description: "開隔離 worktree 並在裡面派工的內部工具：建立或接續 `<consumer>-wt/<slug>/`、寫 WORKTREE-BRIEF、依 routing table 選執行者派工、驗收後交給 commit 批次落地。Use when work-route、handoff、work-loop 等呼叫端已判定這件工作要隔離，或使用者明確要求開 worktree。要不要隔離由呼叫端判斷，本 skill 不判斷。NOT for 發布散播（走 clade-publish）、提交已完成工作（走 commit）、只是要切 branch。"
license: MIT
metadata:
  author: clade
  version: "5.1"
  clade:
    permission_tier: action
---

<!-- clade-skill-scope: both -->

# wt

呼叫端（`work-route` §0、`handoff` Mode B、`work-loop`）已判定要隔離；本 skill 建立或接續 worktree、派工、驗收、交 commit 批次落地，不重判。

# SOP

brief 與回報照 `templates/` 骨架複製結構、參考同名 `.example.md` 改寫填位。

## Phase 1 -- 建立或接續 worktree

1. READ 讀取呼叫端給的任務、slug、`work_id`、允許路徑、下游 skill（若有）與 cwd。
2. THINK READ 若要判新建、接續或停下，讀取 `rules/接續或新建判準.md`；接續跳到第 6 步。
3. THINK READ 若要新建，讀取 `rules/fork前baseline判準.md` 定 baseline 參數。
4. DELEGATE 逐一執行 `wt-helper.ts add`（`wt-helper指令.md` § 建立），取得各樹路徑與 branch。
5. READ 讀取 `add` 輸出的 `backing-service:` 狀態行（同節）；沒有就記「無」。
6. WRITE 新建照 `templates/worktree-brief.md` 在樹根寫 `WORKTREE-BRIEF.md`；接續照第 2 步判準 Rule 2。

## Phase 2 -- 選定執行者並派工

1. THINK 讀取 routing table（`agent-routing.routing-table`），逐任務選定列、model、effort、載體，回報一行 `Routing: <task> → <row> / <model> / <effort> / <載體>`；判不進任何一列的由主線在該樹內做。
2. WRITE 照 `templates/worker-brief.md` 逐個派出任務寫 worker brief；有下游 skill 時任務段選「在本樹內呼叫該 skill」的變體。
3. DELEGATE 依載體派工，同一則訊息排好等待機制；指令與等待方式讀 `派工載體.md` 對應節。

## Phase 3 -- 驗收成果並交給批次落地

1. READ 收到完成通知後，讀取 worker 回報、該樹 `git log main..HEAD` 與 `git status`、brief 驗收標準。
2. THINK READ 若要驗收，讀取 `rules/成果驗收判準.md`；READ 若要保留或回收來源，讀取 `rules/worktree保留與回收判準.md`。
3. DELEGATE READ 若來源通過驗收，讀取 `rules/就緒池交接判準.md`，依序跑 `batch checkpoint`、`batch ready`、`batch status --trigger auto --workflow <workflow_model>`（`wt-helper指令.md` § 批次）；命中觸發條件時呼叫 `/commit`。
4. WRITE 照 `templates/wt-report.md` 向呼叫端彙整回報，列出每棵保留中的樹與理由。

## SOP 之外（hook／brief 提示）

- READ 若自己是被派進 worktree 的 worker，讀取 `rules/worker契約.md`。
- READ 若在 main 要改 tracked 檔，讀取 `rules/改tracked檔前先隔離判準.md`。
- READ 若要讀工作進度檔，讀取 `rules/讀進度前先查worktree判準.md`。
- 維護、復原讀 `wt-helper指令.md` 對應節。

# Runtime adapter: Claude
Use Claude's qualified main line for UI implementation and visual judgement. Bind host question, Agent, completion notification, TaskStop and keepalive operations to the native Claude tools; these bindings do not authorize changing the shared worktree gates.

Claude bindings: dispatch uses the named `Agent` operation; completion arrives through native notification. Use `TaskStop` only after the deadline intervention and wait for terminal notification. Use `ScheduleWakeup` only for the inert control prompt, and stop it on terminal evidence. User choices use `AskUserQuestion`.
A worktree operation counts as executed only with the Claude session/pane identity and its completion receipt attached; the `Agent` ephemeral-worktree path is a historical observation, not a supported transport.
