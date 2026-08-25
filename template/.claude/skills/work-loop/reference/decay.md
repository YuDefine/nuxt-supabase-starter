<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/work-loop/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# Decay 偵測 —— D4–D6 的成因與 D4 的部分寫入白名單

D4–D6 的分流表**留在 SKILL.md Step 1**：那張表每一輪都要判，搬過來等於每一輪都得開這個檔。
本檔收的是「命中之後怎麼寫」與「為什麼這樣判」。

## 訊號的邊界

> **2026-08-13 TD-495 起，「`round` 與 HANDOFF 記載輪次不一致」不再是訊號。** HANDOFF 不再 render loop 進度（Step 7.2），第二份現況不存在了，也就沒有「兩邊不一致」這回事。真正的停滯由 `runner.sh` 的 no-progress 網接（`exit=0 且 round 未前進` 連續 2 輪 → 自行停）。**NEVER** 為了恢復這個訊號把進度寫回 HANDOFF —— 兩份現況正是 2026-08-11 <consumer-b> 空轉近 7 小時的根因。
**這個訊號在 runner child 身上永遠不代表 decay。** decay 指的是**同一個 process 的 context 被 auto-compaction 壓掉**——只有 in-session `/loop` 有這個失敗模式。runner child 每輪是 `claude --print` 起的**全新 process**，context 從零重建、狀態只從 state 檔讀，結構上不可能 decay。所以在 child 身上，訊號命中**一定**是「上一輪 bookkeeping 沒收尾」，而那需要的是**自癒或忽略**，不是中止。無條件中止會讓**每一輪**都在 Step 1 停住、零 scan 零 dispatch，直到 runner 的 no-progress 條件把自己停掉——而那個停法在 log 上跟正常收工幾乎無法區分（2026-08-11 <consumer-b> 實測：連續空轉近 7 小時，所有健康訊號正常，靠人工介入才發現）。
**列有代號（D4–D6），其他段落引用時 MUST 用代號、NEVER 用「第 N 列」**——列序會隨增補改變，序號指標會在改動後指到別列而沒有任何訊號。**D1–D3 已於 2026-08-13 隨 HANDOFF 輪次訊號一併廢除，代號 NEVER 回收再用於新列**（舊 sessionNote 與 log 仍寫著它們，回收會讓歷史紀錄指到不同語義）。


## D4 的部分寫入白名單（唯一容許在 7.2 失敗後仍寫 state 的路徑）

D4 與 Step 7.2 的「寫入失敗時 NEVER 繼續寫 7.3」不衝突，因為它寫的**不是** 7.3 的 bookkeeping。**MUST 只寫這兩個欄位、其餘一律不動**：

| 欄位 | 寫什麼 |
| --- | --- |
| `roundEndReason` | `handoff-write-failed: <實際錯誤逐字>`，**NEVER** `context-decay` |
| `stoppedReason` | **只在連續第 2 輪命中時**寫 `handoff-write-failed ×2: <錯誤>`（child 自己寫 `stoppedReason` 合法且有效，per [run-modes.md](run-modes.md)） |

**NEVER** 在 D4 路徑動 `round` / `fingerprint` / `fingerprintUnchangedRounds` / `inFlight` / `packaged` / `awaiting` / `guardrailsAck`——本輪什麼都沒做完，bump 它們等於謊報進度。

**「連續第 2 輪」的判定 predicate**（不是憑印象）：Step 1 讀進來的 state，既有 `roundEndReason` 以 `handoff-write-failed:` 起頭，**且**冒號後的錯誤字串與本輪這次相同 → 這是第 2 輪。

**`round` 不 bump 的連帶效果要講清楚，NEVER 反過來說**：D4 不動 `round`，所以 runner 的 `exit=0 且 round 未前進` 網會在**連續 2 輪**後印 `== stop: state 連續 2 輪未前進` 自行停掉（`runner.sh` 的 no-progress 判定）——**不會**空轉到 `--max-rounds`。`stoppedReason` 在這裡買的是**可診斷性**：沒有它，log 只說「state 未前進」，沒說是寫入權限壞了；有它，停止原因直接寫在 state 檔裡。它是第二道網，不是唯一那道。


| Red Flag | 立即動作 |
| --- | --- |
| 身為 runner child，正在寫 `roundEndReason: "context-decay"` | 停手。child 不可能 decay，回上表判身分與方向 |
| 看到輪次不一致就準備「把 HANDOFF 對齊到 state」，還沒判方向 | 停手。`state.round` < HANDOFF 時這個動作會把較新的敘事蓋上錯的輪次 |
| 「兩邊輪次不一致、狀態不可信，安全起見先停一輪」 | 停止這個推論。安全中止在 child 身上不是保守選擇，是讓 loop 永久空轉 |
| 自癒時順手把下方 In Progress / Next Steps 各段「更新成現況」 | 停手。本輪 scan 都還沒跑，那些「現況」是編的 |

**`roundEndReason` 與 `stoppedReason` 是兩件事，寫錯會讓 loop 提早死掉**：

| 欄位 | 語義 | runner 的反應 |
| --- | --- | --- |
| `roundEndReason` | **這個 process** 該結束（context 到頂、item cap 用完） | 起下一個全新 process 繼續 |
| `stoppedReason` | **整個 loop** 該停（真的做完 / fingerprint 三輪不變 / 連續失敗） | 不再起新 process |

context-decay 與 handoff-write-failed **永遠**寫 `roundEndReason`，**NEVER** 寫 `stoppedReason`——唯一例外是 D4 的「同一寫入錯誤連續第 2 輪」，那時**兩個都寫**（`roundEndReason` 記本輪為何結束、`stoppedReason` 記整個 loop 不該再起新 process）。

**兩個中止值語義不同，寫錯會把後續診斷帶去錯的方向**：

| `roundEndReason` 值 | 語義 | 只在什麼身分下合法 | 讀到它該往哪查 |
| --- | --- | --- | --- |
| `context-decay` | **這個 process 的 context 被壓縮**，狀態記憶不可信 | 只有 in-session `/loop`。runner child **NEVER** 寫這個值 | 起 loop 的方式（該改用 runner） |
| `handoff-write-failed: <錯誤>` | 狀態記憶正常，但 **HANDOFF 寫不進去**（permission / 路徑 / 工具錯誤） | 任何身分 | 寫入權限與 Step 7.1 路徑，**不是** context |

---
