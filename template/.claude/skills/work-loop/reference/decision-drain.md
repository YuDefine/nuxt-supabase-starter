<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/work-loop/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# 開場決策清算（Step 2.7）

> 主檔 pointer：Step 2.7 MUST 先完整讀本檔再執行。**每一輪都讀**——本檔管的是「開工前」，
> 而 compaction 抹掉的正是「上一輪剛讀過」那份 context。

## 這一步在防什麼

packaging 把非自主 item 寫進待答佇列（`## ⏳ Awaiting Charles`，**append 不覆寫**），而在本步
存在之前，**沒有任何一步會把那些問題端到 Charles 面前**——只等他自己想到要去讀 HANDOFF。
結果是待答決策單向累積，每一條都卡著一批下游工作。

Charles 2026-08-06 逐字：「work-loop 會累積很多 waiting user 的事件」「應該在每一次新 work-loop
開始時 先問我 然後才放我走」。

**本步的產出不是「問了幾題」，是「佇列歸零」。**

---

## Iron Law：attended 下佇列非空 NEVER 開工

**unresolved `awaiting[]` 非空時 NEVER 進 Step 3 分類、NEVER 進 Step 4 dispatch。** `refused` 已移到獨立 ledger，不計入 unresolved queue，也不阻塞其他 item。先把 unresolved 佇列清空，再開工。

順序是「**先清算，後開工**」，不是「邊做邊找機會問」。理由是機制事實而非禮貌：Charles 在場的
時間是這個 loop 最稀缺的資源，而他在場的那一段**正是**他準備離開座位去做別的事的那一段。把
問題留到「做完手上這件再問」，多數時候等同留到他已經走了。

**這條的判準是 mode，不是題數、不是急迫性。** 佇列剩 1 題和剩 9 題適用同一條規則；「這幾條都
不急」不構成延後問的理由——不急的題目照樣佔著佇列，而佇列非空就不開工。

---

## Mode 分岔（不對稱，兩邊各自成立）

| 可觀察 predicate | 本步怎麼跑 |
| --- | --- |
| **attended**：非 `--unattended`、且本輪非 `claude --print` 起 | 跑完整 (a)(b)(c)。佇列清空才進 Step 3 |
| **unattended / runner** | **只跑 (a) prune**，(b)(c) 跳過。佇列剩下的 item 本輪照舊排除，**其餘工作全部照跑** |

判不出自己在哪個 mode → **當作 unattended**（沿用 Step 0 既有規則，保守側是不打斷不在場的人）。

**unattended 下佇列非空 NEVER 是停 loop 的理由。** Charles 2026-08-06 逐字：「如果我跑那個腳本
就不用特別阻擋 就做那些不受影響的」。無人值守期間累積是**被允許的**，清算由下一次 attended
開場承擔——**NEVER** 因佇列非空寫 `stoppedReason`、**NEVER** 因此跳過與該佇列無關的 item。

**佇列裡的 item 本輪排除，不是 skip。** 它不進 `non-spectra-dispatch.md` § skip 合法理由窮舉，
也 **NEVER** 被拿來當第 4 條 skip 理由用在其他 item 上——排除的對象只有「佇列裡那幾條」本身。

---

## (a) Prune —— 逐條判定，兩種情況不問

對 `awaiting[]` **每一條**逐條走完，不是只查前幾條、也不是只查「看起來過期的那幾條」。

| 可觀察 predicate | 動作 |
| --- | --- |
| 該 item 已不在本輪 scan（已 archive / 已勾 `[x]` / 條目已刪） | 移出佇列，**不問**。HANDOFF 對應 `###` 子段一併刪除 |
| 依 [autonomy-predicate.md](autonomy-predicate.md) § Iron Law 重判：**現在**寫得出「推薦 A + 站得住的理由」，**且未命中 predicate 7，且 `requiresSpecificConsent !== true`** | 移出佇列，當自主 item 進 Step 3 做掉，**NEVER** 拿去問。已拒絕項目不在 awaiting，而在 `refused` ledger |
| 以上皆非 | 留在佇列，進 (b) |

**重判是 MUST，不是可選。** 一條 item 當初 packaging 是因為**那一輪**的事實不足；此後可能已經
有 subagent 補了證據、有別的 item 完成後消除了 trade-off、或當初根本就是誤判。把一條現在自己
能決定的事拿去問，per `autonomy-predicate.md` § Iron Law 是**把已完成的工作退回給人**。

Charles 2026-08-05 逐字：「等我拍板的那些問題 其實你都能決策的話 也是在拖累開發速度」。

**predicate 7（放寬約束自身門檻）命中的條目 NEVER 被 prune 掉**，即使你寫得出推薦、理由也
站得住——「我有好理由」在那一格恰好不是可自主的證據。那類條目一律留到 (b) 問。

---

## (b) Ask —— 全部問完，不設題數上限

**排序**（兩層，依序套）：

1. 本輪 candidate list 會用到的（答案一落地就有下游工作可推）
2. 其餘依 `packagedAt` 由舊到新

**發問形狀**：`AskUserQuestion` 一次 ≤4 題，**連續發到佇列清空**。每題的選項直接取該條目的
`options`：`recommended: true` 那項排第一、label 後綴 `(推薦)`，`effect` 進 description。
問題文字 = 條目的 `title` + 一句 `blocker`。

permission classifier 要求 **specific shared-action consent** 的題目一律遵守 [[agent-routing]] § Shared-action specific consent UX；本檔只補 work-loop 狀態約束：packaging MUST 設 `requiresSpecificConsent=true`，unattended / runner 不呼叫 `AskUserQuestion`，並保留該 SoT 要求的完整範圍，等下一次 attended 開場顯示。

**NEVER 在這一步做這三件事**：

- ❌ **自己設上限**（「先問最急的 4 題，其餘下次」）——沒有題數上限。剩下的就是還沒清空
- ❌ **問完一批就先開工**——(b) 沒跑完就不是清空，Iron Law 照舊擋住 Step 3
- ❌ **把 (a) 該 prune 掉的丟進來湊題**——那是把自己的工作退回去

---

## (c) Record —— 答案落檔，三處同步

**每一個**答案 **MUST 立刻落檔**，且 **MUST 在進 Step 3 之前完成**。

理由是機制事實：runner 每輪是**全新 process**，in-session 也會被 compaction 壓縮——**沒落檔的
答案等於沒答**。「等 Step 7 一起寫」在本步是違規，中間任何一次夭折都會讓 Charles 白答一輪。

三處同步，缺一不算落檔：

| 位置 | 動作 |
| --- | --- |
| state `decisions` | 寫 `{"<id>": {"answer": "<key>", "outcome": "granted|refused", "note": "<Charles 逐字>", "answeredAt": "<ISO>"}}`。specific shared-action 的 granted answer 另建 `grant={actionFingerprint,scope,grantedAt,consumedAt:null}`；每個可執行的縮小範圍選項也 MUST 自帶完整 scope |
| state `awaiting[]` / `packaged` | granted 與 refused 都從 unresolved queue / projection 移除。granted 建 one-shot grant；refused 另寫 `refused[id]={answer,scope,refusedAt,note}` ledger，供 scan 排除 |
| `$MAIN_WT_PATH/HANDOFF.md` | granted 刪對應子段；refused 保留子段並標明 blocked/refused scope，但它不回填 awaiting |

`note` **MUST 逐字記 Charles 說的話**（含他在選項外補的說明），**NEVER** 記成你的複述——下一輪
是新 context，複述會把他的但書弄丟。

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

- 正要進 Step 3 分類，而 state 的 `awaiting[]` 非空、且本輪是 attended
- 正要呼叫 `AskUserQuestion` 問一條你寫得出 `(推薦)` 的 item（(a) 沒跑或沒跑完）
- 已經收到 Charles 的答案，但還沒寫 `decisions` 就開始 dispatch
- 本輪是 `--unattended`，而你正要因為佇列非空寫 `stoppedReason`
- 佇列裡的某條被你拿來當「其他 item 也可以 skip」的理由
