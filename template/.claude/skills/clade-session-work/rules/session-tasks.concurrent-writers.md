---
description: Session task 與 merge／publish 遇到其他 writer 時的四層 contention probe；常駐 [[session-tasks]] 只留 fail-closed 摘要
paths: ['tasks/**', 'HANDOFF.md', 'ROADMAP.md', 'docs/tech-debt.md', 'docs/pitfalls/**', '.clade/claims/**', '.clade/flow/**']
---
<!-- Clade native rule; source: rules/core/session-tasks.concurrent-writers.md; edit canonical source -->

<!-- clade-targets: claude,codex,cursor -->

# Session Tasks — concurrent writers

> 本檔是 [[session-tasks]] § 並行爭用 的 conditional detail。檔案 dirty、mtime、claim 或互動 session 的 idle 狀態都不能單獨證明 writer 已停止。

## 四層 probe（順序不可調換）

每次檔案層顯示其他 actor 正在寫時，ad-hoc commit、merge-back、stash、publish 都必須完成：

1. **Ownership**：在目標 repo 跑 `node vendor/scripts/flow/flow.ts who --json`，輸出是 `{ rows, blind }` 物件（**不是**陣列）：逐列讀 `rows` 對照 claims／journal 與寫入時間；`blind: true` 代表 journal 沒接上、整份沒有鑑別力，先確認 `enabledPlugins` 含 hub-core。unknown、空結果或 exit 0 都不能證明無人寫。
2. **持有者**：依已確認 runtime、session id、pid 與 worktree path 查 session／process；cwd 只提供候選集，不能當唯一歸因。
3. **現況**：讀實際 session／task snapshot／process status，確認持有者正在做什麼及是否已有同一工作的落地結果；對唯一歸因者走已授權協調入口。
4. **外部 writer**：核對關聯的 runner、background process 與 child；以真實 executable、祖先鏈與入口身分判定 unattended writer。缺少取證能力時保留 unknown。

## 分類後直接行動

| 分類 | 判準 | 動作 |
| --- | --- | --- |
| unattended runner | live runner／child 且入口證據確認 unattended | 不搶、不 stash、不代 commit、不搶 publish；登記需求後讓位 |
| 前景 agent session | session 身分與現況確認前景工作，且已查 writer | 用 runtime coordination / Herdr 協調；若即將落地，等到具名落地事件 |
| 人類正在編輯 | 直接的人類寫入證據 | 仍在寫則保留；已停且有既有授權才可分組提交 |
| unknown | 以上任一層無法確認 | 保留 WIP，不 commit／restore／discard／stash；繼續獨立可做的工作 |

`agent_status: idle`、空 query、pane 無回應、或查不到同名 process NEVER 等於收手。寫「等」時必須綁定可觀察事件（例如 branch 落地、process exit 或 coordination reply）；不能把「等對方收手」當處置。

那個事件是**單一布林**（land 了沒有）。協調訊息 **NEVER** 宣告或詢問 commit 顆粒、拆幾筆、哪一筆先落地——publish 帶 main 上的全部 commit、`/commit` Step 3 自理分組，下游對顆粒零依賴；寫出去只會讓對方以為有一個要它參與的排序決策。

Herdr 不可用時仍保留 ownership／claims／journal／process 檢查；降級的是歸因精度，不是安全 gate。需要人的決策只能在已探測、協調且仍談不攏後，依既有 decision contract 留下完整證據。
