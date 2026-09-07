---
description: ad-hoc 工作的追蹤載體、唯讀與指定產物邊界、共享單檔紀律、session context 預算門檻
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/session-tasks.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

<!-- clade-targets: claude,codex,cursor -->
<!-- clade-adapters: claude,codex,cursor -->

# Session Tasks

每一個 ad-hoc 工作先依當次授權選擇載體：

| 可觀察的任務範圍 | 追蹤與交付 |
| --- | --- |
| 明示唯讀、禁止寫檔，或只要求在對話交付盤點／計畫 | 在對話交付進度、證據及未解項；不建立 task 檔或為追蹤修改 repository／spine |
| 只允許寫指定計畫／報告文件 | 在該文件追蹤進度；不另建 tasks 檔、不擴成實作或提交 |
| 已授權本機修改的 ad-hoc 工作（debug／配置調整／單檔 fix） | **MUST 先**建立 `tasks/<YYYY-MM-DD-HHMM>-<slug>.md`，再修改業務檔；timestamp 取開工當下、slug 用 kebab-case |

任務後續取得實作授權時，重新套用上表；先前的唯讀交付不代替實作追蹤。

本規約適用**所有** consumer。命中上表建 task 檔那列時，`tasks/` 目錄不存在**不代表**本 repo 未採用——直接建立。

拆得開的工作 **NEVER** 用共享單檔（`tasks/todo.md`、`tasks/notes.md`）——multi-session 並行會 lost update。一 session 一檔，只編輯自己那檔。

**本質共享、拆不開的登記簿是例外，不是違規**——`HANDOFF.md`、`ROADMAP.md`、`docs/tech-debt.md`、`docs/pitfalls/**` 的價值來自所有人讀同一份，分檔等於取消它們存在的理由。那幾個檔的並行寫入紀律見 [[shared-file-concurrent-write]]（`paths:` gated，碰到該檔當下載入）。

已授權實作的 task 檔承載跨 compact 狀態；唯讀或指定文件任務沿用上表的交付載體。

runtime 的原生進度工具是**進度呈現**。命中上表實作列時，它們**不替代也不免除**建 tasks 檔；要呼叫原生進度工具時，先確認本次實作已有 task 檔。工具提醒不新增文件、實作或提交授權。

session 結束時對每個未完項**升級或刪，二擇一**，不留著。

升級路徑、模板、與其他真相層的分工、`lessons.md` 邊界見 [[session-tasks.operations]]（首次觸碰 `tasks/**` 後自動載入）。此規則優先於runtime 全域指令「任務管理」段落（若存在）。

## Session context 預算（MUST）

本節適用每一個 session、所有 consumer。先確認目前 runtime 與 launcher 的實際 context 控制、計量來源及適用的已核准 profile；數值、原生命令、hook 與身分 marker 由對應 adapter 承載。

### 主判準是可觀察 predicate

| 可觀察 predicate | 動作 |
| --- | --- |
| 換到不相關的任務、repo 或主題 | 先保存本工作狀態，再用該 runtime 支援且當次獲授權的 fresh-context 或 session transport |
| 同一問題已糾正 ≥2 次 | 把已驗證教訓與未決問題整理成可接手的狀態，使用可用的 fresh-context 機制重新開始該問題 |
| phase 完成的自然斷點，尚未超過適用 hard tier | 保存狀態並使用實際可用的 context 壓縮／checkpoint；原生壓縮不等於工作已完成 |
| 忘記早前指令、重複錯誤或品質退化 | 保存目前授權、成果與未完項，依 runtime 可用能力壓縮或交接 |
| 深在同一個複雜問題，history 仍有價值，且未命中適用 hard tier | 繼續推進，不以其他 runtime 的數值切斷工作 |

### 已核准 profile 的兩級語義

**Iron Law：適用 hard tier 是收工線；soft tier 是限制新大工作段。** 超過 soft tier 後，MUST 不開新的 tasks 檔、多檔重構、新的實作 phase 或尚未載入的 skill；手上驗收與小 item 仍可完成。超過 hard tier 後，MUST 保存狀態並按下節交接；不可分割的單一驗證迴圈先跑完，不延伸成下一段。壓縮不重設該 profile 定義的 hard-tier 義務。

**MUST 用該 profile 定義的量測口徑判門檻**：累計用量、當前 context 佔用與壓縮後剩餘量不是同一個值。缺少 profile 或量測能力時，明列該缺口，使用上述可觀察 predicate 與 harness 的實際限制；**NEVER** 借另一個 runtime 的門檻、hook payload 或 model 名稱宣稱已適用、未超標或取得豁免。

門檻只能依已核准政策調整，**NEVER** 自行以 env／flag 放寬。Runner 與顧問身分須由該 runtime 的真實入口／session 證據判定，工作內容像顧問或無人值守不構成身分證據。

### 收工正文在 [[session-tasks.operations]]（具名時機 MUST-Read）

**越過該 launcher 的 hard tier 之後、寫出任何收工訊息之前，MUST 先讀
[[session-tasks.operations]] § 收工**——沒讀到就沒有收工三步的順序、沒有收工訊息契約的部件表、
沒有 Herdr transport 的 canonical helper 與 `fanout` 的 worker-before-relay 硬約束。

適用 runtime 的 context 訊號觸發上述必讀義務；adapter 應列明實際量測入口。`paths:` 不是觸發錨，因為「收工」不對應檔案路徑。

| 搬走的段 | 去 [[session-tasks.operations]] 的 § |
| --- | --- |
| 收工三步（先派、後登記、再收工）／「派不出去」的兩類外部條件 | § 收工三步 |
| 成本模型（cache miss、讀取量 ≠ 成本） | § 成本模型 |
| 收工前的自我開脫對照表 | § 收工前的自我開脫 |
| 收工訊息契約 A／B ＋ Worktree lifecycle close gate | § 收工訊息契約 |
| Herdr session transport ／ 派幾個 pane ／ successor 收割 ／ 已列明 gate 短答 | § Herdr session transport 起四節 |


## 並行爭用：檔案層之後 MUST 再問 session 層

**Iron Law：檔案層回答「有沒有人在寫」，回答不了「對方會不會自己停」——而動作完全由後者決定。探測停在檔案層就 escalate，是規約違反，不是謹慎。違反字面就是違反精神。**

`git status` dirty、mtime 在數十秒內、`.clade/claims/` 有沒有活 claim——這些觀測值在**人類正在編輯**、**前景 agent session**、**背景 unattended runner** 三種情況下**完全相同**。檔案層跑得再完整都停在同一個岔路口；判不出來**不是**「該 user 拍板」的訊號，是還有一層沒探。

### Step 0（四步，順序不可調換）

每一次檔案層顯示其他 actor 正在寫時，MUST 完成以下四步再決定動作；ad-hoc commit、merge-back、stash 與 publish 同樣適用。

1. **查寫入歸屬**：在目標 repo 執行 `node vendor/scripts/flow/flow.ts who --json`；已驗證本 session ID 時加 `--session <session-id>`。此 CLI 讀共享 main 的 ownership，linked worktree 的私有 WIP 仍須在該 worktree 另查。逐個爭用 path 對照 claims／journal 與真實寫入時間。`unknown`、空結果、缺 journal 或 exit 0 都不能單獨證明無人寫入；exit 3 表示有非本 session 或不可歸因項。
2. **定位持有者**：以已確認的 runtime、session ID、pid 與 worktree path 查該 runtime 的 session／process 資料。只有 filename 出現在 transcript 不算寫入證據。Herdr 可用時可查 `herdr agent list` 並讀命中 pane；cwd 家族比對只給候選集，跨 repo 寫入者可能不在其中。
3. **讀持有者現況**：使用實際可用的 session read／task snapshot／process status，確認它正在做什麼、是否已有同一工作的落地結果。對唯一歸因者使用已授權的協調入口；不因一批候選皆否認就宣稱已排除所有寫入者。
4. **查外部 writer 是否仍活著**：無論互動 session 是否 idle，都核對與該 session 關聯的背景 process、runner 及 child。以真實 executable、祖先鏈與入口注入的身分判定；具體探測由相應 adapter 承載。缺少跨 runtime 取證能力時保留 unknown。

**`agent_status: idle` NEVER 等於「對方收手了」。** 它只描述互動介面，不證明背景 writer 已退出。原生 subagent 回報完成或 interruption receipt 同樣不能代替外部 process 的停止證據。

`flow who --transcripts` 的 transcript fallback 目前只涵蓋 Claude；需要該語料取證時才顯式開啟。MUST 不把此結果當作三個 runtime 與人類編輯者的完整母體。對應 adapter 的取證入口不可用時，保留檔案並繼續可獨立完成的工作。

### 三種對方性質 → 動作（判出哪一種就直接執行）

| 對方是 | 可觀察判準 | 動作 |
| --- | --- | --- |
| **unattended runner** | 第 4 步查到與持有者關聯的 live runner／child，且其實際入口證據確認 unattended 身分 | **什麼都不做，不搶。** 它有自己的 commit + publish 循環，dirty 是它當輪的中間狀態。**NEVER** stash（腰斬它當輪產出）、**NEVER** 代 commit、**NEVER** 搶 publish；本輪的 publish 需求登記後讓位 |
| **前景 agent session** | 已確認的 session 身分與現況顯示前景工作，並已查其背景 writer | runtime coordination message ／ `herdr agent prompt` 主動協調（請它先 commit、或告知你要 publish）。對方寫入在數十秒內且看得出正要落地 → **等它落地**，等待本身就是動作 |
| **人類正在編輯** | 有直接人類編輯證據；不能由 agent 查無結果反推 | 僅在該 repo 的既有明確授權允許代 commit 且對方已停寫時分組提交；仍在編輯則保留。未知或活躍 WIP 不以 stash 處置 |

判出是哪一種之後就**自己執行對應動作**，**NEVER** 把已經判得出來的並行爭用退回給 user。**退回的門有三個，三個都不通**：structured user-input surface、`flow ask`、herdr `--complete blocked --decision`。門長什麼樣不改變它是退回——2026-08-27 <consumer-a> 那題（「兩個 session 在同一個 worktree 跑同一批 dep-upgrade，要留哪一個？」）走的是第三個門，於是它在 structured user-input surface 的 NEVER 底下讀起來像沒被禁。**探測與協商是 agent 的工作，只有「談過了、對方怎麼回」之後仍談不攏的那一題才是人的**，而那題的 `--decision` MUST 寫明已探測、對方怎麼回。

**「等」是上表三個動作之一，NEVER 是「判不出來」的同義詞。** 2026-08-20 於 `~/offline/clade` 實測：merge-back dry-run 報 `docs/tech-debt.md` dirty，第 1 步命中一個前景 session、`git diff` 是別人 16 秒前新增的 TD entry 且缺 `## Restart brief`（半成品訊號命中）——正解是**等它自己 land**（實測 10 秒），代 commit 會把半成品寫進 history、stash 會奪走它正在寫的檔。寫「等」時 **MUST 指名等到哪一個可觀察事件**，**NEVER** 只寫「等對方收手」。

### 原生取證入口缺少時的 graceful degrade

Herdr 不可用就使用當前 runtime 已提供的 session／process 入口，ownership／claims／journal 與外部 writer 檢查仍保留。**降級掉的是「對方是誰」，NEVER 是「所以可以 escalate 了」**——查不到持有者時保留其 WIP，不代 commit、不 stash、不搶 publish，繼續不依賴該檔的工作。需要人的決策仍依既有授權與衝突仲裁規約，不把缺少取證工具偽裝成已確認的人類編輯。

### 逐字反開脫

| 開脫 | 實際 |
| --- | --- |
| 「探測都跑完了還是判不出來，這題該 user 拍板」 | 跑完的是檔案層。Step 0 四步跑完了嗎？沒跑完就不叫探測完 |
| 「pane 顯示 idle，對方應該收手了」 | `idle` 只描述互動 agent。2026-08-19 那個 idle pane 背後的 runner 還有 19 輪 |
| 「我問了 N 個 pane，全說不是他們」 | 你問的是 cwd 篩出來的候選集。寫入歸屬那一步跑了嗎 |
| 「先 stash 起來比較安全，之後再還原」 | 對 unattended runner 是腰斬當輪產出，對前景 session 是奪走它正在寫的檔。stash 只在「對方是人且已停手」時安全 |
| 「我 SendMessage 問它一下就好」（對方是 runner 時） | runner 的外部 child 不必有互動收件入口；pane 收到訊息不證明背景 writer 收到或停止 |
| 「等對方收手就好」 | 對 unattended runner 是等數小時。「等」MUST 綁一個可觀察事件才算動作 |

**Red Flags（發現自己在寫這幾句就停下來跑 Step 0）**：正要對多個候選 pane 逐一送同一則探測；正要列出「等對方收手／stash 強推／我去問那個 session」這組選項；正要用 structured user-input surface 問並行爭用怎麼辦；正要把「哪個 session／pane／worktree 該留下」寫進 `flow ask --question` 或 `--complete blocked --decision`；正要在「對方是誰」還是未知數的狀態下往下決策。

**爭用訊號帶得出 pid 時（advisory lock、process 訊息）走 pid，NEVER 退回 cwd 過濾**：session 列表的 cwd 前綴在同一 repo 同時有多個 pane 時過濾不出唯一解，而 pid 須經祖先鏈與該 runtime 的真實 session 身分證據對映，不能以 process 名稱猜持有者。做法與「持有者正在跑同一條冪等流程時搭它的車」見 [[pitfall-pipeline-lock-contention-raced-instead-of-probed]]。

可貼的探測序列（兩個入口、身分兩條、`rg -L | xargs` 回 0 的坑）在 [[concurrent-session-probe]]（`vendor/snippets/concurrent-session-probe/`）——撞上爭用時 MUST 先讀對應 runtime adapter 與 cookbook 的適用邊界；只執行當前已驗證可用的入口，不把 Claude 探測套成其他 runtime 的全量證據。

> 第一手實錄：[[pitfall-working-tree-contention-escalated-without-session-layer-probe]]（2026-08-19 <consumer-a>，連問三輪、選項 3/3 錯，user 一句「你去檢查 pane」終結）。同型換 domain：[[pitfall-infra-change-attribution-skips-concurrent-session-check]]。
