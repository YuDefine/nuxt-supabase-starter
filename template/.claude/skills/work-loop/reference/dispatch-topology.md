<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/work-loop/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# Dispatch Topology（Step 2 分組 + Step 3 併發契約）

> 主檔 pointer：「Step 3 dispatch 前 MUST 先完整讀本檔」。

## 核心命題

Step 2 產出的**不是**一條佇列，是**四組**併發特性不同的工作。分組依據只有一條可觀察 predicate：**這個 item 要不要獨占某個共用資源**。

- 不佔任何共用資源 → 可以同時跑
- 佔 dev port → 一次一個
- 寫 main → 一次一個

同一個 change 的 item 之間有真依賴（bucket 位移要看上一步結果）；**不同 change 的 item 之間沒有任何資料流** —— 它們各自在自己的 worktree，B 不讀 A 的 output。把它們排成一條線只是讓後面的空等。

## 四組契約

| 組 | 成員 | 併發 | 獨占的資源 |
| --- | --- | --- | --- |
| **扇出組** | 3f applyInProgress、3h parked、非 spectra code task、**不需要 dev server 的** 3a / 3b（純 backend fix、annotation 補寫） | **同時 in-flight ≤ 4** | 無（各自 worktree） |
| **dev-port 組** | 3a / 3b 中**需要起 dev server** 的 item、Design Review 截圖 | **1** | consumer 的 dev port（SoT：`registry/consumers.json` 的 `dev_ports`） |
| **main 組** | 3z done、3c awaitArchiveWalkthrough、3d ready(userActionPending=0) | **1** | main worktree（archive → merge-back → commit → push） |
| **主線即時組** | 3g healthCheckNeeded、3e ready(userActionPending>0) 的 Claude-actionable 檢查、3i applyBlocked 評估、3j awaitingUserDecision 評估、非 spectra investigation | 主線自己做，不 dispatch | 無 |

**每一個** priority item 在 dispatch 前都要落進上表某一組，不是只對前幾個分類。

3a / 3b 落哪一組看**這個 item 要不要起頁面**，不看 bucket 名字：要截圖 / 要看畫面 → dev-port 組；純 backend code fix 或純 annotation 補寫 → 扇出組。3i / 3j 評估完若轉成 apply dispatch，該 item 改列**扇出組**。

分組判定順序（先命中先算）：

1. item 需要 archive / merge-back / push → **main 組**
2. item 需要 dev server 起頁面（收 evidence、重拍 stale 截圖、Design Review）→ **dev-port 組**
3. item 只改 tracked code、走 `/wt` worktree → **扇出組**
4. item 主線用 Edit / Bash 就能做完 → **主線即時組**

## 扇出組：填滿 4，收一個補一個

- dispatch 到第 4 個 in-flight 後停止 dispatch，主線改做 main 組 / dev-port 組 / 主線即時組
- 每收到一個 `<task-notification>` 並走完收割 SOP，從扇出組**補一個**新的 dispatch
- **≤ 4 只計扇出組的 dispatch**。dev-port 組的 `/wt` dispatch 另計（它自己的配額是 1），兩者不互佔——4 個扇出 in-flight 加 1 個 dev-port dispatch 是合法狀態
- `--unattended` 的 3-item cap 管的是**本輪處理總數**，不是併發數。兩者同時生效時 3-item cap 必然先觸頂（總數 3 < 併發 4），實質併發上限變成 3

**4 的依據**：每個 in-flight = 一個完整 worktree checkout + 一個 background agent。單機磁碟與 usage 成本在這個量級之上開始明顯。這是常數不是公式 —— 改它要改本檔。

**`/wt` 不可用的 repo（產地 clade home 就是）扇出上限是 1，不是 4**：該情況下執行者是主線本身
（SKILL.md § `/wt` 不可用時的 dispatch 形狀），而主線只有一個。此時「填滿 4」那一節整段不適用——
主線做完一個 worktree 的 commit → merge-back → 落地，才開下一個。

上限變 1 **只改併發，不改工作量**：其餘分組判定、收割 SOP、commit 紀律逐條照舊，
item 也不會因此變成可跳過（§ Skip 合法理由窮舉只有 3 條，併發不在內）。

## dev-port 組：一次一個，等而不搶

dev port 的互斥**沿用既有機制**，不自建配額：

- lease 由 `vendor/scripts/dev-session.ts`（durable 主入口）讀寫，`dev-singleton.ts` 是 legacy spawn 層；語義與衝突訊息見 [[verification-lease.spec]] § 工具行為契約
- dispatch 一個 dev-port 組 item 前先確認 lease 可取得
- **lease 被別的 live session 持有** → 該 item 留在 dev-port 佇列，主線改做扇出組回填 / main 組 / 主線即時組，下一輪再試。**NEVER** takeover 別人的 live lease
- **無 lease 檔 + session 已離場的 stale dev server** → 這不是衝突，主線自行清理 + 重起（三層判定 SOP 見 SKILL.md § Dispatch 共通規則「Dev server 協調」）
- **launcher 本身跑不起來**（SKILL.md § Step 2.5 的探針非 0）→ 這既不是衝突也不是 stale，本組**整組不可用**：item 全部走 packaging，**NEVER** dispatch 進去試

「等而不搶」與「stale 自行清理」是兩件事，判準是 lease 檔存在且持有者仍 live。
兩者都預設 launcher 是活的——那件事由 Step 2.5 先確認，不在本節重判。

## main 組：一次一個

archive → merge-back → commit → push 全部寫同一個 main worktree。兩個並行的 archive 會在 merge-back 撞在一起，這是真依賴，不是保守。

同組內依 `pending/total` 排序（完成度高的先 ship）。

## 主線在做什麼

主線**不是**扇出後的等待者，它是序列組的執行者。任一時刻主線的工作來源，依序：

1. 扇出組有未 dispatch 的 item 且扇出 in-flight < 4 → **先補滿**。dispatch 是非阻塞動作，**永遠優先於下面每一條**——先把並行度拉滿，主線再去做序列工作
2. main 組還有 item → 做 main 組
3. dev-port 組有 item 且 lease 可取 → dispatch 該 item（走 `/wt`，一次一個）
4. 主線即時組還有 item → 做主線即時組
5. 四組皆空 → 走 SKILL.md § Dispatch 共通規則 的「主線工作來源」補件（HANDOFF 的 ⏸ Skipped fail-streak < 3 / 📊 Progress 仍 actionable / Outstanding 已登記的 change）
6. 補件也空且 in-flight > 0 → 等 notification（此時等待是收斂，不是閒置）

四組皆空、補件也空、**且** in-flight ledger = 0 才是本輪結束。
