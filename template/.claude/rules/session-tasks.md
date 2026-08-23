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

**NEVER** 用共享單檔（`tasks/todo.md`、`tasks/notes.md`）——multi-session 並行會 lost update。一 session 一檔，只 `Edit` 自己那檔。

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
| 一個 phase / 工作段做完的自然斷點 | `/compact`——**NEVER** 直接跳到「收工開新 session」，見 § 收工訊息契約 | 官方 [context-window](https://code.claude.com/docs/en/context-window) 逐字 `before a long new task` |
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
| session context 越過 **500k** | **現在**收工，走下面 § 收工三步（先派、後登記、再收工）。手上若是不可分割的驗證迴圈，跑完那一輪就切 |
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

### 收工三步（越過 500k 那一級 MUST，順序不可調換）

1. **先把殘工派出去**（transport 走 § Herdr session transport）。**判準是「有幾件可平行的工作」**：1 件（含多件但彼此 serial）走 `/handoff relay`，全部寫進同一份 brief 交給 successor 依序推進；N ≥ 2 件可平行走 `/handoff fanout`，各派一個 worker pane 再交棒給 successor 繼承它們。兩者本 session 都隨即收工（判準見 § 派幾個 pane —— 先判這一題）
2. 剩下**派不出去**的才寫進 `tasks/<date>-<slug>.md`（或 `HANDOFF.md` / `docs/tech-debt.md`），且**逐條寫明它派不出去的具體外部條件**
3. 收工，收工訊息走 § 收工訊息契約

本三步適用**每一個**越過 500k 的 session、**所有** consumer，且**每一項**殘工都要各自過第 1 步——
不是「挑一項派掉、其餘登記」。

**NEVER 把第 2 步當成第 1 步的替代品。** 逐字反開脫：「已經寫進交接檔了」「未完項都登記好了，
留給下一個 session」「下個 session 接手時看得到」——這幾句描述的是第 2 步做完，對第 1 步零訊號。

**context 越滿，dispatch 的相對價值越高**：那些 token 每一個 turn 都重讀一次。500k 那一級是**最該派**
的時刻，**NEVER** 讀成「已經沒有餘裕再派了」。

**每一次派工都 MUST 以 successor 收尾**（`relay` 本身就是，`fanout` 的最後一步是 `--relay`）。
派了 worker 卻不交棒、直接收工，會留下**沒有人持有的 handshake**：child 的 outcome 寫進 durable
record 後沒有任何東西會把它收割（實測形狀：15 筆 dispatch record 掛 118–169 小時從無 completion）。
逐字反開脫：「反正 patrol 之後會掃到」「outcome 寫進 record 就好」「下個 session 會看到」——
patrol 只印出「這筆該有人收」，它不是收割者。

「派不出去」**MUST 講得出具體外部條件**，只有兩類算數：

| 可觀察 predicate | 例（2026-08-13 實錄） |
| --- | --- |
| 等一個具體外部 signal | 目標目錄是**別 session 進行中**的封存產出，含 HEAD 沒有的檔，現在動就是永久遺失 |
| 被別 session 的未 commit 檔擋住 | pre-push ratchet 對別 session 兩個未 commit `.vue` 掃出 baseline 超標，且不在本次授權 scope |

「需要人判斷」「要謹慎」「這個比較複雜」「要 attended」**都不是**外部條件。講不出具體外部條件
＝ 派得出去。

### 成本模型（2026-08-07 納入 prompt caching 修正）

**真正的成本殺手不是長 session，是 cache miss。** 單次 miss 在 300k context ≈ +0.9M effective——
比整場 warm 讀取的一半還多。已知的 miss 觸發源（**MUST** 全部避免）：

- session 中途切 `/model`、`/effort`、首次開 fast mode
- MCP server 增減、連線斷掉
- 休息超過 cache TTL（訂閱 1h；吃 usage credits 時降到 5m）後才續跑
- Claude Code 升級後 `--resume` 舊 session

**推論：session 開頭定好 model 與 effort，中途 NEVER 切。** 一次切換的代價比省下的多得多。

**讀取量 ≠ 成本**：**NEVER** 拿讀取量佔比論證「長 session 很貴」——它論證的是「長 session 讀很多」，
兩者差一個數量級的權重。長 session 真正的代價在**品質**（context rot）與 **cache miss 風險敞口**。
公式、`Cost ≈ 0.1 × (N × C / 2) + 2C` 的代入、舊模型為何高估 5–10 倍、量測出處與 cache 權重的
查證邊界，全文見 rationale § 成本模型的量測依據。

### 收工前的自我開脫（看到自己這樣說就停下登記）

| 開脫 | 實際 |
| --- | --- |
| 「context 還夠，沒有觸發壓縮」 | 沒觸發壓縮不代表便宜。613k 的 session 每跑 100 turn 就是額外 61M token，壓縮與否無關 |
| 「只差最後一步了」 | 1,463 turn 的那個 session 每一輪都是這樣想的 |
| 「切了要重建 context，反而更貴」 | 重建成本是**一次**冷載；續跑成本是 context 大小 **× 剩餘 turn 數**。除非剩不到幾輪，續跑必然更貴 |
| 「這件事登記起來比做完還久」 | 那就是可以現在做完的小事，做完再切——本表擋的是「登記得起來卻不登記」 |
| 「下個 session 還要重新理解一次」 | 那是 `tasks/<date>-<slug>.md` 沒寫夠，不是切點錯。補齊該檔就是收工動作本身 |

### 收工訊息契約（MUST，每一次收工都適用）

**登記完整 ≠ 交接完整。** 前者是檔案狀態；後者是接手 session 已取得工作與責任。只報「已登記」或「接手 pane 正在 working」卻不說原 session 是否停止，責任邊界就是模糊的，同時把「開新 session ＋ 跟它解釋要做什麼」這筆成本靜默轉嫁給 user。本節管的是訊息**形狀**，不是收不收工（那由上表判）。

**寫收工訊息之前先判：這次真的需要重開嗎？**

| 可觀察 predicate | 動作 |
| --- | --- |
| 還在**同一個**任務裡（只是做久了、或跨了 phase 斷點） | **`/compact` 續同一個 session。NEVER 收工開新 session。** warm 時 compact 讀舊 prefix 走 cache，官方文檔逐字：`costs a fraction of what the context size suggests`；而且 user 零重述 |
| 換 repo / 換不相關主題 / 已登記的中大型工作確實需要乾淨 session | invoke `/handoff relay <task pointer>`（N 件可平行則 `/handoff fanout`），由主線依下一節自行完成 Herdr transport，收工訊息走下面的 **A** |
| 這批工作真的結束、沒有未完項 | 直接收工走下面的 **B**，**NEVER** 建立空的接手 session |
| 剩餘工作可無人值守跑完 | 主線直接啟動該 repo 的 runner，**優先於**開新 session；回報 runner receipt，不把指令交給 user |

第 2 列的「換不相關主題」**每一次**都跑這三條，**三條全中才算不相關**：(1) thin brief 只引 durable 檔就寫得完，不需引「只存在於本對話」的結論；(2) 不共享當前任務**未 commit** 的 working tree 狀態；(3) 已有、或當場先登一條屬於它自己的 durable 條目。**任一條不中＝仍是同一任務，走第 1 列 `/compact`。**

**NEVER 把「context 大了」直接讀成「該收工開新 session」。** 判定走上面三條，
**context 大小本身不是其中任何一條**。

#### Worktree lifecycle close gate（A／B 共用）

**每一次**收工訊息都 MUST 帶 `Worktree lifecycle` receipt；目前 cwd 是 linked worktree 時，結果只有 `removed` 或 `retained: <owner + next landing event>` 才能宣稱 closure。先實跑並列出 `path`、`branch`、`dirty`、`merged_to_main`、`locked`；不在 linked worktree 才寫 `not-applicable`。

| 可觀察狀態 | 動作 |
| --- | --- |
| workflow明定 worktree要 parked | `retained`，指名 owner與 next landing event |
| clean + fully merged + 無 unique commit／WIP + 無 parking contract，且已有該 worktree的明確 remove授權 | 實際移除 worktree與branch，receipt寫 `removed` |
| 同上但沒有明確 remove授權 | 先用 `AskUserQuestion`問 `remove`／`retain`；回答前**不得**輸出「目前這裡收工」或等價完整 closure |
| dirty、未 fully merged、ownership不明 | fail closed列 blocker；**NEVER**用 `--force`把不確定性刪掉 |

Herdr／subagent receipt中的 `retained:false`只描述該 child runtime，**NEVER**拿它代替 parent cwd的 Worktree lifecycle receipt。

#### A. 已交出 pane（`relay` / `fanout` / `next` 派工後）

成功事件是 helper 回傳 **`relay_dispatched`**：successor 已 live、已收到 brief、durable 轉移已落盤。
**不是**「successor 完成了工作」——那不再是本 session 的事。`fanout` 另外要求 `relayed_dispatch_ids`
與派出去的 worker **逐筆比對通過**（少一筆＝那筆已成 orphan，**NEVER** 收工）。

收工訊息依固定順序：

| 部件 | 契約 |
| --- | --- |
| 首行 | 逐字包含：`目前這裡收工；位置已交給 successor。` |
| Relay receipt | successor workspace／tab／pane／Claude session、本 pane id、`predecessor_dispatch_id`、`relayed_dispatch_ids`（沒有就明寫「無」） |
| Worker receipt | **只有 `fanout`**：逐筆列 dispatch_id、label、pane、在做什麼 |
| 工作摘要 | durable brief 路徑與一句主題 |
| Runtime cleanup | 已停止的不必要 background／agent／shell；仍保留者逐一列用途與對應 pane |
| Worktree lifecycle | `not-applicable`，或五欄實測 + `removed`／`retained: <owner + next landing event>` |
| user 本人要做的事 | 只列 successor 無法代做者；沒有就省略 |

`relay_refused`／`transport_error`／任何 preflight failure 都保留 pane，**NEVER** 輸出「目前這裡收工」。
receipt 送出後，本 session **NEVER** 再開新工作段、輪詢接手 pane 或等它回應；下一個動作只能是結束回合。

#### B. 沒有 Herdr live transfer

| 部件 | 契約 |
| --- | --- |
| 首行 | 收工判定 ＋ 觸發的門檻。一句 |
| 落點 | 未完項登記在哪：`<檔路徑>` ＋ 條目。**NEVER** 只寫「已記全」——那是**你**知道的事實，不是 user 拿得到的東西 |
| **續跑 receipt** | runner path 回 process / log receipt；transport 失敗時回具體 blocker（per 下一節第 3 列）。**NEVER** 把它降級成叫 user 自己 `cd` / 開 session / 貼 prompt 的 oneliner |
| Worktree lifecycle | `not-applicable`，或五欄實測 + `removed`／`retained: <owner + next landing event>` |
| user 本人要做的事 | 只列 user 非做不可的（回答問題、permission、credentials、GUI / 產品決策），逐條一句。沒有就整段不出現 |

**逐字實錄反制**：「已將下一步派到乾淨 session 執行」＋ receipt，但沒寫「目前這裡收工」——那不是完整交接訊息，讀者無法判斷原 session 是否仍在工作。

### Herdr session transport（每一個符合的 handoff 都 MUST）

**每一個**原本會要求 user 切換資料夾、開另一個 Claude Code session、再貼 prompt 或指令的 handoff，
都由主線自行走 Herdr transport；本節是使用者對這項 transport 的 standing explicit authorization，不必逐次再問。

先判邊界：當前 session 能在既有授權與 scope 內直接對目標 cwd 執行，就直接執行；只有既有 routing、
session boundary 或跨 repo 決策已判定確實需要另一個互動 session，才建立 Herdr pane。Herdr 只搬運 session，
**不**新增外派理由、跨界授權、worktree 例外或 approval bypass。

**`attended` 的要求是「過人眼」，NEVER 讀成「必須在當前這個對話裡做」。** 派出去的是**互動式** session，
user 看得到那個 pane，接手 agent 可以用 `AskUserQuestion` 讓 user 在那個 pane 裡逐批拍板。需要拍板
**不構成**不派的理由，只構成 brief 裡要寫明「你是互動式 session，需要拍板的直接問 user」。逐字反開脫：
「這項要 attended，所以不能派」「要 user 逐批拍板，留在本 session 比較快」。本段適用**每一項**判為需要
人拍板的殘工，不是只有其中比較單純的那幾項。

### 派幾個 pane —— 先判這一題

**四個 arg 全部收工**，差別只在開幾個 pane：

| 可觀察 predicate | arg | 開出去的是 |
| --- | --- | --- |
| 沒有要派的工作，只需登記未完項 | `/handoff park` | 0 個 pane |
| 1 件工作，或多件但彼此 **serial**（動同一批檔／有 phase 依賴／共享 mutex 資源） | `/handoff relay` | 1 個 successor，繼承整個位置 |
| N ≥ 2 件工作，四條 parallel rubric **全成立**（檔案不重疊、無 phase 依賴、無共享 mutex、可獨立驗證） | `/handoff fanout` | N 個 worker + 1 個 successor 繼承它們 |
| 還不知道有幾件——要先跑 health gate／worktree／TD hygiene 盤點 | `/handoff next` | 盤點後落到上面三者之一 |

**NEVER 因為「一件一個 pane 比較整齊」把 serial 工作拆成 N 個 worker**——它們會同時改同一批檔。
**NEVER 因為「合成一份 brief 比較省事」把 N 件真正獨立的工作塞給單一 successor 依序做**——那放棄了
平行性，而 fanout 的成本只是多一個 pane。

**任何一個 arg 都不要求本 session 留下來盯著。** 交出去之後本 session 的下一個動作只能是結束回合：
**NEVER** 續推 brief 裡的工作、**NEVER** 輪詢接手 pane、**NEVER** 讀它的 lifecycle 猜進度、
**NEVER** 向它追問或等它回應。逐字反開脫：「反正還沒關掉，順手做完」「等它讀完 brief 我再確認一下」。

**本段適用每一次 handoff 判定，不是只有其中看起來比較大的那幾次。**

命中時 **MUST** invoke `herdr` skill 並先讀 `herdr-session-handoff/README.md`；每一個
`/handoff relay`／`/handoff fanout` 都只走 `vendor/scripts/herdr-session-handoff.ts` 的 canonical
helper（`relay` 用 `--relay`；`fanout` 先對每件工作跑一次裸 dispatch，**全部派完**才跑 `--relay`），
由 helper 統一 provision、fresh Claude session identity、prompt delivery、in-flight dispatch 的
coordinator 身分轉移，以及寫出讓 successor 回收本 pane 的 predecessor record。

**`fanout` 的順序是硬約束**：`--relay` 轉移的是它**執行那一刻**掃到的 in-flight dispatch。relay 之後
才派的 worker 不會被任何人繼承，而本 pane 隨即被 successor 回收——那筆 worker 直接變成 orphan。
**NEVER** 邊派邊 relay，**NEVER** relay 之後補派。漏掉的要補，只有一條路：由 successor 去派。

**`fanout` 只有 main line session 能用。** 本 session 自己是被派出來的 child（`CLADE_DISPATCH_ID`
非空）時，裸 dispatch 一律被 helper 回 `nested_dispatch_refused`——那道 guard 防的是責任樹擴張。
改走 `relay`（helper 對 relay 開了缺口，因為它做的是相反的事：橫向移交後自己站下來）。**NEVER**
為了讓 fanout 在 child 內跑起來去取 `--recovery-token`：orphan recovery 的前提是 parent 已死，
拿它繞過一道針對「parent 還活著」設計的 guard 是偽造前提。

每一個被派出去的 **worker** 都 **MUST** 在正常 final response 前透過 helper 回報與 dispatch／pane／
Claude session identity 相關聯的 `success | blocked | failed | unknown` outcome；`blocked` 必須帶一個
具體 user decision。**NEVER** 把 secret 寫進 Herdr argv、prompt metadata、receipt、summary、decision、
log、rule 或 fixture。

### successor 怎麼收割它繼承的 worker

那份 outcome 由 successor 收割，helper 注入的 relay protocol 會告訴它用 `--coordinate-resume <dispatch-id>`
續接。**收割的判準是 correlated business outcome，不是 pane 的 lifecycle**：`prompt 已送出`、
`status: dispatched`，或 lifecycle只有 `idle`／`done`，都**不是** business completion。逐字反開脫：
「pane 已經 done 了，應該是做完了」——Herdr 的 `done` 是「未被看見的背景工作結束後的 idle」，
agent 回完一個 turn 後照樣繼續工作。

正常 success 或 successor closure 由收割者當下收斂，**NEVER** 等 user另輸入 `\nx`才 harvest或reclaim。

收割到的 `completion_success` 若帶 **非空 `followup_brief`**，那是 worker 留下、**還沒有人接**的工作：
收割者 MUST 自己派下一跳，分流與兩條 NEVER 見 `handoff` skill 的 `dispatch-common.md` § 6。

**worker 的 parent 死掉時**（successor 自己也消失了），該 worker 成為 orphan：只有該 durable dispatch
的 exact child 可經 canonical `--recover-orphan` one-way claim 建立唯一 fresh successor。可觀察判準是
durable record 的 exact `parent_claude_session_id` 在 `herdr agent list` 全域缺席——
prompt-cache TTL與record年齡對ownership零訊號。一般 coordinated child仍禁止nested handoff，**只有**helper核准的 recovery token與 attested relay例外。

**每一次** transport **MUST** 帶任務描述性 `--label`：**split／tab／workspace 三種 topology 都命名 pane**，
建 Tab／workspace 時額外命名該 Tab／workspace。**NEVER** 只給 repo 名或倚賴預設值——同一 repo 派出去的多個 session 會在 UI
與 patrol 輸出裡完全無法分辨，而 `fanout` 一次就派 N 個，這件事在 fanout 下不是不便而是致命。helper
缺 label 直接回 `usage_error`，不會建立任何東西。receipt 的 `pane_label_applied` 為 `false` **或欄位不存在**，
兩者是同一格：都代表 pane 可能仍是預設標題，**MUST** 照實寫進收工訊息並當場補
`herdr pane rename <pane-id> "[<pane-id>] <label>"`。**NEVER** 把欄位缺席讀成「這條路徑不適用」——
缺席正是這條契約實測唯一遇過的失敗形狀（58 筆 record：`false` 0 次、缺席 48 次）。斷言 **MUST** 寫成
「欄位存在且為 `true`」，**NEVER** 寫成 `!== false`。

**命名對了不代表放對地方——落點是另一條獨立契約。** dispatch 出去的 pane **MUST** 落在**目標 cwd
所屬的 workspace**，不是呼叫者當下所在的 workspace。預設 `mode: "split"` 分割的是**呼叫者的 pane**，
與目標 cwd 無關；helper 自 2026-08-13 起在 split 前比對，目標 cwd 明確屬於別的 workspace 時自動退回
Tab／workspace topology。**判 receipt 時 MUST 讀 `pane_id` 的 workspace 前綴**（`wE:pG` 的 workspace
是 `wE`），**NEVER** 只看 label 就認定放對了——2026-08-13 實測：一個 `<consumer-a>` session dispatch
出去的 clade publish，label 完全正確，pane 卻落在 `<consumer-a>` workspace。**label 對這件事零訊號。**

Canonical clade publish **MUST** 走 `node <clade-central-repo>/vendor/scripts/herdr-clade-publish.ts`（無參數）。
**NEVER** 用 caller-controlled generic `--cwd`／`--prompt` 或 raw `herdr agent prompt` 替代；只搬 intent，
Step 1–9 屬 `clade-publish` skill。

| 結果 | 主線動作 |
| --- | --- |
| `status: relay_dispatched` | （`fanout` 先過 `relayed_dispatch_ids` 逐筆比對）依收工訊息契約 **A** 結束回合 |
| `status: dispatched`（fanout 的 worker） | 記下 `dispatch_id` 與 `pane_id`，繼續派下一筆；**全部派完才跑 `--relay`** |
| `status: relay_refused` | 保留 durable task 與**所有已派出的 pane**，回具體 blocker 並列出那些 dispatch_id。**NEVER** 改用 raw `herdr` 繞過、**NEVER** 收工 |
| `status: nested_dispatch_refused` | 本 session 是 coordinated child，fanout 不適用。改走 `relay` |
| transport / launcher / Herdr preflight 失敗 | 保留 durable task；能在本 session 合法完成就直接完成，否則回具體 blocker。**NEVER** 退回要求 user 手動 `cd`、開 session 或貼 prompt |

#### 已列明 gate 的短答（MUST）

目前 gate 的 scope、targets 與動作已清楚列明後，user 回 `允許`、`可以`、`\sg` 或其他無歧義等價短答，**即完成那一個 gate**。**NEVER** 要求 user 複製、重述或重新貼完整 scope／授權句；下一個不同 gate 仍照常詢問。

跨 session transport 需要 durable evidence 時，只記 compact receipt（gate 名稱或 scope 指標 + user 短答 + 已列明 targets）。Receipt 只證明該 gate 已完成，**不**新增權限或擴張 scope。

permission classifier／harness 拒絕某載體時，**NEVER** 改用其他工具暗渡同一動作；目前 session 能在既有授權與 scope 內合法執行就直接執行，否則回具體 blocker。

`\nx`（Charles 個人縮寫，判為收工時）同樣受本契約約束：「收工 ＋ 一句已登記在哪」只是下限；
判需要乾淨 session 時同樣 invoke `/handoff relay <task pointer>`（N 件可平行則 `/handoff fanout`），取得 receipt 後套用 **A**、不套用 B。

## 並行爭用：檔案層之後 MUST 再問 session 層

**Iron Law：檔案層回答「有沒有人在寫」，回答不了「對方會不會自己停」——而動作完全由後者決定。探測停在檔案層就 escalate，是規約違反，不是謹慎。違反字面就是違反精神。**

`git status` dirty、mtime 在數十秒內、`.clade/claims/` 有沒有活 claim——這些觀測值在**人類正在編輯**、**前景 agent session**、**背景 unattended runner** 三種情況下**完全相同**。檔案層跑得再完整都停在同一個岔路口；判不出來**不是**「該 user 拍板」的訊號，是還有一層沒探。

### Step 0（三步，順序不可調換）

**每一次**檔案層探測回報「有另一個 actor 正在寫」都 MUST 跑完這三步再決定動作——不是只有 publish 被擋那次，ad-hoc commit、worktree merge-back、stash 判定、gate 撞紅同樣適用。

```bash
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

**`agent_status: idle` NEVER 等於「對方收手了」。** 它只表示那個 pane 的互動 agent 正在等輸入，對「它掛的背景 process 停了沒」零訊號——2026-08-19 那個 pane 就是 `idle`，背後的 runner 還有 19 輪要跑。**判出 idle 之後 MUST 再跑第 3 步**，不得因為「看起來已經停了」跳過。

第 3 步 **MUST 用 `work-loop/[r]unner\.sh` 這個 pattern**，**NEVER** 用 `runner.sh` / `work-loop` / `--unattended` 這類寬 pattern：2026-08-20 於 `~/offline/clade` 實跑 `pgrep -af "work-loop|runner.sh|--unattended"` 回 9 筆，**全是 false positive**（8 筆 `vendor/scripts/pre-push/runner.sh` git hook ＋ pgrep 自己的 shell），真正的 runner 0 筆。方括號防自我匹配：自己的 command line 含字面 `[r]unner`，不匹配 regex `[r]unner`。

### 三種對方性質 → 動作（判出哪一種就直接執行）

| 對方是 | 可觀察判準 | 動作 |
| --- | --- | --- |
| **unattended runner** | 第 3 步 `pgrep` 命中，或 pane 輸出含 `--unattended` / `--runner-child` / `max-rounds` | **什麼都不做，不搶。** 它有自己的 commit + publish 循環，dirty 是它當輪的中間狀態。**NEVER** stash（腰斬它當輪產出）、**NEVER** 代 commit、**NEVER** 搶 publish；本輪的 publish 需求登記後讓位 |
| **前景 agent session** | 第 1 步命中 pane 且 `agent_status` 隨時間變動、第 3 步無命中 | `SendMessage` ／ `herdr agent prompt` 主動協調（請它先 commit、或告知你要 publish）。對方寫入在數十秒內且看得出正要落地 → **等它落地**，等待本身就是動作 |
| **人類正在編輯** | 第 1、3 步都無命中，但檔案 mtime 持續更新 | 代為分組 commit（`git commit --only -- <paths>`）；半成品訊號命中才 stash |

判出是哪一種之後就**自己執行對應動作**，**NEVER** 把已經判得出來的並行爭用用 `AskUserQuestion` 退回給 user。

**「等」是上表三個動作之一，NEVER 是「判不出來」的同義詞。** 2026-08-20 於 `~/offline/clade` 實測：merge-back dry-run 報 `docs/tech-debt.md` dirty，第 1 步命中一個前景 session、`git diff` 是別人 16 秒前新增的 TD entry 且缺 `## Restart brief`（半成品訊號命中）——正解是**等它自己 land**（實測 10 秒），代 commit 會把半成品寫進 history、stash 會奪走它正在寫的檔。寫「等」時 **MUST 指名等到哪一個可觀察事件**，**NEVER** 只寫「等對方收手」。

### 非 Herdr 環境的 graceful degrade

`test "${HERDR_ENV:-}" = 1` 失敗時第 1、2 步不可用，**第 3 步照跑**（`pgrep` 不依賴 Herdr），再回退到檔案層 ＋ `.clade/claims/` 的 `last_heartbeat`。**降級掉的是「對方是誰」，NEVER 是「所以可以 escalate 了」**——降級後仍 MUST 自己選出上表三個動作之一；判不出對方性質時取最保守的那個：**什麼都不做**。

### 逐字反開脫

| 開脫 | 實際 |
| --- | --- |
| 「探測都跑完了還是判不出來，這題該 user 拍板」 | 跑完的是檔案層。Step 0 三步跑完了嗎？沒跑完就不叫探測完 |
| 「pane 顯示 idle，對方應該收手了」 | `idle` 只描述互動 agent。2026-08-19 那個 idle pane 背後的 runner 還有 19 輪 |
| 「先 stash 起來比較安全，之後再還原」 | 對 unattended runner 是腰斬當輪產出，對前景 session 是奪走它正在寫的檔。stash 只在「對方是人且已停手」時安全 |
| 「我 SendMessage 問它一下就好」（對方是 runner 時） | runner child 是 `claude --print`，沒有 pane 也不讀訊息；那個 idle pane 收到訊息不會轉達給背景 process |
| 「等對方收手就好」 | 對 unattended runner 是等數小時。「等」MUST 綁一個可觀察事件才算動作 |

**Red Flags（發現自己在寫這幾句就停下來跑 Step 0）**：正要列出「等對方收手／stash 強推／我去問那個 session」這組選項；正要用 `AskUserQuestion` 問並行爭用怎麼辦；正要在「對方是誰」還是未知數的狀態下往下決策。

**爭用訊號帶得出 pid 時（advisory lock、process 訊息）走 pid，NEVER 退回 cwd 過濾**：第 1 步的 cwd 前綴在同一 repo 同時有多個 pane 時過濾不出唯一解，而 pid 經 `ps` 祖先鏈直達 `claude … --session-id`，是精確對映。做法與「持有者正在跑同一條冪等流程時搭它的車」見 [[pitfall-pipeline-lock-contention-raced-instead-of-probed]]。

可貼的探測序列（兩個入口、身分兩條、`rg -L | xargs` 回 0 的坑）在 [[concurrent-session-probe]]（`vendor/snippets/concurrent-session-probe/`）——**撞上爭用時 MUST 開它照貼，NEVER 現場重拼指令**。

> 第一手實錄：[[pitfall-working-tree-contention-escalated-without-session-layer-probe]]（2026-08-19 <consumer-a>，連問三輪、選項 3/3 錯，user 一句「你去檢查 pane」終結）。同型換 domain：[[pitfall-infra-change-attribution-skips-concurrent-session-check]]。
