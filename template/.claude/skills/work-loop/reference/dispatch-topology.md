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
| **扇出組** | OPSX 當前 revision 的實作／證據補件、非 OPSX code task（均不需要 dev server） | **同時 in-flight ≤ 4** | 無（各自 worktree） |
| **dev-port 組** | OPSX 證據補件中**需要起 dev server** 的 item、Design Review 截圖 | **1** | consumer 的 dev port（SoT：`registry/consumers.json` 的 `dev_ports`） |
| **main 組** | OPSX 歸檔與已驗證改動落地 | **1** | main worktree（archive → merge-back → commit → push） |
| **主線即時組** | 3g healthCheckNeeded、3e ready(userActionPending>0) 的 Claude-actionable 檢查、3i applyBlocked 評估、3j awaitingUserDecision 評估、非 spectra investigation | 主線自己做，不 dispatch（read-heavy 者先過 § 主線即時組的 pre-scan 前置判定） | 無 |

**每一個** priority item 在 dispatch 前都要落進上表某一組，不是只對前幾個分類。

OPSX 實作／補件落哪一組看**這個 item 要不要起頁面**：要截圖 / 要看畫面 → dev-port 組；純 backend code fix 或純 annotation 補寫 → 扇出組。需求評估完成後若轉成實作 dispatch，該 item 改列**扇出組**。

分組判定順序（先命中先算）：

1. item 需要 archive / merge-back / push → **main 組**
2. item 需要 dev server 起頁面（收 evidence、重拍 stale 截圖、Design Review）→ **dev-port 組**
3. item 只改 tracked code、走 `/wt` worktree → **扇出組**
4. item 主線用 Edit / Bash 就能做完 → **主線即時組**

## 扇出組：填滿 4，收一個補一個

- dispatch 到第 4 個 in-flight 後停止 dispatch，主線改做 main 組 / dev-port 組 / 主線即時組
- 每收到一個 `<task-notification>` 並走完收割 SOP，從扇出組**補一個**新的 dispatch
- **≤ 4 只計扇出組的 dispatch**。dev-port 組的 `/wt` dispatch 另計（它自己的配額是 1），兩者不互佔——4 個扇出 in-flight 加 1 個 dev-port dispatch 是合法狀態
- `--unattended` 的 5-item cap 管的是**本輪處理總數**，不是併發數。兩者同時生效時**併發 4 先觸頂**（總數 5 > 併發 4），實質併發上限維持 4 —— 2026-08-24 把 cap 從 3 放寬到 5 之前是反過來的（總數 3 < 併發 4，實質併發被壓成 3）。**NEVER** 把本行讀成「併發上限跟著 cap 走」：兩個常數各有依據，改一個不會連動另一個

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

## 主線即時組的 pre-scan 前置判定

**每一個**落進主線即時組的 item（3g / 3i / 3j 評估、非 spectra investigation、packaging 蒐證、唯讀補事實），主線在讀**第一個**來源檔之前，MUST 先列出「完成判讀所需的必讀來源清單」，再按下表判定：

| 可觀察 predicate | 動作 |
| --- | --- |
| 清單 ≥4 個 source file（scan JSON 與 state 檔不計；同檔多段算 1 檔） | **先派 pi pre-scan**；接著依下方 extraction / reconciliation predicate 選 `read-heavy-scan` 或 `exploration-prescan`，主線只消費 report 做判讀 |
| 本輪 3i + 3j 合計 ≥4 條 | **批次派一個 pre-scan** 收齊全部 blocker / 決策描述事實表（見 [blocker-evaluation.md](blocker-evaluation.md) § 批次蒐證）；涉及 blocker/status 對帳時固定走 `exploration-prescan` |
| 兩者皆未命中 | 主線直接定點 Read——≤3 檔本來就是本組的正常形狀，**NEVER** 為湊派工而擴清單 |

本判定實作 [[agent-routing]] § 必禁事項「**NEVER** 在 exploration / research 型 session 自己逐檔 Read + scan 多個 source 超過 3 個 source file」——本組過去把 investigation 整組寫死在主線，結構上恆違反該條。

**判讀與決策仍在主線**：pre-scan 只搬「讀」。分類（SKILL.md § 3.1b）、七條 predicate、blocker 鮮度判定、packaging 成稿全部照舊主線做，**NEVER** 外派。

### pre-scan 的 model predicate（extraction 與 reconciliation 分開）

先用上表判「要不要 pre-scan」，再逐條判工作形狀；輸出矩陣固定不代表工作一定是 extraction。

| 可觀察 predicate | Routing Table row |
| --- | --- |
| 下列五項**全部**成立：source list 已封閉並逐條列出；回傳欄位固定；每個 fact 都要求 `source path + line/JSON pointer + raw value`；不需 identity matching、status 推斷或 evidence relevance 判斷；來源矛盾時只回 `needs-reconciliation`、不自行裁決 | `read-heavy-scan` → Luna low |
| 上列任一不成立，或任一命中：未知路徑探索、來源矛盾、跨來源 identity matching、partial completion／status 推斷、evidence relevance 判斷、git/history/state 對帳 | `exploration-prescan` → Grok low |

Luna report 若回 `needs-reconciliation`，主線用同一份 sources + facts 建 Grok brief，帶 `--retry-of <luna-label>` 派 `exploration-prescan`；**NEVER** 要 Luna 自行裁決，也 NEVER 以提高 Luna effort 取代 Grok。

### pre-scan 的 dispatch 形狀

model / effort / template 的 SoT：[[agent-routing]] § Routing Table 對應列 + cookbook `~/offline/clade/vendor/snippets/pi-offload/README.md`。brief 的 `task` **MUST** 逐條列出來源清單與要回的欄位（檔名 / 行號 / 現值 / 判準命中與否）；`allowed_paths` 填「（只讀，無寫入授權）」。每一筆 dispatch 都帶 `--origin work-loop --origin-id wl-r<本輪 round>`；`read-heavy-scan` 另帶 `--cohort fact-extraction`，`exploration-prescan` 另帶 `--cohort reconciliation`。runner child 已由 env 注入 origin pair，CLI 仍顯式帶以便 attended 與 dry-run 形狀一致。

執行形狀依 process 身分 first-match：

| 可觀察 predicate | dispatch / harvest |
| --- | --- |
| runner child（`--runner-child --linked-dispatch-mode foreground` 或 `WORK_LOOP_RUNNER_CHILD=1`） | foreground Bash 跑泛用 dispatcher，timeout 600000；同一 tool call 收到 exit 與 stdout JSON 後立即輕量收割，**不**寫 `inFlight`、不 arm keepalive |
| 非 runner child | Bash `run_in_background` 跑泛用 dispatcher；watch 依 [[agent-routing.pi-watch-protocol]] § 監看排程（notification-only + 單一 `ScheduleWakeup` 安全網，禁止短輪詢），並記 state `inFlight`（`agent=pi:<label>`、owner 固定 `pi-watch`、2h deadline） |

非 runner child 的安全網 prompt MUST 使用 [[agent-routing]] 的 canonical inert control message，NEVER 放原 pre-scan / work-loop 任務；terminal claim / intervention 由 `pi-watch` 完成後 callback 至本節的輕量收割，**NEVER** 另以 `work-loop-dispatch` 對同一 task claim。

- pre-scan **不計** `--unattended` 的 5-item cap——它是某個 item 處理過程的一段，不是一個 item
- async 路徑收到 notification → 走 [harvest.md](harvest.md) § pre-scan 通知的輕量收割，**不走** 8 步 SOP
- **report 是未驗證主張**：report 結論若導向**狀態改變**（unblock / packaging / 排除某 item），主線 MUST 對該結論引用的關鍵檔位定點 Read 複驗後才動手

### pre-scan 的 exit code 分流（quota 擋 ≠ dispatch failure）

exit code 契約的 SoT 是 [[agent-routing.pi-watch-protocol]] § 泛用 Dispatcher。本表只定義它在 loop 內的處置：

| exit | 處置 |
| --- | --- |
| `0` | 讀 stdout JSON 的 `result` → 輕量收割 → 該 item 回 Step 3 續判 |
| `2` 業務 fail | `result` 的 fail 原因本身是事實（例：來源檔不存在）——消費它，缺口由主線定點 Read 補。**NEVER** 原樣重派、**NEVER** 換 Claude 重做同 brief |
| `3` 機械故障 | 主線 fallback 自讀（唯一允許的 Claude fallback），state `notes` 留 `pi-prescan-fallback(exit3): <stderr 首行>`；**本輪剩餘 pre-scan 不再嘗試 pi** |
| `4` quota 擋 | `resets_at` 落 state `notes`；本輪剩餘 pre-scan 直接走 fallback（不重複撞）。fallback 依 [[agent-routing]] § 配額耗盡時的 fallback 紀律；主線接走時 `notes` 留 `self-read(quota)` |

**exit `2` / `3` / `4` 都 NEVER 記入 `failStreak` / `consecutiveDispatchFailures`**——那兩個計數器管的是 **item 的工作 dispatch**，pre-scan 只是它的蒐證段。quota 擋被記成失敗時，`consecutiveDispatchFailures >= 2` 會在無人值守下把整個 loop 停掉一整夜。

同理，pre-scan 走不通 **NEVER** 成為該 item 的 skip 或 packaging 理由——那份 read 工作主線本來就做得了，pre-scan 只是把它搬出去。

### item 工作 dispatch 的 exit 4（quota 不是失敗，是換座位）

上表只管 pre-scan。**item 的工作 dispatch 撞 exit 4 時，同樣 NEVER 直接記 `failStreak` /
`consecutiveDispatchFailures`**——quota 是座位滿了，不是這個 item 推不動。

`pi-dispatch.ts` 在 exit 4 的 stdout JSON 裡**已經印出**下一跳：
`next_step: "retry with --model <nextTier> --tier-basis quota-fallback --route fallback-chain"`。

| 可觀察 predicate | 動作 |
| --- | --- |
| exit 4 且 stdout 有 `next_step` | **MUST 照它重派一次**（`--retry-of <原 label>`），本輪內完成。這一跳成功 = 本 item 正常收割，quota 完全不進 state 的失敗計數 |
| 整條 fallback 鏈都回 exit 4（沒有 `next_step` 可跳） | 記 state `notes` 一行 `quota-exhausted(<item>): resets_at=<ISO>`，該 item **本輪** skip；`resets_at` 進 `blockers` ledger 當解除條件。**NEVER** 記入 `consecutiveDispatchFailures`、**NEVER** 因此寫 `stoppedReason` |
| 撞 exit 4 就寫「等配額恢復」進 HANDOFF 後不再處理 | **違反本節。** 「等配額恢復」是 fallback 鏈跑完才成立的結論，不是撞第一次 exit 4 的結論 |

**NEVER 把 quota 擋讀成「這個 item 需要 attended」**——它與人在不在場無關，`resets_at` 到了就自己解除。
兩者混在一起會讓一條純機械的等待被 packaging 成待 Charles 拍板的決策。

## 併發上限是兩個，按載體選（NEVER 挑數字小的那個）

`≤4` 與 `≥2` 不是矛盾，是兩種**載體**各自的上限。判之前先問一題：**這幾條 dispatch 共用一棵 working tree 嗎？**

| 可觀察 predicate | 上限 | 出處 |
| --- | ---: | --- |
| 每個 worker 各自 worktree（`/wt <slug>` 扇出組） | **4** | SKILL.md § 4a |
| 共用同一棵 working tree 的 session dispatch | **2** | SKILL.md § dispatch 的三個不准 |

4 那條買的是並行度（worktree 隔離，沒有 race 可搶）；2 那條買的是 race 防護
（`N session 搶同一 working tree 是把 usage 問題升級成 race 問題`，逐字理由在 SKILL.md）。
**NEVER** 把 2 當全域上限套到 worktree 扇出組上——那會把並行度砍半換一個不存在的 race；
**NEVER** 把 4 套到共享樹上——那正是 2 那條在防的東西。

兩者可同時生效：扇出組 4 條各自 worktree ＋ 主線這棵樹上另有 1 條 dispatch，合法。

## 主線在做什麼

主線**不是**扇出後的等待者，它是序列組的執行者。任一時刻主線的工作來源，依序：

1. 扇出組有未 dispatch 的 item 且扇出 in-flight < 4 → **先補滿**。dispatch 是非阻塞動作，**永遠優先於下面每一條**——先把並行度拉滿，主線再去做序列工作
2. main 組還有 item → 做 main 組
3. dev-port 組有 item 且 lease 可取 → dispatch 該 item（走 `/wt`，一次一個）
4. 主線即時組還有 item → 做主線即時組
5. 四組皆空 → 走 SKILL.md § Dispatch 共通規則 的「主線工作來源」補件（HANDOFF 的 ⏸ Skipped fail-streak < 3 / 📊 Progress 仍 actionable / Outstanding 已登記的 change）
6. 補件也空且 in-flight > 0 → 等 notification（此時等待是收斂，不是閒置）

四組皆空、補件也空、**且** in-flight ledger = 0 才是本輪結束。
