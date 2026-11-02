---
description: Session task 與 merge／publish 遇到其他 writer 時的四層 contention probe，以及多 session 同寫 HANDOFF／ROADMAP／未遷移 consumer tech-debt 這類共享單檔的寫入紀律；常駐 [[session-tasks]] 只留 fail-closed 摘要
paths: ['tasks/**', 'HANDOFF.md', 'ROADMAP.md', 'docs/tech-debt.md', 'packages/*/HANDOFF.md', 'packages/*/ROADMAP.md', 'packages/*/docs/tech-debt.md', '.clade/claims/**', '.clade/flow/**']
---
<!-- Clade native rule; source: rules/core/session-tasks.concurrent-writers.md; edit canonical source -->
<!-- clade-targets: claude,agents -->

# Session Tasks — concurrent writers

> 本檔是 [[session-tasks]] § 並行爭用 的 conditional detail。檔案 dirty、mtime、claim 或互動 session 的 idle 狀態都不能單獨證明 writer 已停止。

## 四層 probe（順序不可調換）

每次檔案層顯示其他 actor 正在寫時，ad-hoc commit、merge-back、stash、publish 都必須完成：

1. **Ownership**：在目標 repo 跑 `node vendor/scripts/flow/flow.ts who --json`，輸出是 `{ rows, blind }` 物件（**不是**陣列）：逐列讀 `rows` 對照 claims／journal 與寫入時間；`blind: true` 代表 journal 沒接上、整份沒有鑑別力，先確認 `enabledPlugins` 含 hub-core。unknown、空結果或 exit 0 都不能證明無人寫。
2. **持有者**：依已確認 runtime、session id、pid 與 worktree path 查 session／process；cwd 只提供候選集，不能當唯一歸因。
3. **現況**：讀實際 session／task snapshot／process status，確認持有者正在做什麼及是否已有同一工作的落地結果；對唯一歸因者走已授權協調入口。
4. **外部 writer**：核對關聯的 runner、background process 與 child；以真實 executable、祖先鏈與入口身分判定 unattended writer。缺少取證能力時保留 unknown。

## 分類後直接行動

本節是爭用判定的唯一正本；clade-publish、commit 等呼叫端只指向這裡，補充自己流程專屬的動作時以下方 id 為鍵，**NEVER** 重新推導分類。

先逐列讀 probe 1 的 `flow who --json`。`rows` 每列的 `verdict` 由 `vendor/scripts/flow/who.ts` 算出，同列的 `action` 是具名指令：

評估：first-match；以上皆非 → OW*

| id | `flow who` 該列 | 動作 |
| --- | --- | --- |
| OW1 | `blind: true` | 整份無鑑別力，所有列走 probe 2–4，依 CW 表分類 |
| OW2 | `verdict=mine` | 照該列 `action` 自己落地 |
| OW3 | `verdict=orphan` | **NEVER** 盲等；照 `action` adjudicate：`git commit --only -- <path>` 落地或 stash [^OW3] |
| OW4 | `verdict` 是 `other-live`、`unknown`、`locked`、`claimed`、`transcript-evidence`、`mtime-window-contested` | 走 probe 2–4，依 CW 表分類 [^OW4] |
| OW* | 其他值、欄位缺、指令非 0 | 當 CW* |

[^OW3]: 兩個獨立訊號都說寫入者已不在，等它等不到任何事件。2026-08-26 實測：gate 對一個已經 commit 完並退出的持有者盲等，三個 session 互等約兩小時。
[^OW4]: `unknown` 承接未知的全部禁令，**NEVER** 讀成 `orphan`，也 **NEVER** 因為 `unknown` 佔多數就當 `orphan` 處理。Bash、Codex、人手改的檔都落 `unknown`，journal 對它們本來就盲。

評估：first-match；以上皆非 → CW*

| id | 分類 | 判準 | 動作 |
| --- | --- | --- | --- |
| CW1 | unattended runner | live runner／child 且入口證據確認 unattended | 不搶、不 stash、不代 commit、不搶 publish；登記需求後讓位 |
| CW2 | 前景 agent session，正要落地 | session 身分與現況確認前景工作、已查 writer，且寫入在收斂中 | 先協調 [^CW2]；不會被覆蓋才等到具名落地事件 |
| CW3 | 前景 agent session，停在半成品 | 同 CW2 的身分確認，但協調後對方沒回應或回覆無主 | 依呼叫端流程處置（publish 走 A／B，見該 skill） |
| CW4 | 人類正在編輯 | 直接的人類寫入證據 | 仍在寫則保留；已停且有既有授權才可分組提交 |
| CW* | unknown | 以上任一層無法確認 | 保留 WIP，不 commit／restore／discard／stash；繼續獨立可做的工作 |

[^CW2]: 用 runtime coordination／Herdr 協調；即將落地時先過 [[concurrent-session-probe]] `[0]` 冗餘檢查（`[0]` 在 § 探測之後：協商，判準表在其後 § 送訊息 MUST 用單引號 heredoc；冪等共享工作的輸出會被對方覆蓋就省略這趟）。

`agent_status: idle`、空 query、pane 無回應、或查不到同名 process NEVER 等於收手。寫「等」時必須綁定可觀察事件（例如 branch 落地、process exit 或 coordination reply）；不能把「等對方收手」當處置。

那個事件是**單一布林**（land 了沒有）。協調訊息 **NEVER** 宣告或詢問 commit 顆粒、拆幾筆、哪一筆先落地——publish 帶 main 上的全部 commit、`/commit` Step 3 自理分組，下游對顆粒零依賴；寫出去只會讓對方以為有一個要它參與的排序決策。

Herdr 不可用時仍保留 ownership／claims／journal／process 檢查；降級的是歸因精度，不是安全 gate。需要人的決策只能在已探測、協調且仍談不攏後，依既有 decision contract 留下完整證據。

## 共享單檔的寫入紀律

[[session-tasks]] 用「一 session 一檔」解 lost update，那對 `tasks/` 有效。本節管它解不掉的另一半：
**本質共享、拆不開的登記簿**——`HANDOFF.md`、`ROADMAP.md`，以及未遷移 consumer 的 `docs/tech-debt.md`。
（lifecycle repo 的 `docs/tech-debt.md` 與 clade `docs/pitfalls/**` 已停寫，不再是任何人的寫入目標；見 clade `specs/truth/work-lifecycle.md` § Old carriers。）
它們的價值來自「所有人讀同一份」，分檔等於取消這個檔存在的理由。

**這條對每一個 consumer、每一個上列檔案生效**，不是只有 clade、也不是只有你手上那一個檔。

`git` 對「另一個 session 整檔覆寫、把你的段落沖掉」零訊號，而 [[commit.detail]] § Verify hard rule 都發生在 commit 之後；覆寫發生在你 Read 與 Write 之間。

### TD 重驗不寫 `docs/tech-debt.md`

TD 重驗的結論不是「本 PR 修了 code」時（過時、重複、卡外部依賴、仍成立但不修），**每一個**未遷移 consumer 都 MUST 改交 `tasks/td-triage/` 決策檔、**NEVER** 為此寫 `docs/tech-debt.md`（[[follow-up-register]] § 重驗結論交決策檔）。一檔一件不會互撞，寫回 register 由套用器批次做一次，下面的 predicate 只管仍需直接寫該檔的人。

### 寫之前：兩條可觀察 predicate

| predicate | 動作 |
| --- | --- |
| `git status --porcelain <該檔>` **回空** | 沒有別人的未 commit 內容，照常 Read → 改 → **立刻** `git commit --only -- <該檔>` |
| `git status --porcelain <該檔>` **非空** | 有人正在寫。**不要現在就把自己的段落寫進去**——先看下一節 |

有 `flow who` 時用它的 owner verdict（`mine` / `orphan` / `unknown`），比 `git status` 準；它不是每個 consumer 都有，**不要假設它到處都在**。

### 檔案已被別人佔住時

**要把自己的 read→write 窗口壓到最短：先談，等對方給信號，收到信號的當下才 apply、apply 完
立刻 commit。不要為了「先卡位」把自己的段落預先寫進去等對方。**

談的內容是四項，逐項都有答案才算談完：這個檔現在是誰的、對方還要多久 commit、
你這筆要不要請對方一起帶出去、對方不在時誰有權代為落地。探測與協商的逐字範本在
`vendor/snippets/concurrent-session-probe/README.md`。

代對方 commit 有前置條件，見 [[commit]] 與各 repo 自家的 ad-hoc commit 紀律。不要因為對方沒回應就直接把它的未完成內容 commit 進 history。

### 廣播是最終手段：准入與檢討報告（MUST）

「廣播」＝對一組候選 session 同發同一則「這是誰的」。它的成本是 N 個 session 各被中斷一次，
命中率卻可以是 0：2026-08-28 clade home 對同一組 dirty 檔廣播 4 次、19 人次，一次都沒指認出持有者。

**准入**——廣播前兩件要都成立：

1. 已跑 `flow who`（沒有 flow 的 repo 跑 cookbook 第 0 步的 transcript 歸屬查詢）
2. 它**有鑑別力**：journal 非空，且 verdict 不是全部同值（全 `unknown`／全 `orphan`）

沒有鑑別力時改做**指名探測**（只問第 0 步命中的那一個 session）或修探測層的接線，**NEVER** 直接廣播。一個回答不了問題的探測層，不會因為問更多人就回答得出來。

**事後**——**每一次**廣播後都 MUST 出一份檢討報告（寫在該 session 的收尾輸出或 task 檔），
逐字回答「**是哪一層失效導致必須廣播**」，並把那一層的缺口登記成 TD 或 pitfall、附上編號。
不要用「大家都回了、問題解決了」結案——廣播成功不代表失效的那一層不用修，不修就是下一次再付一次 N 人次。
檢討報告範本在 `vendor/snippets/concurrent-session-probe/README.md`。

### 寫之後

`git commit --only -- <該檔>`，然後照 [[commit.detail]] § Verify hard rule 驗。
第 2 層對本檔特別重要：`git show HEAD:<該檔> | grep -c '<你剛寫的獨特字串>'` 回 0，
代表你 commit 的是別人的版本、自己的內容已被覆寫。
