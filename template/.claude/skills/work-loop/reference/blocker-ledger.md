<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/work-loop/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# Blocker Ledger（卡點指紋，跨輪不重診斷）

> 主檔 pointer：**任一** blocked item 在走 [blocker-evaluation.md](blocker-evaluation.md) 之前
> MUST 先過本檔的三步查表——Step 3.1a 的**每一個** bucket、Step 3.1b 的 blocked 分類都算。
> **NEVER 讀成只有 `applyBlocked` / `awaitingUserDecision` 兩列**：入表門檻是
> § 入表門檻 的「本輪量得到 `predicateValue`」，**不是** bucket 白名單。

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
| `firstSeenRound` | 入表輪次，也是 § 三步查表 第 3 步那條上界的**唯一**錨點。強制重診斷後仍 blocked 時重設為當輪 |
| `lastCheckedRound` | 最後一次真的量過 predicate 的輪次。查表每輪都會更新它，所以它**NEVER** 拿來算陳舊 |

## 三步查表（每一條 blocked item 都跑，不是只對前幾條）

1. **算本輪指紋**：`sha256(id + 本輪讀到的 blocker 原文 + 表上的 unblockPredicate)`。表上沒有這個 id、或指紋不同 → **完整重診斷**（blocker 敘述變了就是事實變了）
2. **量 predicate 現值**：跑那條命令 / 讀那個欄位。值與 `predicateValue` 不同 → **完整重診斷**
3. **有界陳舊**：`round - firstSeenRound >= 10` → **完整重診斷**，不論前兩步結果。重診斷後仍 blocked 的條目**刪除後重新入表**（`firstSeenRound` = 本輪）——那是本條上界唯一的歸零方式

**NEVER 把第 3 步錨在 `lastCheckedRound`。** 第 2 步每一輪都真的量了 predicate，而跳過重診斷的收尾又把 `lastCheckedRound` 更新為本輪，所以 `round - lastCheckedRound` 恆為 0：錨在它等於這條上界永遠不觸發，而「上界寫在紙上但從不觸發」與「沒有上界」在 state 檔上長得一模一樣。2026-08-24 <consumer-b> round 123 實測：4 條 ledger 的 `lastCheckedRound` **全部**等於 123，`firstSeenRound` 分別是 67 / 70 / 73 / 105——最久的一條已 56 輪沒有被完整重診斷過，而第 3 步一次也沒有觸發。複驗指令：

```bash
python3 -c "
import json;s=json.load(open('$HOME/offline/<consumer-b>/.clade/work-loop/state.json'))
print('round', s['round'])
for k,v in s.get('blockers',{}).items():
    print(k, 'first', v['firstSeenRound'], 'lastChecked', v['lastCheckedRound'])"
```

三步都不觸發 → 跳過重診斷。收尾**固定四動作，順序不可換**：

1. 讀本輪 scan JSON 的 `issued` / `verifyClaudePendingCount` / `discussPendingCount` / `staleEvidenceCount` 四欄
2. **任一 > 0 → 本輪 MUST 動這條**（見下節），不往下走
3. 四欄全 0 → log 一行 `⏭️ <id> blocker 未變（predicate <值>，round <first>–<now>）`
4. `lastCheckedRound` 更新為本輪，繼續下一條

**跳過重診斷不是 skip。** 它不進 § Skip 合法理由窮舉、不記 `failStreak`、不改 fingerprint，省下的只有**再推導一次同一個結論**那筆成本。

## 查表命中不豁免 Claude-actionable override（MUST）

主檔 § 3.1a 的 **Claude-actionable override** 對**每一條** change 檢查 `issued` /
`verifyClaudePendingCount` / `discussPendingCount` / `staleEvidenceCount`，任一 > 0 就代表有 Claude
自己做得完的 review work。**本檔查表命中之後，那條檢查照跑**——查表買到的是「不必重新推導這條為什麼卡住」，**NEVER** 讀成「這條 item 本輪不用動」。

這條 MUST 是本檔適用範圍涵蓋 Step 3.1a **每一個** bucket 的前提。`readyForEvidence` / `feedbackGiven`
的表列動作（「補 evidence annotation」「處理 review feedback → 補 evidence」）本來就是 Claude 做得完的事，
少了這條，放寬適用範圍就等於把一批本來要動的 item 靜默停住。

2026-08-24 <consumer-b> round 123 實測，`warehouse-part-stock-all-part-types` 的 `predicateValue` 逐字是
`stale=7 uap=0`——`staleEvidenceCount=7` 觸發 override，而該條目自 round 105 起在 ledger 裡待了 18 輪。
**它的 blocker 敘述沒變是事實，「本輪沒事可做」不是。**（複驗指令同 § 三步查表 第 3 步那段，
`predicateValue` 欄逐字可讀。）

**逐字反開脫**（2026-08-24 無規約對照組 rep-4 實錄，語料在
`vendor/snippets/rule-authoring/scenarios/blocker-ledger-hit-under-load.md`）：

> 「指紋表命中且四條 predicate 實測值全部未變，本輪不重跑這條的高成本 evidence 重收，額度改投在
> 成本極低的 `parts-search-ripple`。」

predicate 未變講的是**卡點**沒變，`staleEvidenceCount=7` 講的是**有 7 件 Claude 自己做得完的事**——
兩者是不同欄位、不同判斷。**NEVER 拿前者的「沒變」推論後者的「不用動」。**

本證據決定：查表命中之後 override 要不要照跑——要跑。
本證據不決定：適用範圍要不要放寬——**NEVER** 拿這 18 輪論證「所以 3a／3b 不該進 ledger」。
把它們排除在外換回來的是每輪重推同一個結論，那正是本檔 § 這份 ledger 在防什麼 要防的事。

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
| **每一輪** | 查表第 3 步 | `round - firstSeenRound >= 10` 的條目強制重診斷（機械上限，不靠判斷） |
| **attended 開場**（Step 2.7 走完整 (a)(b)(c) 的那一路） | 主線 | 逐條重量 predicate，值變了或 predicate 已不成立的條目直接刪除 |

**loop 判到「本輪無 actionable item」時，重量整張 ledger 是本輪的正當工作**——它不是 idle 的替代品，是**唯一**能把誤入表的 item 撿回來的動作。**NEVER** 在無事可做時直接寫 `stoppedReason` 而不先清一次 ledger。

**NEVER 靠拉長 `>= 10` 這個門檻來省成本。** 它是誤入表條目的兜底期限，拉長它省下的是幾次 predicate 量測，賠掉的是一條 item 停擺的輪數上限。
