---
description: 高擴散半徑改動（跨 consumer 共用 SoT / migration / auth 路徑 / 共用 util）在 publish 或 commit 前要派 fresh-context checker subagent 複核——只讀 diff + spec，產出 PASS/FAIL + finding；gate 全綠是派 checker 的前置條件不是複核項；其餘任務不派
paths: ['rules/core/**', 'vendor/scripts/**', 'capabilities/core/**', 'claude-md/**', '.claude/rules/**', '.claude/skills/**', '**/migrations/**', 'shared/**', 'packages/*/shared/**', 'server/utils/**', 'packages/*/server/utils/**']
---
<!-- Clade native rule; source: rules/core/checker-subagent.md; edit canonical source -->

<!-- clade-targets: claude,codex,cursor -->
<!-- clade-adapters: claude,codex,cursor -->

# Checker Subagent（高擴散半徑改動複核）

## Iron Law — 擴散半徑決定派不派

```text
改動會落到多個 consumer、或會影響沒被改到的程式碼時，
寫它的 agent 不能是唯一判定它可以散播的人。
```

命中下表 REQUIRED 列時，主線在 publish / propagate / commit 之前要派一個 fresh-context checker subagent。實際工具與參數由該 runtime 的 checker adapter 指定；checker 不繼承 maker 的對話。無法建立獨立上下文時回報能力缺口，保留未通過狀態。

Fresh context 與跨模型是兩個欄位：同模型的新上下文可以提供獨立複核，但不能據此宣稱已完成跨模型裁決。另有跨模型 gate 時仍依其指定模型與證據要求執行。

**其餘任務不派 checker**——模型會自行捕捉並修正自己的錯誤，額外複驗只是把同一份判斷跑第二次。

## 何時 REQUIRED

| 情境 | checker | 判準 |
| --- | --- | --- |
| 動跨 consumer 共用 SoT（`rules/core/` 本體 / `vendor/` 散播層 / `hub-*` skill / `claude-md/` 注入段） | **REQUIRED** | 一炸全 fleet 同時撞 |
| 動高擴散半徑 consumer 資產（DB migration / auth 路徑 / 多處 import 的共用 util / 對外 API contract） | **REQUIRED** | 錯了會波及沒被改到的程式碼 |
| 其餘一切（≥3 phase change / `effort: high`+ / 新 endpoint / 邏輯分支 / refactor / typo） | **不需要** | 擴散半徑止於本次 diff；模型自行捕捉並修正 |

**說不清是哪一格時的判準**：問「這個改動如果錯了，會不會影響到我**沒有改**的檔案或**別的** repo？」——答案是「不會」就不派。任務跑了幾個 phase、花了多久、有多難，都跟這個問題無關。

## 派 checker 的前置條件（MUST 先滿足）

派 checker **之前**，[[verify-gate-chain]] 的 L0–L2 要已經全綠（lint / typecheck / test 全 exit 0）。gate 紅 → 先修，修完再派。不要把 gate output 塞進 checker brief 當判定材料。

checker 的模型維持既有品質門檻；選擇方式由 runtime adapter 指定。沒有已核准的能力／模型組合時，保持 gate 未完成。

## Checker brief 模板（REQUIRED 欄位）

checker subagent 的 prompt **只**含以下兩項，不要附 maker 的實作敘事、「我為什麼這樣改」、嘗試過的選項：

```text
你是 checker，對這份改動做獨立複核。你沒有寫這份 code，只根據以下 artifact 判定。

1. DIFF（完整 git diff，改了什麼）:
   <git diff 全文>

2. SPEC（這份改動本該滿足的驗收標準 / spec 摘錄）:
   <tasks/<slug>.md 或 spec 的 acceptance criteria 段>

輸出 PASS 或 FAIL，FAIL 時附 finding list（格式見下）。不要幫忙改 code，只複核。
```

附上 maker 的推理過程 = 把 checker 拉進同一套合理化，fresh context 失效。

## PASS / FAIL 判準

checker 一律輸出 PASS 或 FAIL，四條全滿足才 PASS：

1. **scope 吻合**：diff 落在 spec 宣告的 scope 內，無 scope creep（cross-ref [[subagent-scope-discipline]]）
2. **擴散面已檢查**：diff 觸及的每個共用符號 / 契約，其**未被改動的**呼叫端仍成立——改 migration → 既有查詢仍對；改共用 util → 每個 import 端仍對；改 rule 措辭 → 引用它的其他 rule 仍一致。這條是 fresh context 唯一能提供、maker 最看不到的東西
3. **無漏做**：spec 要求的每一項在 diff 都有對應實作，無 missing requirement
4. **無可讀出的 bug**：diff 本身讀不出明顯邏輯錯 / off-by-one / 反向條件 / 缺 error path

任一條不滿足 = FAIL。checker 對**每一筆** finding 都用以下格式（沿用 [[checker-contract]] § 違反回報格式）：

```text
- [<blocker|warn>] <path>:<line|N/A>
  finding: <觀察到的問題>
  spec-ref: <對應 spec 哪一條 / 或「scope creep：spec 未要求」>
  action: <maker 要做的最小修復>
```

## 主線收到 finding 後（MUST）

- **PASS** → 繼續（commit / handoff / next step）
- **FAIL（有 blocker finding）** → 修完每一筆 blocker，修完**重派新 checker**（再次 fresh context）複跑；不得帶著 open blocker finding commit
- **checker 誤解 spec**（主線判定 finding 站不住）→ 不要靜默 dismiss，要在回報寫一行「finding X 不採納，理由：<spec 依據>」留審計軌跡
- **迴圈上限**：checker → fix → re-check 最多 3 個 **fix 輪**（該輪有實際修改）；用盡仍有 blocker 走 [[verify-gate-chain]] 的 `escalation_action`（default HANDOFF）。**禁止無上限 re-check 迴圈**。**輪數用盡不等於可以落地**——終止條件見下節

## 終止條件是「最後一輪 0 修改」，不是輪數用盡（MUST）

**每一次**修改後那一版都要再經一顆 fresh checker——包含**最後一次**修改。迴圈只能終止於三種狀態：

1. fresh checker 對一版**本輪 0 修改**的內容給出 PASS → 落地
2. 同一個 phase／同一份 spec 的**第一次** verify-only FAIL → 走 `escalation_action`，該版本不得落地
3. 同一個 phase／同一份 spec 的**第二次** verify-only FAIL → plan-level review（見下節），該版本不得落地

fix 輪上限用盡時**要追加一輪 verify-only checker**，讀修完 blocker 後的完整 diff。該輪結果只有 PASS 或 escalate，**verify-only 輪不再改任何檔**（再改就是又造出一版沒被檢查的內容）。verify-only 輪**不計入** fix 輪上限。

**不要把剛修完 blocker 的那一版直接 commit / publish / handoff**，即使那筆修復很小、即使 gate 全綠、即使輪數已用盡。

**只調高 fix 輪上限不算解決**：3 改 5 只是把「最後一次修改沒被檢查」平移到新的最後一輪。

## 同一份 spec 第二次 verify-only FAIL → plan-level review（MUST）

**違反字面就是違反精神。**

```text
同一個 phase／同一份 spec 第二次 verify-only FAIL，下一步是 plan-level review，NEVER 是下一個 implementation iteration。
```

- **計數跟著 spec 走，不跟著 owner 走**：換 owner、換 session、fix 輪歸零都**不**歸零 verify-only FAIL 次數。第一次 verify-only FAIL 走 `escalation_action` 時，交接物（HANDOFF／brief／tasks 檔）MUST 寫一行 `verify-only FAIL 1/2：<phase 或 spec 路徑>`；接手者開工前先查這一行，查到了就知道下一次 FAIL 不再換手。
- **plan-level review 做什麼**：派 fresh-context reviewer 讀 spec 與歷次 checker finding，回答「這些 blocker 是不是同一個狀態空間的不同格子、spec 的邊界是不是讓 checker 可以無限找格子」。產出是**修訂後的 spec**（落在 spec 本身，保留歷次 finding 當證據），**NEVER** 是新 owner 或下一輪 fix。這一步走 [[verify-gate-chain]] 的 `ROLLBACK:<spec>`——不必先證明是 specification error，第二次 verify-only FAIL 本身就是觸發條件。
- **review 之後**：spec 有改 → 修訂版是新 spec，計數從 0 重新開始。review 判定 spec 不需改 → 寫明理由才可再開 iteration，且這份 spec 下一次 verify-only FAIL 的 `escalation_action` 固定為 `ASK`（交人拍板），不再自審。

| 藉口（逐字實錄） | 現實 |
| --- | --- |
| 「Fix the two blockers and land」（ACP plan §15.4 被否決的選項） | 那就是第 28 輪。checker 找到一格就 FAIL，實作要全部格子都對才 PASS——Phase 4 估約 600 格，逐輪補洞不收斂 |
| 「調高 fix 輪上限」（TD-836 已排除） | 只平移最後一輪，spec 的邊界沒變 |
| 「換 owner」（TD-836 已排除；`escalation_action` 預設 HANDOFF） | 新 owner fix 輪歸零重算，27 輪就是這樣累出來的，不是任何一個 owner 的失誤 |

**Red Flags——發現自己在想這些就停，改走 plan-level review**：

- 「這次的 blocker 跟上次不一樣」——不同格子，同一個狀態空間
- 「每個 finding 都對，修掉就好」
- 「只剩 N 個 blocker 了」
- 「新接手，輪數從頭算」

## 為什麼

fresh context 買到的是「沒看過實作過程」，不是「更嚴格」：maker 的實作記憶對「我剛才寫錯了嗎」妨礙不大，真正遮蔽的是「這個改動對我沒看過的地方做了什麼」——那正是高擴散半徑改動的全部風險，gate 綠著也放過。低擴散半徑的改動沒有這個盲區。
