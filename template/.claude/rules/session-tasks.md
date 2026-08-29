---
description: ad-hoc 工作開工前 MUST 先建 per-session task 檔——觸發條件、檔名格式、共享單檔禁令、session context 預算門檻
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

拆得開的工作 **NEVER** 用共享單檔（`tasks/todo.md`、`tasks/notes.md`）——multi-session 並行會 lost update。一 session 一檔，只 `Edit` 自己那檔。

**本質共享、拆不開的登記簿是例外，不是違規**——`HANDOFF.md`、`ROADMAP.md`、`docs/tech-debt.md`、`docs/pitfalls/**` 的價值來自所有人讀同一份，分檔等於取消它們存在的理由。那幾個檔的並行寫入紀律見 [[shared-file-concurrent-write]]（`paths:` gated，碰到該檔當下載入）。

不建檔的代價：auto-compact 觸發後本 session 的工作狀態全失，task 檔是跨 compact 的主要狀態載體。

harness 的 `TaskCreate` / `TaskUpdate` 是**進度呈現**（讓使用者看到 in_progress／completed），不是狀態載體，**不替代也不免除**建 tasks 檔——收到 "consider using TaskCreate" 提醒、或要呼叫 `TaskCreate` 時，本 session 尚無 tasks 檔就**先建檔再呼叫**。

session 結束時對每個未完項**升級或刪，二擇一**，不留著。

升級路徑、模板、與其他真相層的分工、`lessons.md` 邊界見 [[session-tasks.operations]]（首次觸碰 `tasks/**` 後自動載入）。此規則優先於全域 `~/.claude/CLAUDE.md`「任務管理」段落（若存在）。

## Session context 預算（MUST）

**Iron Law：越過收工線就收工，不是「等這件做完再說」。而收工線是第二級，不是第一次響的那個門檻。**（一般 session 兩級是 300k / 500k；work-loop runner child 是 500k / 600k，見下表。）

本節適用**每一個** session、**所有** consumer——不是只有覺得跑很久的那次。

### 主判準是可觀察 predicate，token 數字是兜底（MUST）

**切點由下表判，NEVER 由 token 數字判。** Anthropic 官方文檔全站**不給任何** token 門檻——
`/clear` 與 `/compact` 的判準一律是行為型（見下表逐字出處）。官方甚至明寫反向那一半：
*"Sometimes you **should** let context accumulate because you're deep in one complex problem
and the history is valuable"*（[best-practices](https://code.claude.com/docs/en/best-practices)
§ Develop your intuition）。

| 可觀察 predicate | 動作 | 出處 |
| --- | --- | --- |
| 換到**不相關**的任務 / 換 repo / 換主題 | `/clear`，或收工開新 session | 官方 best-practices § Manage context aggressively 逐字 `Run /clear between unrelated tasks` |
| 同一個問題已經糾正 **≥2 次** | `/clear` 重來，把學到的寫進更好的初始 prompt。**NEVER** 在同一段壞掉的 context 上繼續第三次 | 同上 § Course-correct 逐字 |
| 一個 phase / 工作段做完的自然斷點，**且未越過第二級收工線** | `/compact`——**NEVER** 直接跳到「收工開新 session」，見 § 收工訊息契約。越過第二級收工線之後 `/compact` 不再是選項（見該節門檻閘） | 官方 [context-window](https://code.claude.com/docs/en/context-window) 逐字 `before a long new task` |
| 品質退化訊號：開始忘記早前指令、重複犯同一個錯、回答明顯變差 | `/compact` 或收工 | 同上逐字 `when context starts affecting performance` |
| **深在同一個複雜問題中、history 有價值** | **續跑。NEVER 因為 token 數字切** | 官方 best-practices § Develop your intuition 逐字 |

上表沒有任一條觸發時，才輪到下面的 token 兜底層。

**`/clear` 與「同目錄開新 session」同價，NEVER 假設 `/clear` 比較省。** prompt cache 是
server-side、以 **prefix bytes + model** 為 key，**process 身份不在 key 裡**——官方
[prompt-caching § Cache scope](https://code.claude.com/docs/en/prompt-caching) 逐字：
*"Sessions you run in parallel in the same directory build matching prefixes and **read each
other's cache**"*，不同 process 互讀就是證明。官方自己也把 `/clear` 定義成開新 session
（[costs](https://code.claude.com/docs/en/costs) 逐字 `These totals reset when /clear starts a
new session`）。

> 同一份條文同時支持正解與一個已實際發生的誤讀（實錄見 rationale），所以此處把結論寫死，
> **NEVER** 要求下一個讀者自己從 cache scope 重新推導。
>
> 連帶結論：headless `claude --print` 沒有 `/clear`（官方 [headless](https://code.claude.com/docs/en/headless)
> 頁：terminal-only 命令在 `-p` 模式不可用），但**也不需要**——每次 `claude -p` 本身就是新
> session，依上述等價性沒有多付任何成本。**NEVER** 把「runner 不能 `/clear`」當成 runner 的缺陷。

**300k / 500k 是兜底上限，不是切點建議**（Charles 2026-08-06 round 27 拍板；2026-08-07 顧問查證後
維持原值）。它們的正當性**不**來自「官方建議這個數字」——官方不建議任何數字——而來自
「predicate 全沒觸發時仍需要一條 hard stop」。**NEVER** 把這兩個數字讀成「跑到這裡就該切」，
那會讓上表第五列（該續跑的那列）永遠輪不到。

> **NEVER** 拿社群單一來源的數字推翻 user 拍板的門檻——一個曾據此提出的 300k→200k 下修提案，
> 查證後理由整條不成立（實錄見 rationale）。

**兩級語義不同，NEVER 當成同一件事的兩個強度**（Charles 2026-08-06 round 27 拍板）：

| 可觀察 predicate | MUST |
| --- | --- |
| session context 越過 **300k** | **NEVER** 開新的**大**工作段（新的 change / 新的多檔重構 / 新的 spectra phase / **invoke 一個本 session 還沒載過的 skill**）；手上這件做完就收。**小 item 照做**——單檔文字修正、補一條 TD、勾一個 checkbox、回答一個問題不受本級限制 |
| session context 越過 **500k** | **現在**收工，走下面 § 收工三步（先派、後登記、再收工）。手上若是不可分割的驗證迴圈，跑完那一輪就切。**NEVER 用 `/compact` 續跑代替收工**——這一級唯一的出口是 `relay`／`fanout`，判準見 [[session-tasks.operations]] § 收工訊息契約 的門檻閘 |
| 正在跑不可分割的驗證迴圈（單一 test run / 單一 migration） | 跑完再切。**NEVER** 拿「等一下還有事要做」把它延伸成新工作段 |
| **本輪是 work-loop runner child**（`WORK_LOOP_RUNNER_CHILD=1`，由 `runner.sh` 設） | 上面兩級改讀 **500k / 600k**，語義完全不變（500k = 不要再開大工作段、600k = 現在收工）。Charles 2026-08-12 拍板，TD-375 |

**runner child 的兩級為什麼不同。** runner child 每輪是 `claude --print` 起的**全新 process**、跨輪不累積——起始載入量是它的**固定成本**，不是累積量，而實測起始就已越過第一級（取證見 rationale）。**NEVER 把 500k / 600k 套到 in-session `/loop`**——那條路徑的 context 真的跨輪累積，前提成立。判別只認 `runner.sh` 設的那個 env，**NEVER** 從「感覺像無人值守」推斷。

**NEVER 把 300k 那級讀成「什麼都不能開」。** 舊版第一級綁「NEVER 開新的工作段」，對 `/work-loop` 這類一個接一個開 item 的 loop 等於硬停（兩輪腰斬實證見 rationale）。**改的不是數字算錯，是那一級的語義訂錯了**；把 300k 讀回「什麼都不能開」等於把這次拍板退回它要修的狀態。

門檻是 `session-context-budget-warn.sh`（PostToolUse hook）機械報出來的，本節是它引用的 SoT：
**300k 響一次、500k 起每 +100k 再響一次**；runner child 同形狀但整組平移成 **500k 響一次、
600k 起每 +100k 再響一次**。提示走 exit 2 —— PostToolUse 的 exit 0 stderr
只進 debug log，agent 永遠看不到（實錄見 rationale）。

**門檻 NEVER 可由 env / flag 放寬**（曾有的兩個覆寫變數已移除）：門檻是判定 agent 行為合不合格的
數值，只有 user 能調鬆（per `agent-routing` 的自主判定紀律）。會想調鬆它的，正是已經超標的那個
session —— 把閂交給它等於沒有閂。

上表的 runner-child 那列**不是**本條的破口：`WORK_LOOP_RUNNER_CHILD` 不是門檻參數，它是
`runner.sh` 用來宣告**執行身分**的 marker——值由誰設、設成什麼，都不影響任何一組門檻數字。
兩組數字都寫死在 hook 裡，要放寬仍然只有改 hook 一途。**NEVER** 反過來拿這一列論證
「所以其他 env 也可以調門檻」。

### 收工正文在 [[session-tasks.operations]]（具名時機 MUST-Read）

**越過第二級收工線（一般 session 500k／runner child 600k）之後、寫出任何收工訊息之前，MUST 先讀
[[session-tasks.operations]] § 收工**——沒讀到就沒有收工三步的順序、沒有收工訊息契約的部件表、
沒有 Herdr transport 的 canonical helper 與 `fanout` 的 worker-before-relay 硬約束。

`session-context-budget-warn.sh` 在那條線上響，提示訊息逐字帶這個指針——**它是這一段的觸發錨，
`paths:` 不是**（「收工」不對應任何檔案路徑，glob 表達不出來）。

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

**每一次**檔案層探測回報「有另一個 actor 正在寫」都 MUST 跑完這四步再決定動作——不是只有 publish 被擋那次，ad-hoc commit、worktree merge-back、stash 判定、gate 撞紅同樣適用。

```bash
# 0) 誰寫的（零訊息、跨 cwd）：<project-dir> 就是對方 cwd。MUST 再篩「寫入型 tool_use ＋
#    落在爭用檔 mtime 時間窗」，再用 agent_session.value 對回 pane
cd ~/.claude-work/projects && grep -l '<檔名或獨特字串>' */*.jsonl
# 1) 誰在這個 repo 家族上工作（linked worktree 的 cwd 是 <repo>-wt/*，MUST 用前綴比對而非等值）
herdr agent list | python3 -c '
import json,sys
for a in json.load(sys.stdin)["result"]["agents"]:
    if a["cwd"].startswith("<repo 絕對路徑，不含尾斜線>"):
        print(a["pane_id"], a["agent_status"], a["terminal_title_stripped"])
'
# 2) 命中的 pane 逐一讀，看它正在做什麼
herdr agent read <pane_id> --source recent-unwrapped --lines 70
# 3) 無論前兩步結論是什麼都 MUST 跑：背景 runner 沒有自己的 pane，第 1 步對它零訊號
pgrep -af 'work-loop/[r]unner\.sh'            # runner 本體
pgrep -af 'claude --print.*[-]-runner-child'  # 它的當輪 child（runner 正在換輪時只剩這個在）
```

**第 0 步 MUST 跑在第 1 步之前，命中就直接問那一個 pane，NEVER 問候選集。** 第 1 步的 cwd 前綴給的是**候選**，**NEVER 當成完整母體**——跨 repo 寫入者結構上不在裡面，候選集全回「不是我的」只代表「母體可能不含答案」，**NEVER** 是「已排除完畢」。只 grep 檔名會假陽性（查的人自己也命中）。盲區與實證見 [[concurrent-session-probe]] § 入口 A 第 0 步。

**`agent_status: idle` NEVER 等於「對方收手了」。** 它只表示那個 pane 的互動 agent 正在等輸入，對「它掛的背景 process 停了沒」零訊號——2026-08-19 那個 pane 就是 `idle`，背後的 runner 還有 19 輪要跑。**判出 idle 之後 MUST 再跑第 3 步**，不得因為「看起來已經停了」跳過。

第 3 步 **MUST 用 `work-loop/[r]unner\.sh` 這個 pattern**，**NEVER** 用 `runner.sh` / `work-loop` / `--unattended` 這類寬 pattern：2026-08-20 於 `~/offline/clade` 實跑 `pgrep -af "work-loop|runner.sh|--unattended"` 回 9 筆，**全是 false positive**（8 筆 `vendor/scripts/pre-push/runner.sh` git hook ＋ pgrep 自己的 shell），真正的 runner 0 筆。方括號防自我匹配：自己的 command line 含字面 `[r]unner`，不匹配 regex `[r]unner`。

### 三種對方性質 → 動作（判出哪一種就直接執行）

| 對方是 | 可觀察判準 | 動作 |
| --- | --- | --- |
| **unattended runner** | 第 3 步 `pgrep` 命中，或 pane 輸出含 `--unattended` / `--runner-child` / `max-rounds` | **什麼都不做，不搶。** 它有自己的 commit + publish 循環，dirty 是它當輪的中間狀態。**NEVER** stash（腰斬它當輪產出）、**NEVER** 代 commit、**NEVER** 搶 publish；本輪的 publish 需求登記後讓位 |
| **前景 agent session** | 第 1 步命中 pane 且 `agent_status` 隨時間變動、第 3 步無命中 | `SendMessage` ／ `herdr agent prompt` 主動協調（請它先 commit、或告知你要 publish）。對方寫入在數十秒內且看得出正要落地 → **等它落地**，等待本身就是動作 |
| **人類正在編輯** | 第 1、3 步都無命中，但檔案 mtime 持續更新 | 代為分組 commit（`git commit --only -- <paths>`）；半成品訊號命中才 stash |

判出是哪一種之後就**自己執行對應動作**，**NEVER** 把已經判得出來的並行爭用退回給 user。**退回的門有三個，三個都不通**：`AskUserQuestion`、`flow ask`、herdr `--complete blocked --decision`。門長什麼樣不改變它是退回——2026-08-27 <consumer-a> 那題（「兩個 session 在同一個 worktree 跑同一批 dep-upgrade，要留哪一個？」）走的是第三個門，於是它在 `AskUserQuestion` 的 NEVER 底下讀起來像沒被禁。**探測與協商是 agent 的工作，只有「談過了、對方怎麼回」之後仍談不攏的那一題才是人的**，而那題的 `--decision` MUST 寫明已探測、對方怎麼回。

**「等」是上表三個動作之一，NEVER 是「判不出來」的同義詞。** 2026-08-20 於 `~/offline/clade` 實測：merge-back dry-run 報 `docs/tech-debt.md` dirty，第 1 步命中一個前景 session、`git diff` 是別人 16 秒前新增的 TD entry 且缺 `## Restart brief`（半成品訊號命中）——正解是**等它自己 land**（實測 10 秒），代 commit 會把半成品寫進 history、stash 會奪走它正在寫的檔。寫「等」時 **MUST 指名等到哪一個可觀察事件**，**NEVER** 只寫「等對方收手」。

### 非 Herdr 環境的 graceful degrade

`test "${HERDR_ENV:-}" = 1` 失敗時第 1、2 步不可用，**第 3 步照跑**（`pgrep` 不依賴 Herdr），再回退到檔案層 ＋ `.clade/claims/` 的 `last_heartbeat`。**降級掉的是「對方是誰」，NEVER 是「所以可以 escalate 了」**——降級後仍 MUST 自己選出上表三個動作之一；判不出對方性質時取最保守的那個：**什麼都不做**。

### 逐字反開脫

| 開脫 | 實際 |
| --- | --- |
| 「探測都跑完了還是判不出來，這題該 user 拍板」 | 跑完的是檔案層。Step 0 三步跑完了嗎？沒跑完就不叫探測完 |
| 「pane 顯示 idle，對方應該收手了」 | `idle` 只描述互動 agent。2026-08-19 那個 idle pane 背後的 runner 還有 19 輪 |
| 「我問了 N 個 pane，全說不是他們」 | 你問的是 cwd 篩出來的候選集。第 0 步跑了嗎 |
| 「先 stash 起來比較安全，之後再還原」 | 對 unattended runner 是腰斬當輪產出，對前景 session 是奪走它正在寫的檔。stash 只在「對方是人且已停手」時安全 |
| 「我 SendMessage 問它一下就好」（對方是 runner 時） | runner child 是 `claude --print`，沒有 pane 也不讀訊息；那個 idle pane 收到訊息不會轉達給背景 process |
| 「等對方收手就好」 | 對 unattended runner 是等數小時。「等」MUST 綁一個可觀察事件才算動作 |

**Red Flags（發現自己在寫這幾句就停下來跑 Step 0）**：正要對多個候選 pane 逐一送同一則探測；正要列出「等對方收手／stash 強推／我去問那個 session」這組選項；正要用 `AskUserQuestion` 問並行爭用怎麼辦；正要把「哪個 session／pane／worktree 該留下」寫進 `flow ask --question` 或 `--complete blocked --decision`；正要在「對方是誰」還是未知數的狀態下往下決策。

**爭用訊號帶得出 pid 時（advisory lock、process 訊息）走 pid，NEVER 退回 cwd 過濾**：第 1 步的 cwd 前綴在同一 repo 同時有多個 pane 時過濾不出唯一解，而 pid 經 `ps` 祖先鏈直達 `claude … --session-id`，是精確對映。做法與「持有者正在跑同一條冪等流程時搭它的車」見 [[pitfall-pipeline-lock-contention-raced-instead-of-probed]]。

可貼的探測序列（兩個入口、身分兩條、`rg -L | xargs` 回 0 的坑）在 [[concurrent-session-probe]]（`vendor/snippets/concurrent-session-probe/`）——**撞上爭用時 MUST 開它照貼，NEVER 現場重拼指令**。

> 第一手實錄：[[pitfall-working-tree-contention-escalated-without-session-layer-probe]]（2026-08-19 <consumer-a>，連問三輪、選項 3/3 錯，user 一句「你去檢查 pane」終結）。同型換 domain：[[pitfall-infra-change-attribution-skips-concurrent-session-check]]。
