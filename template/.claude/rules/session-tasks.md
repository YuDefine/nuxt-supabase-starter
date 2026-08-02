---
description: ad-hoc 工作開工前 MUST 先建 per-session task 檔——觸發條件、檔名格式、共享單檔禁令
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/session-tasks.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# Session Tasks

開始任何 ad-hoc 工作（debug／配置調整／單檔 fix／勘查）且不走 spectra change 時，**MUST 先** `Write` `tasks/<YYYY-MM-DD-HHMM>-<slug>.md`（timestamp 取開工當下，slug 用 kebab-case），再動手。

本規約適用**所有** consumer。`tasks/` 目錄不存在**不代表**本 repo 未採用——直接建立即可。

**NEVER** 用共享單檔（`tasks/todo.md`、`tasks/notes.md`）——multi-session 並行會 lost update。一 session 一檔，只 `Edit` 自己那檔。

不建檔的代價：auto-compact 觸發後本 session 的工作狀態全失，task 檔是跨 compact 的主要狀態載體。

harness 的 `TaskCreate` / `TaskUpdate` 是**進度呈現**（讓使用者看到 in_progress／completed），不是狀態載體，**不替代也不免除**建 tasks 檔——收到 "consider using TaskCreate" 提醒、或要呼叫 `TaskCreate` 時，本 session 尚無 tasks 檔就**先建檔再呼叫**。

session 結束時對每個未完項**升級或刪，二擇一**，不留著。

升級路徑、模板、與其他真相層的分工、`lessons.md` 邊界見 [[session-tasks.operations]]（首次觸碰 `tasks/**` 後自動載入）。此規則優先於全域 `~/.claude/CLAUDE.md`「任務管理」段落（若存在）。
