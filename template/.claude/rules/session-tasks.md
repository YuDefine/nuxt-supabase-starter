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

**Iron Law：越過收工線就收工，不是「等這件做完再說」。而收工線是 500k，不是第一次響的那個門檻。**

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

**300k / 500k 是兜底上限，不是切點建議**（Charles 2026-08-06 round 27 拍板；2026-08-07 顧問查證後
維持原值）。它們的正當性**不**來自「官方建議這個數字」——官方不建議任何數字——而來自
「predicate 全沒觸發時仍需要一條 hard stop」。**NEVER** 把這兩個數字讀成「跑到這裡就該切」，
那會讓上表第五列（該續跑的那列）永遠輪不到。

> 2026-08-07 撤回的一個下修提案：曾主張 300k→200k，理由是「避開 auto-compact 在 ~155k 中途觸發
> 炸掉整個 cache」。查證後該理由**整條不成立**——155k 是 200k-window 時代的社群數字，官方
> [context-window § Set the auto-compact window](https://code.claude.com/docs/en/context-window)
> 寫的是預設**到模型 context 上限**才 compact；1M context 模型在 300k–500k 區間碰不到它。
> 且 `/autocompact` 官方範例值本身就是 `500k`。**NEVER** 拿社群單一來源的數字推翻 user 拍板的門檻。

**兩級語義不同，NEVER 當成同一件事的兩個強度**（Charles 2026-08-06 round 27 拍板）：

| 可觀察 predicate | MUST |
| --- | --- |
| session context 越過 **300k** | **NEVER** 開新的**大**工作段（新的 change / 新的多檔重構 / 新的 spectra phase / **invoke 一個本 session 還沒載過的 skill**）；手上這件做完就收。**小 item 照做**——單檔文字修正、補一條 TD、勾一個 checkbox、回答一個問題不受本級限制 |
| session context 越過 **500k** | **現在**登記並收工：未完項寫進 `tasks/<date>-<slug>.md`（或 `HANDOFF.md` / `docs/tech-debt.md`）。手上若是不可分割的驗證迴圈，跑完那一輪就切 |
| 正在跑不可分割的驗證迴圈（單一 test run / 單一 migration） | 跑完再切。**NEVER** 拿「等一下還有事要做」把它延伸成新工作段 |

**NEVER 把 300k 那級讀成「什麼都不能開」。** 本節 round 24 版的第一級是 200k 且綁「**NEVER** 開新的工作段」，而 `/work-loop` 這類 loop 的本質就是一個接一個開新 item——那條對它等於硬停。2026-08-06 round 26 / 27 連續兩輪實證：兩輪都在 ~202k 被腰斬，而當下一輪的工作剛做完、正要開下一輪。**改的不是數字算錯，是那一級的語義訂錯了**；把 300k 讀回「什麼都不能開」等於把這次拍板退回它要修的狀態。

門檻是 `session-context-budget-warn.sh`（PostToolUse hook）機械報出來的，本節是它引用的 SoT：
**300k 響一次、500k 起每 +100k 再響一次**。提示走 exit 2 —— PostToolUse 的 exit 0 stderr
只進 debug log，agent 永遠看不到（2026-08-06 前本 hook 正是 exit 0，所以它上線後量到的
「行為沒有改變」其實是提示從未送達）。

**門檻 NEVER 可由 env / flag 放寬。** 本節 2026-08-06 前寫著 `CLADE_CTX_WARN_TIER1` /
`CLADE_CTX_WARN_TIER2` 兩個覆寫變數，已移除：門檻是判定 agent 行為合不合格的數值，
只有 user 能調鬆（per `agent-routing` 的自主判定紀律）。會想調鬆它的，正是已經超標的那個
session —— 把閂交給它等於沒有閂。

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

2026-08-04 對 8 天用量實測（944 個主線 session 裡 157 個平均 context >200k、吃掉 92% 的
context **讀取量**；重跑 `node scripts/context-cost-report.ts`，baseline 存
`docs/context-cost-baselines.md`）仍然成立，但**讀取量 ≠ 成本**：那 92% 大部分是 0.1×
權重的 cache read。
**NEVER** 拿這個數字論證「長 session 很貴」——它論證的是「長 session 讀很多」，兩者差一個
數量級的權重。長 session 真正的代價在**品質**（context rot）與 **cache miss 風險敞口**，
不在讀取量本身。

> 上面的 0.1× / 2× 對 API 計價查證過（官方 prompt-caching 文檔）；訂閱方案 plan limit 內部
> 是否恰好同權重**未證實**，官方只說「billed at cached rate」且 cached read **仍計入用量**。

### 收工前的自我開脫（看到自己這樣說就停下登記）

| 開脫 | 實際 |
| --- | --- |
| 「context 還夠，沒有觸發壓縮」 | 沒觸發壓縮不代表便宜。613k 的 session 每跑 100 turn 就是額外 61M token，壓縮與否無關 |
| 「只差最後一步了」 | 1,463 turn 的那個 session 每一輪都是這樣想的 |
| 「切了要重建 context，反而更貴」 | 重建成本是**一次**冷載；續跑成本是 context 大小 **× 剩餘 turn 數**。除非剩不到幾輪，續跑必然更貴 |
| 「這件事登記起來比做完還久」 | 那就是可以現在做完的小事，做完再切——本表擋的是「登記得起來卻不登記」 |
| 「下個 session 還要重新理解一次」 | 那是 `tasks/<date>-<slug>.md` 沒寫夠，不是切點錯。補齊該檔就是收工動作本身 |

### 收工訊息契約（MUST，每一次收工都適用）

**登記完整 ≠ 交接完整。** 前者是檔案狀態，後者是「user 下一步要付出多少」——收工訊息只講到前者，
就是把「開新 session ＋ 跟它解釋要做什麼」這筆成本靜默轉嫁給 user。本節管的是訊息**形狀**，
不是收不收工（那由上表判）。

**寫收工訊息之前先判：這次真的需要重開嗎？**

| 可觀察 predicate | 動作 |
| --- | --- |
| 還在**同一個**任務裡（只是做久了、或跨了 phase 斷點） | **`/compact` 續同一個 session。NEVER 收工開新 session。** warm 時 compact 讀舊 prefix 走 cache，官方文檔逐字：`costs a fraction of what the context size suggests`；而且 user 零重述 |
| 換 repo / 換不相關主題 / 這批工作真的結束了 | 才走下面的收工訊息契約 |
| 剩餘工作可無人值守跑完 | 給 runner 指令，**優先於**開新 session——user 完全不必在場 |

**NEVER 把「context 大了」直接讀成「該收工開新 session」。** 那是本節 2026-08-07 前的預設，
它讓 user 為每一次 context 增長付一次重述成本，而多數情況根本不必重開。

收工訊息 **MUST** 由下列部件構成，照這個順序，不多不少：

| 部件 | 契約 |
| --- | --- |
| 首行 | 收工判定 ＋ 觸發的門檻。一句 |
| 落點 | 未完項登記在哪：`<檔路徑>` ＋ 條目。**NEVER** 只寫「已記全」——那是**你**知道的事實，不是 user 拿得到的東西 |
| **續跑指令** | **一行可直接複製貼上**的指令，自帶工作內容的指針。這是本節存在的唯一理由，**NEVER** 省略 |
| user 本人要做的事 | 只列 user 非做不可的（起 dev server、回答某題、給憑證），逐條一句。沒有就整段不出現 |

續跑指令的形狀綁可觀察 predicate：

| 可觀察 predicate | 續跑指令長什麼樣 |
| --- | --- |
| 剩餘工作全部已登記在單一檔 | `cd <repo> && claude "續跑 <檔路徑>"` |
| 剩餘工作已登記且可無人值守跑完 | 該 repo 的 runner 指令（work-loop `runner.sh` 等），**優先於**開新 session ——user 完全不必在場 |
| 剩餘工作卡在某個待 user 拍板的問題 | 續跑指令照給，前面加一句「先回答 `<哪一題>`」。**NEVER** 因為卡住就不給指令 |

**NEVER 句黑名單（逐字實錄，2026-08-07 Charles 在 <consumer-b> session 端點名）**：

- ❌「建議收工，讓下個乾淨 context 接手，**task 檔已記全**」——「已記全」對 user 零可執行性，
  他要的是那一行貼進去就跑的指令
- ❌ 把「開新 session、跟它解釋要做什麼」當成 user 理所當然該付的成本而不寫進訊息裡。
  **user 重述工作內容的那幾分鐘，正是本節要消掉的東西**

`\nx`（Charles 個人縮寫，判為收工時）同樣受本契約約束：「收工 ＋ 一句已登記在哪」是**下限**不是全部，
續跑指令那一行照樣 MUST 給。
