<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/work-loop/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# Blocker Ledger（卡點指紋，跨輪不重診斷）

> 主檔 pointer：Step 3.1a 的 `applyBlocked` / `awaitingUserDecision` 兩列、Step 3.1b 的 blocked 分類，
> 在走 [blocker-evaluation.md](blocker-evaluation.md) 之前 MUST 先過本檔的三步查表。

## 這份 ledger 在防什麼

runner 每輪是全新 process，**上一輪診斷過什麼完全不在 context 裡**。所以同一批卡住的 item 每輪被重新撿起、重新讀 tasks.md／HANDOFF、重新推導出同一個「還是卡住」的結論。2026-08-12 量測：<consumer-b> 31 個 substantive round 裡有 27 輪提到 blocker，而那批 blocker 的解除條件整段期間沒有變過。

[blocker-evaluation.md](blocker-evaluation.md) 管的是**怎麼判**一個 blocker 還算不算數；本檔管的是**這輪要不要重判**。兩者不互相取代：查表命中就跳過重判，沒命中就照那份逐條判。

本證據決定：同一個 blocker 要不要每輪重新診斷——不要，改成查表。
本證據不決定：blocker 判定的鬆緊——鮮度判定、歸因無證據即重查那幾條照舊逐條跑，**NEVER** 拿本檔論證「blocker 可以少查一點」。

## 落點：state.json 的 `blockers` 欄，NEVER 另開檔案

ledger 是 `.clade/work-loop/state.json` 的一個欄位，寫入走 Step 7.3 既有的 temp → 驗 → 備份 → rename。另開一個檔要自己長出同一套原子寫入、`.bak` 還原與損毀判定，而那三件的失敗都是靜默的。

```json
"blockers": {
  "TD-402": {
    "fingerprint": "sha256:9f2c…",
    "blocker": "等 supabase migration 20260810_add_index 進 production",
    "unblockPredicate": "supabase migration list --linked | grep 20260810_add_index 顯示 applied",
    "predicateValue": "not-applied",
    "firstSeenRound": 12,
    "lastCheckedRound": 18
  }
}
```

| 欄位 | 寫什麼 |
| --- | --- |
| `fingerprint` | `sha256(<item id> + <blocker 原文> + <unblockPredicate>)`。三者任一改變就是新指紋 |
| `blocker` | 本輪從 tasks.md `[blocked]` annotation 或 HANDOFF 讀到的**原文逐字**，NEVER 改寫成摘要 |
| `unblockPredicate` | **一條可觀察 predicate**：一條命令、一個 scan JSON 欄位、一個檔案存不存在。見下方入表門檻 |
| `predicateValue` | 上一次實際量到的值**逐字**。查表比的就是它 |
| `firstSeenRound` / `lastCheckedRound` | 入表輪次 / 最後一次真的量過 predicate 的輪次 |

## 三步查表（每一條 blocked item 都跑，不是只對前幾條）

1. **算本輪指紋**：`sha256(id + 本輪讀到的 blocker 原文 + 表上的 unblockPredicate)`。表上沒有這個 id、或指紋不同 → **完整重診斷**（blocker 敘述變了就是事實變了）
2. **量 predicate 現值**：跑那條命令 / 讀那個欄位。值與 `predicateValue` 不同 → **完整重診斷**
3. **有界陳舊**：`round - lastCheckedRound >= 10` → **完整重診斷**，不論前兩步結果

三步都不觸發 → 跳過重診斷：log 一行 `⏭️ <id> blocker 未變（predicate <值>，round <first>–<now>）`、把 `lastCheckedRound` 更新為本輪、繼續下一條。

**跳過重診斷不是 skip。** 它不進 § Skip 合法理由窮舉、不記 `failStreak`、不改 fingerprint。它跟「這條 item 本輪不動」是同一個結果，差別只在**沒有再付一次診斷成本**。

## 入表門檻：`predicateValue` 是必填，填不出來就不入表

`unblockPredicate` 與 `predicateValue` 兩欄都是 REQUIRED：**本輪沒有實際量到一個值，這條就沒有入表所需的欄位**。「等 Charles 有空看」「等上游修好」「等這塊穩定下來」寫不出可量的值，所以它們填不滿條目——不是被禁止，是不成立。

| 可觀察 predicate | 動作 |
| --- | --- |
| 寫得出一條命令 / 一個 scan 欄位 / 一個檔案存在性，且本輪真的量到值 | 入表，`predicateValue` 記量到的值 |
| 寫不出來，或寫得出但本輪量不到值 | **不入表**。這條 item 下一輪照樣完整診斷——那是正確行為，不是缺陷 |
| blocker 解除、或該 item 已不在本輪 scan | **從表中刪除**該條目 |

合格 / 不合格對照（`<>` 是佔位符，逐字寫進 ledger 就等於沒有 predicate）：

- ✅ `gh pr view <n> --json state 回 MERGED`
- ✅ `scan JSON 的 spectra entry <name> bucket 不再是 applyBlocked`
- ✅ `<repo>/supabase/migrations/<file> 存在`
- ❌ `上游修好了`
- ❌ `Charles 確認過`
- ❌ `這塊重構完成`

## 清 ledger 是正當工作，不是雜務

ledger 寫得太寬時的失敗是**靜默**的：item 不會消失、不會報錯，只是再也不被診斷。所以它需要一個不依賴「有人想起來」的出口，兩個都要有：

| 時機 | 誰做 | 做什麼 |
| --- | --- | --- |
| **每一輪** | 查表第 3 步 | `lastCheckedRound` 超過 10 輪的條目強制重診斷（機械上限，不靠判斷） |
| **attended 開場**（Step 2.7 走完整 (a)(b)(c) 的那一路） | 主線 | 逐條重量 predicate，值變了或 predicate 已不成立的條目直接刪除 |

**loop 判到「本輪無 actionable item」時，重量整張 ledger 是本輪的正當工作**——它不是 idle 的替代品，是**唯一**能把誤入表的 item 撿回來的動作。**NEVER** 在無事可做時直接寫 `stoppedReason` 而不先清一次 ledger。

**NEVER 靠拉長 `>= 10` 這個門檻來省成本。** 它是誤入表條目的兜底期限，拉長它省下的是幾次 predicate 量測，賠掉的是一條 item 停擺的輪數上限。
