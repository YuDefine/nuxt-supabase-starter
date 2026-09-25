# 開場決策清算（Step 2.7）


> Runtime split: state, ownership, approval, and completion obligations are shared. Literal Claude tool names or runner commands in this reference are Claude host bindings; other hosts MUST use their adapter fragment or retain the dependent operation blocked.


> 主檔 pointer：Step 2.7 MUST 先完整讀本檔再執行，**每一輪都讀**。

本步是把 packaging 累積的待答題端到 Charles 面前的唯一出口；產出是「佇列歸零」，不是「問了幾題」。

---

## Iron Law：attended 先送達待答題，再依依賴範圍開工

**每一輪 attended MUST 在新工作 dispatch 前送達全部 unresolved `awaiting[]` 待答題。** `refused` 已移到獨立 ledger，不計入 unresolved queue，也不阻塞其他 item。同步詢問若仍在等待，遵守 host 實際阻塞語義；非阻塞詢問或普通對話回報 pending／尚未取得答案時，保留 unresolved item 且不發 grant，只阻擋依賴該答案的 item。詢問已送達且當前介面允許繼續時，獨立且已授權的有界工作可進 Step 3／4。

**NEVER** 從經過時間、沒有工具、delivery receipt、或缺少 `awaiting[]` 條目推導答案；已送達但尚未回答的題目保持 pending，NEVER 重複發問。

順序是「**先清算，後開工**」，不是「邊做邊找機會問」。**判準是 mode，不是題數、不是急迫性。**

---

## Mode 分岔（不對稱，兩邊各自成立）

| 可觀察 predicate | 本步怎麼跑 |
| --- | --- |
| **attended**：非 `--unattended`、且本輪非 `claude --print` 起 | 跑完整 (a)(b)(c)，先送達全部待答題；實際取得的答案立即落 state。未取得答案時只阻擋依賴 item；獨立且已授權的有界 item 可在詢問送達後進 Step 3／4 |
| **unattended / runner** | **只跑 (a) prune**，(b)(c) 跳過。佇列剩下的 item 本輪照舊排除，**其餘工作全部照跑** |

判不出自己在哪個 mode → **當作 unattended**（沿用 Step 0 既有規則，保守側是不打斷不在場的人）。

**unattended 下佇列非空 NEVER 是停 loop 的理由**：清算由下一次 attended 開場承擔，**NEVER** 因佇列非空寫 `stoppedReason`、**NEVER** 因此跳過與該佇列無關的 item。

**佇列裡的 item 本輪排除，不是 skip。** 它不進 `non-plan-dispatch.md` § skip 合法理由窮舉，
也 **NEVER** 被拿來當第 4 條 skip 理由用在其他 item 上——排除的對象只有「佇列裡那幾條」本身。

---

## (a) Prune —— 逐條判定，兩種情況不問

對 `awaiting[]` **每一條**逐條走完，不是只查前幾條、也不是只查「看起來過期的那幾條」。

| 可觀察 predicate | 動作 |
| --- | --- |
| 該 item 已不在本輪 scan（已 archive / 已勾 `[x]` / 條目已刪） | 移出佇列，**不問**。HANDOFF 對應 `###` 子段一併刪除 |
| 依 [autonomy-predicate.md](autonomy-predicate.md) § Iron Law 重判：**現在**寫得出「推薦 A + 站得住的理由」，**且未命中 predicate 7，且 `requiresSpecificConsent !== true`** | 移出佇列，當自主 item 進 Step 3 做掉，**NEVER** 拿去問。已拒絕項目不在 awaiting，而在 `refused` ledger |
| 以上皆非 | 留在佇列，進 (b) |

**重判是 MUST**（事實可能已補齊）。**predicate 7 命中的條目 NEVER 被 prune 掉**，一律留到 (b) 問。

---

## (a2) Open TD 不是 waiting-user

（未遷移 consumer 才適用；有 `specs/truth/work-lifecycle.md` 時舊主檔已凍結，對應工作在 plan 的 Open work。）

`docs/tech-debt.md` 裡 open class、未 parked 的條目**預設是債**，不是「缺 `### 自驗` 所以等 Charles」。

| 可觀察 predicate | 動作 |
| --- | --- |
| open TD、未 parked、runner child 且 Location 落 `.claude/` / `rules/` / `capabilities/` / `vendor/` / `claude-md/` | 本輪排除（needsPublish），**不是** skip 其他 item 的理由 |
| open TD、未 parked、重判後寫得出推薦 A 且未命中 predicate 7 | **不當 waiting-user**。進 Step 3 當 candidate。缺 `### 自驗` 就在做完那一輪補，**NEVER** 因此 packaging |
| 重判寫不出推薦、或命中 predicate 7 / 真的要值（時段／人／門檻） | 才 packaging 進 `awaiting[]` 走 (b) |

**NEVER** 把「沒有 `### 自驗` heading」讀成 user-bound。那是做完才落的憑證，不是準入條件。
attended 開場 MUST 把這批跟 `awaiting[]` 一起過 (a) 的 prune：能自主的直接做，不能的才問。

---

## (b) Ask —— 全部問完，不設題數上限

**排序**（兩層，依序套）：

1. 本輪 candidate list 會用到的（答案一落地就有下游工作可推）
2. 其餘依 `packagedAt` 由舊到新

**發問形狀**：attended mode 逐批向使用者提問；每批數量遵守當前 host 工具 schema。沒有結構化工具時，使用當前對話逐批提問。已送達但尚未回答的題目保持 pending，不重複發問。每題的選項直接取該條目的
`options`：`recommended: true` 那項排第一、label 後綴 `(推薦)`，`effect` 進 description。
問題文字 = 條目的 `title` + 一句 `blocker`。每批若實際收到答案，MUST 先把答案落入 state，確認寫入成功後才進依賴該答案的下一批或下一步；若 host 回報 pending／尚未取得答案，保留 unresolved item 與未發 grant，當介面允許繼續時可送達下一批或進行獨立下一步，但不得執行依賴動作。

permission classifier 要求 **specific shared-action consent** 的題目一律遵守 [[agent-routing.keepalive-wake]] § Shared-action specific consent UX；本檔只補 work-loop 狀態約束：packaging MUST 設 `requiresSpecificConsent=true`，unattended / runner 不呼叫 `host question surface`，並保留該 SoT 要求的完整範圍，等下一次 attended 開場顯示。

**NEVER 在這一步做這三件事**：

- ❌ **自己設上限**（「先問最急的 4 題，其餘下次」）——沒有題數上限。剩下的就是還沒清空
- ❌ **答案尚未取得就執行依賴該答案的 item**——grant 尚未發出；獨立且已授權的有界 item 仍依 Mode 分岔推進
- ❌ **把 (a) 該 prune 掉的丟進來湊題**——那是把自己的工作退回去

---

## (c) Record —— 答案落檔，三處同步

**每一個**答案 **MUST 立刻落檔**，且 **MUST 在進 Step 3 之前完成**。

沒落檔的答案等於沒答；「等 Step 7 一起寫」是違規。

三處同步，缺一不算落檔：

| 位置 | 動作 |
| --- | --- |
| state `decisions` | 寫 `{"<id>": {"answer": "<key>", "outcome": "granted|refused", "note": "<Charles 逐字>", "answeredAt": "<ISO>"}}`。specific shared-action 的 granted answer 另建 `grant={actionFingerprint,scope,grantedAt,consumedAt:null}`；每個可執行的縮小範圍選項也 MUST 自帶完整 scope |
| state `awaiting[]` / `packaged` | granted 與 refused 都從 unresolved queue / projection 移除。granted 建 one-shot grant；refused 另寫 `refused[id]={answer,scope,refusedAt,note}` ledger，供 scan 排除 |
| `$MAIN_WT_PATH/HANDOFF.md` | granted 刪對應子段；refused 保留子段並標明 blocked/refused scope，但它不回填 awaiting |

`note` **MUST 逐字記 Charles 說的話**（含選項外的補充），**NEVER** 記成你的複述。

只有 `outcome=granted` 且 action fingerprint 與選取 scope 完全相符的條目，才在**本輪**進 Step 3；dispatch 前 MUST 原子寫入 `consumedAt`，同一 grant **NEVER** 重播。`outcome=refused` 寫入獨立 ledger後保持 blocked，**NEVER** 進 Step 3、NEVER 自動重問或自行執行，但不阻塞其他 unresolved item 清算與開工。

---

## 逐字反藉口

以下**每一句**都不是合法理由。看到自己在心裡講出其中任何一句 → 立即停手，回到 Iron Law。

| 讀到自己在想 | 現實 |
| --- | --- |
| 「先做一件看得到成果的，等一下再問」 | 「等一下」就是他已經離開座位的那一刻。本步存在的理由正是這個 |
| 「這幾條都不急，下次開場再問」 | 不急的題目照樣佔著佇列。判準是佇列空不空，不是急不急 |
| 「一次問 9 題太打擾了」 | 打擾一次 9 題，比讓 9 條工作各卡一輪便宜。沒有題數上限 |
| 「他剛剛在忙，我先開工」 | 他打 `/work-loop` 就是在場。忙不忙由他答題的速度表達，不由你替他判斷 |
| 「這條寫得很清楚了，他看 HANDOFF 就會答」 | HANDOFF 不會主動出現在他面前——那正是累積的成因 |
| 「等使用者看一下再繼續」 | 既有 guardrails § D 已列為違規句。attended 下的正解是**現在問**，不是等 |
| 「這輪做了 3 件，夠了」 | 既有 guardrails § D 已列為違規句。沒有 per-round 配額，也沒有 per-round 問題配額 |
| 「答案我先記在腦子裡，Step 7 一起寫」 | 下一輪是新 process / 已被 compaction 壓過。沒落檔＝沒答 |

---

## Red Flags（出現任一 → 停手，重讀本檔）

- 正要進 Step 3 分類，而 state 的 `awaiting[]` 有題目尚未送達、已有實際答案卻尚未寫入 `decisions`，或依賴該答案的動作沒有對應 grant（已送達但 pending 且獨立工作不屬此列）
- 正要呼叫 `host question surface` 問一條你寫得出 `(推薦)` 的 item（(a) 沒跑或沒跑完）
- 已經收到 Charles 的答案，但還沒寫 `decisions` 就開始 dispatch
- 本輪是 `--unattended`，而你正要因為佇列非空寫 `stoppedReason`
- 佇列裡的某條被你拿來當「其他 item 也可以 skip」的理由


Cursor binding for this reference: discover the current host's question capability and schema. Use a structured question surface only when it is actually exposed and supports the source options; otherwise use ordinary conversation. Do not assume a four-question limit or invent a tool name. Send all unresolved questions early before new-work dispatch. A blocking question call obeys its actual wait semantics; an async or ordinary-conversation pending result leaves the question unresolved and grant unissued, blocking only dependent items while independent authorized bounded work may continue. Persist only a real answer to state before dependent actions or the next batch.
