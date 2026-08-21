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
   | 「需要看畫面 / 需已登入的視覺工作階段 / 需 runtime e2e 斷言」 | **先跑下方 § 視覺 blocker 的 capability probe**，NEVER 憑敘述判定 | probe 三條全綠 → **dispatch 收 evidence**（不是 blocker）；任一條紅 → 用**那一條 predicate 的原文**當 blocker 落 packaging |
   | blocker 描述模糊 / 空白 | 不明 | **AskUserQuestion**（`--unattended` 時改 log + skip）：「`<change>` 標為 blocked 但原因不明，要推進嗎？」 |

   **歸因無證據即重查（hard rule）**：blocker 敘述把成因歸給另一條 workstream（「別 session 動過 X」「等 Y 收斂」），而該敘述**沒附「怎麼驗的」** → 本輪一律當**未驗證**重查，**NEVER** 因為「上面寫著」就沿用它繼續延後。判準不是「這個歸因對不對」（那要查才知道），是**這個歸因有沒有各自的證據**。一句話涵蓋 ≥2 個獨立 gate / blocker、而證據只有一份時間相關性 → 必重查（實錄：`docs/pitfalls/2026-08-11-simultaneously-red-gates-share-one-attribution.md`）。

   鮮度判定過了**不蘊含**這條也過：新鮮的歸因照樣可以是沒驗過的歸因，兩者各自判。

3. User 回答「仍 blocked」→ 跳過 + log。User 回答「已解除」→ unblock + dispatch。

4. **Impl blocked ≠ review items blocked（hard rule）**：即使 impl 仍 blocked，**MUST** 檢查 `## 人工檢查` 區是否有 Claude-actionable items（`issued > 0` / `verifyClaudePendingCount > 0` / `discussPendingCount > 0` / review-gui 顯示「🤖 等 Claude 接手」）。有 → 走 § 3a/3b/3c 處理 review items，**NEVER** 因為 impl blocked 就整條 change 跳過。人工檢查 lifecycle 獨立於 impl lifecycle。

   **為什麼**（2026-07-21 <consumer-a> 實證）：`ops-deploy-safety` bucket=`applyBlocked`（4.1-4.3 卡 TD-002），但 review-gui 顯示「🤖 等 Claude 接手」有 1 個 Claude-actionable discuss item。loop 看到 `applyBlocked` 就整條跳過，review-gui 的 Claude-ball 永遠沒人接。

### 視覺 blocker 的 capability probe（unattended 一樣要跑）

「需要看畫面」**不是**一個 blocker 類型，它是一個**尚未量測的假設**。fleet 已經有把它自動化的整條
路徑（dev-login route → dev server → `pi-dispatch-screenshot-verify.ts`），所以在跑完下面五條之前
**NEVER** 把這種 item 判成 `blocked-attended-only`、**NEVER** 寫「需 attended 視覺工作階段」進
HANDOFF：那句話描述的是**沒有量測**，不是量測結果。

| # | probe | 指令 | 紅了代表什麼 |
| --- | --- | --- | --- |
| 1 | dev-login route 存在 | `node ~/offline/clade/scripts/audit-dev-login-adoption.ts --consumer . --json` → 該 consumer `status == "PRESENT"` | `MISSING` → 真缺口。修法是 scaffold dev-login（[[manual-review.backend]] § Dev-login route missing → scaffold-first），**那是可自主推進的工作**，不是 attended 條目 |
| 2 | dev server 起得來 | 依 [[proactive-skills.dev-server-spawn]] 起，拿到 `http://localhost:<port>` | 起不來 → 記實際 stderr 當 blocker，那通常是環境債不是視覺債 |
| 3 | dispatcher 可用 | `command -v pi` 有；`CLADE_FORCE_CLAUDE_SCREENSHOT` 未設 | 沒有 → 機械缺口，落 `notes`，**NEVER** 改派 Claude subagent 自跑 playwright／agent-browser 取代 dispatcher（唯一入口紀律見 [[review-gui-surface]] § Hard rule） |
| 4 | **seat 進得去** | `node ~/offline/clade/vendor/scripts/pi-seat-probe.ts --provider xai --model grok-4.6` → exit 0 | exit 1 → 那一列的 seat 進不去。**NEVER** 讀成「dispatcher 壞了」或「視覺工作做不到」——載具進不去是**帳務／授權**擋點。它 stdout 的第一行**逐字**就是 blocker 文字（原文帶解除條件），**NEVER** 改寫成形容詞 |
| 5 | **items.json 組得出來** | 對每個 item 都要有 `id` / `known_url` / `expected_dom` / `screenshot_path`，assertion-bearing 的還要 `ready_signal` | 組不出來 → item 描述沒有機械可判的斷言，那是 **item 品質缺口**（回去補 tasks.md 的斷言），不是視覺 blocker |

五條全綠 → 照 [[review-gui-surface]] § 收 evidence 走
`node ~/offline/clade/vendor/scripts/pi-dispatch-screenshot-verify.ts --change <name> --consumer-path . --dev-server-url <url> --items-json <items.json>`，
主線只消費它回的 JSON 摘要。**這條路徑本來就是無人值守設計的**（Pi grok seat，不需要人在座位上）。

任一條紅 → packaging 的 blocker 欄 **MUST 逐字寫那一條 probe 的失敗輸出**（哪一條、跑了什麼、回了什麼）。
**NEVER** 寫「需 attended」這種形容詞——形容詞每一輪都會被重新「發現」一次，而 predicate 有解除條件、
可以進 [blocker-ledger.md](blocker-ledger.md) 查表，下一輪不必重判。

#### 2026-08-22 端到端實測（<consumer-k>）——probe 4 / 5 是怎麼長出來的

首版只有 probe 1–3，**三條全綠之後那一步從未量過**。2026-08-22 在 <consumer-k>
（`shape: canonical`、`emailRequired: false`、`stackHint: libsql-drizzle`）跑完整鏈路，量到的是：

- **鏈路本身是通的**：probe 1–3 全綠 → dev-session 起 3050 → 手組 items.json（2 個真 `[verify:ui]` item）
  → dispatcher → 回 parseable JSON 摘要 → 落 `.spectra/verify-ui-dispatch-ledger.jsonl` receipt，**全程無人介入**。
  dev server 生命週期、loopbackOnly、`_exploration/` 診斷截圖產出都沒有額外擋點。
- **擋點在 seat，不在鏈路**：`command -v pi` 綠，但 `xai/grok-4.6` 回
  `403 "You have run out of credits or need a Grok subscription."`，整趟 9.5 秒死掉、
  沒有 receipt、沒有截圖，摘要是 `UNCERTAIN(dispatcher-error)`。**probe 3 量的是 binary 在不在，
  不是 seat 進不進得去**——這正是 probe 4 存在的理由。
- **文件上的配額 fallback 對這一列不成立**。兩層各自斷：`pi-runtime.ts` 的 `QUOTA_ERROR_RE`
  不吃 xAI 的 `run out of credits` 措辭 → `quotaError` 為 null → 沒有 exit 4，
  而 `pi-dispatch-screenshot-verify.ts` 本來就沒讀 `quotaError`；就算兩層都補好，
  `grok-cursor` 跑在 bwrap `--tmpfs $HOME` 裡，實測 `agent-browser` 回 **exit 127**——
  **cursor 池結構上收不了截圖**。所以 probe 4 紅掉時 **NEVER** 建議「降到 grok-cursor 重試」。

**probe 4 紅 ≠ 改派 Claude 自跑瀏覽器。** 唯一入口紀律不因為 seat 沒錢而放寬
（見 [[review-gui-surface]] § Hard rule）。它是一條 predicate 清楚、解除條件由人執行的 blocker：
逐字寫「`xai/grok-4.6` 回 403 out of credits，seat 需補額度」進 packaging，下一輪查表即可，不必重判。

**真物理限制長什麼樣**：需要**人的眼睛做美感／可用性判斷**（「這個間距看起來對嗎」）、需要**人的授權**、
需要**不可逆的 prod 動作**。這三類 probe 全綠也仍是 attended——但它們的 blocker 文字同樣要寫成 predicate
（「需 Charles 對 3 張截圖做 en-US 文案判讀」），而且 **MUST 附上已經自動收好的 evidence 路徑**：把人要做的事
從「開一個 dev session 自己點」縮到「看三張圖回一句」，那才是 packaging 的意義。

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
