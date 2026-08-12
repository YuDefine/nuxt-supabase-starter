<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/work-loop/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# Blocker & Decision Evaluation

> 本檔從 SKILL.md § 3i / § 3j 搬移，原文逐字保留。主檔 pointer：「bucket 為 `applyBlocked` 時 MUST 先完整讀本檔 § 3i；bucket 為 `awaitingUserDecision` 時 MUST 先完整讀本檔 § 3j」。

**進本檔任一條判定之前，該 item MUST 已經過 [blocker-ledger.md](blocker-ledger.md) 的三步查表且沒命中。** 命中查表的 item 本輪不進本檔——它上一輪已經照本檔判過，而解除條件的實測值沒有變。

## 批次蒐證（3i + 3j 合計 ≥4 條時）

本輪 `applyBlocked` + `awaitingUserDecision` 合計 ≥4 條 → 逐條讀 tasks.md / HANDOFF 就是 [dispatch-topology.md](dispatch-topology.md) § 主線即時組的 pre-scan 前置判定 要攔的形狀。

**MUST** 批次派**一個** pre-scan 收齊事實表（change 名 / tasks.md 行號 / blocker 或決策描述原文 / 引用的依賴 change 名），主線拿表做鮮度判定與自主解決判斷。**判定本身（下方 3i / 3j 各表）NEVER 外派。**

合計 <4 條時逐條定點讀，照舊。

### 3i. applyBlocked（主動評估 blocker）

不再無條件跳過。先讀 blocker 內容，判斷 blocker 是否仍 valid：

1. **讀 blocker 描述**：從 tasks.md 的 `[blocked]` annotation 或 HANDOFF 對應條目取 blocker 原因。

2. **Blocker 鮮度判定**：

   | Blocker 類型 | 判定方式 | 動作 |
   | --- | --- | --- |
   | 「等 X 完成」且 X 已在本輪 shipped / archived | blocker 已解除 | **直接 unblock + dispatch**（移除 `[blocked]` annotation，走 3f） |
   | 「等 dependency Y change」且 Y 在 scan 中 bucket=`done`/`ready` | dependency 已滿足 | **直接 unblock + dispatch** |
   | 「等外部 API / 第三方」 | 無法自動驗證 | **AskUserQuestion**（`--unattended` 時改 log `⏭️ <change> blocked on external: <reason>, skip` + skip）：「`<change>` blocked on `<reason>`，blocker 解了嗎？」[1] 已解除，接手推進 / [2] 仍 blocked，跳過 |
   | 「等 user 測過 / 等 production data」 | 需 user 確認 | **AskUserQuestion**（`--unattended` 時改 log + skip）同上 |
   | blocker 描述模糊 / 空白 | 不明 | **AskUserQuestion**（`--unattended` 時改 log + skip）：「`<change>` 標為 blocked 但原因不明，要推進嗎？」 |

   **歸因無證據即重查（hard rule）**：blocker 敘述把成因歸給另一條 workstream（「別 session 動過 X」「等 Y 收斂」），而該敘述**沒附「怎麼驗的」** → 本輪一律當**未驗證**重查，**NEVER** 因為「上面寫著」就沿用它繼續延後。判準不是「這個歸因對不對」（那要查才知道），是**這個歸因有沒有各自的證據**。一句話涵蓋 ≥2 個獨立 gate / blocker、而證據只有一份時間相關性 → 必重查（實錄：`docs/pitfalls/2026-08-11-simultaneously-red-gates-share-one-attribution.md`）。

   鮮度判定過了**不蘊含**這條也過：新鮮的歸因照樣可以是沒驗過的歸因，兩者各自判。

3. User 回答「仍 blocked」→ 跳過 + log。User 回答「已解除」→ unblock + dispatch。

4. **Impl blocked ≠ review items blocked（hard rule）**：即使 impl 仍 blocked，**MUST** 檢查 `## 人工檢查` 區是否有 Claude-actionable items（`issued > 0` / `verifyClaudePendingCount > 0` / `discussPendingCount > 0` / review-gui 顯示「🤖 等 Claude 接手」）。有 → 走 § 3a/3b/3c 處理 review items，**NEVER** 因為 impl blocked 就整條 change 跳過。人工檢查 lifecycle 獨立於 impl lifecycle。

   **為什麼**（2026-07-21 <consumer-a> 實證）：`ops-deploy-safety` bucket=`applyBlocked`（4.1-4.3 卡 TD-002），但 review-gui 顯示「🤖 等 Claude 接手」有 1 個 Claude-actionable discuss item。loop 看到 `applyBlocked` 就整條跳過，review-gui 的 Claude-ball 永遠沒人接。

### 3j. awaitingUserDecision（自主解決優先，只有商業決策才問 user）

不再無條件跳過。先讀決策需求，**自主嘗試解決**，只有真正的商業決策才問 user：

1. **讀決策描述**：從 tasks.md 或 HANDOFF 取待決策內容。

2. **自主解決嘗試（MUST 先跑此步，NEVER 跳到 Step 3）**：

   | 決策類型 | 辨識方式 | 自主處理 |
   | --- | --- | --- |
   | 未實作的 phase | tasks.md 有 `[not-started]` / `[planned]` phase 被標為 awaiting decision | 不是決策 — unblock + dispatch spectra-apply 繼續實作 |
   | 實作 findings（seed / UI / code / data） | tasks.md 有 `[finding]` 或 blocker 描述是技術問題 | 能修 → dispatch apply 修；複雜 → 登 TD-NNN + unblock 繼續推進 |
   | Design Review / evidence / 驗證類 phase | 待決項是「排程」「何時跑」某個標準 spectra phase | 不是決策 — 直接跑該 phase（Design Review 直接 dispatch，不問排程） |
   | 技術選型（A or B） | 待決項有具體技術選項、無商業影響 | 選最簡方案 + 在 tasks.md 記 `[decision: <選項> — work-loop 自決: <一行理由>]` |
   | 商業決策（pricing / scope / UX trade-off / 客戶需求確認） | 無法從 code / spec 推導、需 domain knowledge | → Step 3 |

   **自主解決後**：移除 `awaitingUserDecision` 標記 → 該 change bucket 位移成 `applyInProgress` → 走 § 3f dispatch。

3. **只有「商業決策」才 AskUserQuestion**（`--unattended` 時改 log + skip）：

   ```
   <change> 等待你的決策：
   <決策問題描述>

   [選項從 tasks.md / HANDOFF 內容萃取]
   ```

4. 自主解決或 user 拍板後 → 把決策寫入 tasks.md → dispatch 繼續推進。

**核心原則**：work-loop 的自主模式承諾「能自主決策的自主完成」。未實作的 phase、技術 findings、標準 spectra phases（Design Review / evidence collection）**全部屬於自主範疇**，NEVER 因為被標記 `awaitingUserDecision` 就當真 — 先判斷是否真的需要 user、還是上一輪 apply 過度保守地標記了。

**反例（<consumer-b> 2026-07-21 `/change-loop turbo`）**：(1) 未實作的 phase 被標為 awaiting-user-decision → 應直接 dispatch apply；(2) 技術 findings（seed 歸屬 + UI wiring）被標為 blocker → 應自行修或登 TD；(3) Design Review 被標為「需排程」→ 應直接跑。三項全部可自主解決，loop 不應停下。
