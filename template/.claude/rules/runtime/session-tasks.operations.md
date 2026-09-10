---
description: Session tasks 的操作細節——何時用 / 不用、模板、升級路徑、與其他真相層的分工、lessons.md 邊界；另含**收工正文**（收工三步 / 收工訊息契約 / Herdr session transport / 派幾個 pane / successor 收割），由 [[session-tasks]] 的具名時機指針與 session-context-budget-warn hook 叫醒
paths: ['tasks/**', 'HANDOFF.md']
---
<!-- Clade native rule; source: adapters/claude/instructions/rules/core/session-tasks.operations.md; edit canonical source -->
<!-- clade-targets: claude -->

# Claude close-out and handoff carrier

Interactive Claude close-out may use `AskUserQuestion` for a genuinely user-owned remove/retain decision and `Agent`/`TaskOutput`/`TaskStop` for owned workers. Native `run_in_background` status is not correlated business completion. Canonical Herdr transport still follows the common contract; native launcher availability must be checked before dispatch.

### 成本模型（2026-08-07 納入 prompt caching 修正）

**真正的成本殺手不是長 session，是 cache miss。** 單次 miss 在 300k context ≈ +0.9M effective——
比整場 warm 讀取的一半還多。已知的 miss 觸發源（**MUST** 全部避免）：

- session 中途切 `/model`、`/effort`、首次開 fast mode
- MCP server 增減、連線斷掉
- 休息超過 cache TTL（訂閱 1h；吃 usage credits 時降到 5m）後才續跑
- Claude launcher 升級後 resume 舊 session

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

