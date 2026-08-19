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

1. **先把殘工派出去**（transport 走 § Herdr session transport）。**預設走 `/handoff relay` 一次交出整個位置**——把所有殘工寫進同一份 brief 交給 successor，由它以 fresh context 續判要不要再細分。只有當殘工是**單一一項**、且本 session 確實還付得起「留下來持有 handshake 到 terminal receipt」的成本時，才走 `/handoff now`（判準見 § `now`（delegate）還是 `relay`（succession））
2. 剩下**派不出去**的才寫進 `tasks/<date>-<slug>.md`（或 `HANDOFF.md` / `docs/tech-debt.md`），且**逐條寫明它派不出去的具體外部條件**
3. 收工，收工訊息走 § 收工訊息契約

本三步適用**每一個**越過 500k 的 session、**所有** consumer，且**每一項**殘工都要各自過第 1 步——
不是「挑一項派掉、其餘登記」。

**NEVER 把第 2 步當成第 1 步的替代品。** 逐字反開脫：「已經寫進交接檔了」「未完項都登記好了，
留給下一個 session」「下個 session 接手時看得到」——這幾句描述的是第 2 步做完，對第 1 步零訊號。

**context 越滿，dispatch 的相對價值越高**：那些 token 每一個 turn 都重讀一次。500k 那一級是**最該派**
的時刻，**NEVER** 讀成「已經沒有餘裕再派了」。

**但 500k 也正是 `now` 付不起的時刻**——它要求本 session 留下來反覆前景 `--coordinate-resume` 直到
terminal receipt，而收工三步的前提就是本 session 要收工了。**NEVER** 在 500k 用 `now` 派完就宣稱收工：
那會留下一個沒有人持有的 handshake，child 的 outcome 寫進 durable record 後沒有任何東西會把它收割
（實測形狀：15 筆 dispatch record 掛 118–169 小時從無 completion）。要交出去就用 `relay` 連 coordinator
身分一起交，要留下來驗收就別宣稱收工，**NEVER** 兩者都要。

「派不出去」**MUST 講得出具體外部條件**，只有兩類算數：

| 可觀察 predicate | 例（2026-08-13 實錄） |
| --- | --- |
| 等一個具體外部 signal | 目標目錄是**別 session 進行中**的封存產出，含 HEAD 沒有的檔，現在動就是永久遺失 |
| 被別 session 的未 commit 檔擋住 | pre-push ratchet 對別 session 兩個未 commit `.vue` 掃出 baseline 超標，且不在本次授權 scope |

「需要人判斷」「要謹慎」「這個比較複雜」「要 attended」**都不是**外部條件。講不出具體外部條件
＝ 派得出去。

### 成本模型（2026-08-07 納入 prompt caching 修正）

本節 2026-08-07 前寫著 `Cost ≈ N × C / 2`（N=turns、C=最終 context），假設**每個 turn 全額重讀
整個 context**。**那個假設在 cache 命中時是錯的，高估約 5–10 倍**：訂閱方案自動用 1 小時 TTL，
cache read 只計 **0.1×**、write 計 2×。

```
Cost ≈ 0.1 × (N × C / 2) + 2C          # warm cache，訂閱 1h TTL
每次 cache miss 額外 ≈ +3C              # 全額重讀 1× + 重寫 2×
```

代入 C=300k / N=50：修正後 ≈ 1.35M effective，舊模型估 7.5M。

**真正的成本殺手不是長 session，是 cache miss。** 單次 miss 在 300k context ≈ +0.9M effective——
比整場 warm 讀取的一半還多。已知的 miss 觸發源（**MUST** 全部避免）：

- session 中途切 `/model`、`/effort`、首次開 fast mode
- MCP server 增減、連線斷掉
- 休息超過 cache TTL（訂閱 1h；吃 usage credits 時降到 5m）後才續跑
- Claude Code 升級後 `--resume` 舊 session

**推論：session 開頭定好 model 與 effort，中途 NEVER 切。** 一次切換的代價比省下的多得多。

**讀取量 ≠ 成本**：長 session 佔掉的 context 讀取量大部分是 0.1× 權重的 cache read。
**NEVER** 拿讀取量佔比論證「長 session 很貴」——它論證的是「長 session 讀很多」，兩者差一個
數量級的權重。長 session 真正的代價在**品質**（context rot）與 **cache miss 風險敞口**。
量測出處、baseline 檔與 cache 權重的查證邊界見 rationale § 成本模型的量測依據。

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
| 換 repo / 換不相關主題 / 已登記的中大型工作確實需要乾淨 session | invoke `/handoff now <task pointer>`，由主線依下一節自行完成 Herdr live transfer，收工訊息走下面的 **A** |
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

#### A. 已完成 Herdr live transfer

`/handoff now`只有在 canonical coordinator回傳下列任一 closure時才算「交接完成」：

1. correlated `business_outcome: success`，且原 pane已 settled、scrollback已 archive、pane已 verified reclaim；或
2. 已驗證另一個不同的 canonical successor pane／Claude session仍 live並接手責任，且原 pane完成同樣 archive + reclaim。

prompt已送出、`status: dispatched`、接手 pane可獨立續跑，或 lifecycle只有 `idle`／`done`，都**不是** business completion。收工訊息依固定順序：

| 部件 | 契約 |
| --- | --- |
| 首行 | 逐字包含：`目前這裡收工` |
| Closure receipt | business outcome、workspace、tab、原 pane、label、Claude session、dispatch、status、scrollback log、reclaimed狀態；responsibility transfer另列 successor pane |
| 工作摘要 | coordinator回傳的 summary與 durable brief路徑 |
| Runtime cleanup | 已停止的不必要 background／agent／shell；仍保留者逐一列用途與 successor pane |
| Worktree lifecycle | `not-applicable`，或五欄實測 + `removed`／`retained: <owner + next landing event>` |
| user 本人要做的事 | 只列 successor session無法代做者；沒有就省略 |

`completion_blocked`／`completion_failed`／`completion_unknown`都保留 pane，**NEVER** 輸出「目前這裡收工」。只有前述兩種 closure的 receipt送出後，原 session才 **NEVER** 再開新工作、輪詢接手 pane或等待其完成；下一個動作只能結束回合。正常 success／successor closure由 coordinator當下收斂，**NEVER** 等 user另輸入 `\nx`才 harvest或reclaim。

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
session boundary 或跨 repo 決策已判定確實需要另一個互動 session，才建立 Herdr Tab。Herdr 只搬運 session，
**不**新增外派理由、跨界授權、worktree 例外或 approval bypass。

**`attended` 的要求是「過人眼」，NEVER 讀成「必須在當前這個對話裡做」。** `/handoff now` 開的是
**互動式** session，user 看得到那個 pane，接手 agent 可以用 `AskUserQuestion` 讓 user 在那個 pane
裡逐批拍板。需要拍板**不構成**不派的理由，只構成 brief 裡要寫明「你是互動式 session，需要拍板的
直接問 user」。逐字反開脫：「這項要 attended，所以不能派」「要 user 逐批拍板，留在本 session 比較快」。
本段適用**每一項**判為需要人拍板的殘工，不是只有其中比較單純的那幾項。

### `now`（delegate）還是 `relay`（succession）—— 先判這一題

兩條 path 交出去的東西不同，判準是**交出去之後本 session 還有沒有下一步**：

| 可觀察 predicate | path | 交出去的是 |
| --- | --- | --- |
| 交出去之後本 session 仍要驗收 outcome、把 blocked decision 端給 user、或繼續推別的工作 | `/handoff now` | **一件工作**。本 session 仍是責任持有者，MUST 持有 handshake 到 terminal receipt |
| 交出去之後本 session 沒有下一步了——context 撐不住、或這份工作就是它剩下的全部 | `/handoff relay` | **一個位置**。successor 繼承 brief ＋ 所有 in-flight dispatch 的 coordinator 身分，本 session 隨即收工 |

**context 吃緊時 MUST 走 `relay`，NEVER 走 `now`。** `now` 要求 coordinator 反覆前景 `--coordinate-resume` 直到 terminal receipt，而那正是 context 吃緊時付不起的成本——用 `now` 交出工作再留下來燒 context，手段否定了目的。逐字反開脫：「先 `now` 派出去，撐不住再說」「反正它應該很快就回來」「我等一下自己就收工了，用哪條都一樣」。

**relay 之後 NEVER 再開任何新工作段。** 位置已經交出去了：本 session 唯一剩下的動作是回報 relay receipt 然後結束回合，**NEVER** 續推 brief 裡的工作、**NEVER** 輪詢 successor、**NEVER** 等它回應。successor 讀完 brief 後會回收本 pane。

**本段適用每一次 handoff 判定，不是只有其中看起來比較大的那幾次。**

命中時 **MUST** invoke `herdr` skill並先讀 `herdr-session-handoff/README.md`；每一個 `/handoff now`／`/handoff relay` 都只走 `vendor/scripts/herdr-session-handoff.ts` 的 canonical helper（`now` 用 `--coordinate`、`relay` 用 `--relay`），由 helper統一 provision、fresh Claude session identity、prompt delivery、bounded wait、business outcome harvest與 verified reclaim。coordinator 每次只執行 bounded foreground slice，**NEVER** 使用 `run_in_background=true`。slice 到期且exact child仍在工作、沒有correlated completion時回 `coordination_pending`：它是**非終局 receipt**，保留pane與durable record，pending不得archive或reclaim，也不進下段terminal receipt查證；exact parent Claude session仍 live時只能用 canonical `--coordinate-resume <dispatch-id>`重驗ownership與exact session後續接下一個前景slice，session移到別pane仍由helper解析，原pane換成別session不得resume。**coordinator 尚未返回前**，原 Claude session只等待 helper的單一結構化結果，**NEVER** 自行輪詢接手 pane、從 lifecycle猜 outcome或向接手 session追問進度。

**拿到 `coordination_pending` 而本回合要結束時，MUST 在結束前 arm 一個 keepalive wakeup 續跑 `--coordinate-resume <dispatch-id>`**（形狀依 [[agent-routing]] § Generic async keepalive prompt）。逐字反開脫：「不阻塞、等通知回來再收」「我不打算輪詢」「等 coordinator」——child 的 outcome 只寫進 durable record，**沒有任何東西會替你把 turn 叫回來**；helper 在 child 回報時會 best-effort push 叫醒 parent pane，但 parent pane 換了 session 或已消失就 skip，**NEVER** 拿它當 arm keepalive 的替代。兜底自查：任何 session 都可跑 `node vendor/scripts/herdr-patrol.ts --stalled`，逐列印出已回報卻沒人收割的 dispatch 與該跑的指令（有停滯 exit 3）；exact parent session全域缺席標 `orphan-recoverable`，只有該 durable dispatch的exact child可由 `/handoff now`走 `--recover-orphan` one-way claim建立唯一fresh successor。Parent exact session仍 live、identity缺失／重複／snapshot不可驗時都不得recovery；prompt-cache TTL與record年齡對ownership零訊號。一般 coordinated child仍禁止nested handoff，**只有**helper核准的 recovery token與 attested relay例外。

**terminal receipt 返回後這條即失效，查證改為 MUST。** 非 success terminal receipt（`completion_blocked` / `completion_failed` / `completion_unknown`）返回時，在寫下**任何**關於接手 session 做了什麼的斷言之前、以及做**任何**補救動作之前，MUST 先讀該 pane 的 `agent_status` 與 scrollback（`herdr pane list` / `herdr pane read`）。receipt 的 `agent settled without a valid correlated business outcome` 只斷言 **helper 沒收到 outcome**，對「它現在在不在工作」零訊號——Herdr 的 `done` 是「未被看見的背景工作結束後的 idle」，agent 回完一個 turn 後照樣繼續工作。**NEVER** 用「目標檔 mtime 沒變 / `git status` 乾淨 / 無新 commit」推論它沒做事（那是 negative search 當證據）；**NEVER** 未查證就重送同一份 brief（接手 session 仍在工作時重送 ＝ 兩個 agent 同時改同一批檔）。查證後 `agent_status` 是 `working` → 它還在做，**NEVER** 重送或打斷；receipt 無 `pane_id`（pane 建立前就失敗）→ 本條不適用，直接回具體 error。非 success receipt 返回時 **MUST 讀** handoff skill `now-steps.md` § 4.1 的查證程序與四路分流。

每一個 canonical接手 session都 **MUST** 在正常 final response前透過 helper回報與 dispatch／pane／Claude session identity相關聯的 `success | blocked | failed | unknown` outcome；`blocked`必須帶一個具體 user decision。**NEVER** 把 secret寫進 Herdr argv、prompt metadata、receipt、summary、decision、log、rule或fixture。

**每一次** transport **MUST** 帶任務描述性 `--label`：建 Tab／workspace 就命名該 Tab／workspace，split pane 就命名該 pane；建立什麼就命名什麼。**NEVER** 只給 repo 名或倚賴預設值——同一 repo 派出去的多個 session 會在 UI 與 patrol 輸出裡完全無法分辨。helper 缺 label 直接回 `usage_error`，不會建立任何東西。receipt 的 `pane_label_applied: false` 代表 pane 仍是預設標題，**MUST** 照實寫進收工訊息。

**命名對了不代表放對地方——落點是另一條獨立契約。** dispatch 出去的 pane **MUST** 落在**目標 cwd 所屬的 workspace**，不是呼叫者當下所在的 workspace。預設 `mode: "split"` 分割的是**呼叫者的 pane**，與目標 cwd 無關；helper 自 2026-08-13 起在 split 前比對，目標 cwd 明確屬於別的 workspace 時自動退回 Tab／workspace topology（該路徑本來就 canonicalize cwd）。

**判 receipt 時 MUST 讀 `pane_id` 的 workspace 前綴**（`wE:pG` 的 workspace 是 `wE`），**NEVER** 只看 label 就認定放對了——2026-08-13 實測：一個 `<consumer-a>` session dispatch 出去的 clade publish，label 是完全正確的 `[wE:pG] 發布 Herdr root fix`，pane 卻落在 **`<consumer-a>`** workspace。兩個方向同時出錯：clade 操作者在 clade workspace 遍尋不著，而它混在 `<consumer-a>` 的 tab 裡又被誤讀成 `<consumer-a>` 的工作。**label 對這件事零訊號。**

Canonical clade publish **MUST** 走 `node <clade-central-repo>/vendor/scripts/herdr-clade-publish.ts`（無參數）。
**NEVER** 用 caller-controlled generic `--cwd`／`--prompt` 或 raw `herdr agent prompt` 替代；只搬 intent，Step 1–9屬 `clade-publish` skill。

| 結果 | 主線動作 |
| --- | --- |
| `status: completion_success` | 驗 business success、settled、archive與 reclaimed receipt後，依收工訊息契約 **A**結束回合 |
| `status: responsibility_transferred` | 驗不同的 live canonical successor及原 pane archive + reclaimed receipt後，依 **A**結束回合 |
| `status: completion_blocked` | **先查證（見上），再**：只有非空 `decision`才向 user問那一個真正決策並保留 pane；回答後走 helper `--continue <pane>`，**NEVER** raw重送 prompt |
| `status: completion_failed` | **先查證（見上），再**回報失敗 gate與 retained pane；立即停止，不宣稱交接完成 |
| `status: completion_unknown` | **先查證（見上），再**回報；outcome缺失／失真、session漂移或只有 lifecycle `done` 都屬此類，fail closed並保留 pane |
| transport / launcher / Herdr preflight 失敗 | 保留 durable task；能在本 session 合法完成就直接完成，否則回具體 blocker。**NEVER** 退回要求 user 手動 `cd`、開 session 或貼 prompt |

#### 已列明 gate 的短答（MUST）

目前 gate 的 scope、targets 與動作已清楚列明後，user 回 `允許`、`可以`、`\sg` 或其他無歧義等價短答，**即完成那一個 gate**。**NEVER** 要求 user 複製、重述或重新貼完整 scope／授權句；下一個不同 gate 仍照常詢問。

跨 session transport 需要 durable evidence 時，只記 compact receipt（gate 名稱或 scope 指標 + user 短答 + 已列明 targets）。Receipt 只證明該 gate 已完成，**不**新增權限或擴張 scope。

permission classifier／harness 拒絕某載體時，**NEVER** 改用其他工具暗渡同一動作；目前 session 能在既有授權與 scope 內合法執行就直接執行，否則回具體 blocker。

`\nx`（Charles 個人縮寫，判為收工時）同樣受本契約約束：「收工 ＋ 一句已登記在哪」只是下限；
判需要乾淨 session 時同樣 invoke `/handoff now <task pointer>`，取得 receipt 後套用 **A**、不套用 B。
