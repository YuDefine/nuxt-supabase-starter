---
description: 高擴散半徑改動（跨 consumer 共用 SoT / migration / auth 路徑 / 共用 util）在 publish 或 commit 前 MUST 派 fresh-context checker subagent 複核——只讀 diff + spec，產出 PASS/FAIL + finding；gate 全綠是派 checker 的前置條件不是複核項；其餘任務不派
paths: ['rules/core/**', 'vendor/scripts/**', 'plugins/hub-core/**', 'claude-md/**', '.claude/rules/**', '.claude/skills/**', '**/migrations/**', 'shared/**', 'packages/*/shared/**', 'server/utils/**', 'packages/*/server/utils/**']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/checker-subagent.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# Checker Subagent（高擴散半徑改動複核）

**核心命題**：checker 買到的唯一東西是 **fresh context**——一顆沒看過實作過程的眼睛。這對「我剛才有沒有寫錯」幫助有限（模型自己就會抓到並修掉），但對「這個改動對我**沒看過**的地方做了什麼」是不可替代的。所以派不派 checker 的判準是**擴散半徑**：錯了會不會波及沒被改到的檔案、沒被改到的 repo。本規約定義**何時**必須派 checker、checker **收到什麼**、以及主線**拿 finding 怎麼辦**。

## Iron Law — 擴散半徑決定派不派

**違反字面就是違反精神。**

```text
改動會落到多個 consumer、或會影響沒被改到的程式碼時，
寫它的 agent NEVER 是唯一判定它可以散播的人。
```

**動跨 consumer 共用 SoT**（`rules/core/` 本體、`vendor/scripts/` 散播層、`plugins/hub-core/` skill、`claude-md/` 注入段落）或**高擴散半徑 consumer 資產**（DB migration、auth 路徑、多處 import 的共用 util、對外 API contract）時，主線在 publish / propagate / commit 之前 **MUST** 派一個 fresh-context checker subagent。checker **MUST** 是新開的 subagent（`Agent` tool，非續跑 maker）。**NEVER** 用**繼承主線對話**的 fork 型 subagent 當 checker——user 打的 `/subtask`、以及 `subagent_type: 'fork'`（該 rollout 開啟時）繼承主線完整 message history，等同把 maker 的實作敘事整份附給 checker，fresh context 當場失效（per § Checker brief 模板）。「它字面上也是新開的 subagent」不構成例外。

**Cursor runtime**：本節的 `Agent` tool 是 Claude Code 的 Agent，**NEVER** 改用 Cursor Task 的非 grok-4.6 `model` 充當 checker。改走 [[agent-routing]] § Cursor runtime 主線 residency 的 Herdr create-only `--launcher cc`／`ccw`。

**其餘任務 NEVER 派 checker。** 這包含 ≥3 phase 的 change、`effort: high`+ 的單一任務、新 endpoint、新邏輯分支，以及任何「我想確認一下自己有沒有做對」的場景——模型會自行捕捉並修正自己的錯誤，額外派 agent 複驗只是把同一份判斷跑第二次，燒 token 不提升品質。

## 何時 REQUIRED

| 情境 | checker | 判準 |
| --- | --- | --- |
| 動跨 consumer 共用 SoT（`rules/core/` 本體 / `vendor/` 散播層 / `hub-*` skill / `claude-md/` 注入段） | **REQUIRED** | 一炸全 fleet 同時撞 |
| 動高擴散半徑 consumer 資產（DB migration / auth 路徑 / 多處 import 的共用 util / 對外 API contract） | **REQUIRED** | 錯了會波及沒被改到的程式碼 |
| 其餘一切（≥3 phase change / `effort: high`+ / 新 endpoint / 邏輯分支 / refactor / typo） | **NEVER 需要** | 擴散半徑止於本次 diff；模型自行捕捉並修正 |

**說不清是哪一格時的判準**：問「這個改動如果錯了，會不會影響到我**沒有改**的檔案或**別的** repo？」——答案是「不會」就不派。任務跑了幾個 phase、花了多久、有多難，都跟這個問題無關。

## 派 checker 的前置條件（MUST 先滿足）

派 checker **之前**，[[verify-gate-chain]] 的 L0–L2 **MUST** 已經全綠（lint / typecheck / test 全 exit 0）。gate 紅著派 checker 是浪費——機械可判定的問題交給機械擋，checker 的 context 應該整份花在語意上。

gate 紅 → 先修，修完再派。**NEVER** 把 gate output 塞進 checker brief 當判定材料。

**checker 的 `model` 刻意省略、繼承主線**——checker 的輸出**本身**就是品質判定，命中
[[agent-routing]] § NEVER 降檔的形狀第 1 條。這是聲明不是疏漏：**NEVER** 拿該檔
§ `subagent_type` 是 `general-purpose` 或 `Explore` 時… 的「MUST 顯式帶檔位」外推到 checker，
**也 NEVER** 把 checker 轉派 codex `--model luna` 或 `--model gemini`。

## Checker brief 模板（REQUIRED 欄位）

checker subagent 的 prompt **MUST** 且**只**含以下兩項，**NEVER** 附 maker 的實作敘事、「我為什麼這樣改」、嘗試過的選項：

```text
你是 checker，對這份改動做獨立複核。你沒有寫這份 code，只根據以下 artifact 判定。

1. DIFF（完整 git diff，改了什麼）:
   <git diff 全文>

2. SPEC（這份改動本該滿足的驗收標準 / spec 摘錄）:
   <tasks/<slug>.md 或 spec 的 acceptance criteria 段>

輸出 PASS 或 FAIL，FAIL 時附 finding list（格式見下）。NEVER 幫忙改 code，只複核。
```

附上 maker 的推理過程 = 把 checker 拉進同一套合理化，fresh context 失效。

## PASS / FAIL 判準

checker **MUST** 輸出 PASS 或 FAIL，四條全滿足才 PASS：

1. **scope 吻合**：diff 落在 spec 宣告的 scope 內，無 scope creep（cross-ref [[subagent-scope-discipline]]）
2. **擴散面已檢查**：diff 觸及的每個共用符號 / 契約，其**未被改動的**呼叫端仍成立——改 migration → 既有查詢仍對；改共用 util → 每個 import 端仍對；改 rule 措辭 → 引用它的其他 rule 仍一致。這條是 fresh context 唯一能提供、maker 最看不到的東西
3. **無漏做**：spec 要求的每一項在 diff 都有對應實作，無 missing requirement
4. **無可讀出的 bug**：diff 本身讀不出明顯邏輯錯 / off-by-one / 反向條件 / 缺 error path

任一條不滿足 = FAIL。checker **MUST** 對**每一筆** finding 用以下格式（沿用 [[checker-contract]] § 違反回報格式）：

```text
- [<blocker|warn>] <path>:<line|N/A>
  finding: <觀察到的問題>
  spec-ref: <對應 spec 哪一條 / 或「scope creep：spec 未要求」>
  action: <maker 要做的最小修復>
```

## 主線收到 finding 後（MUST）

- **PASS** → 繼續（commit / handoff / next step）
- **FAIL（有 blocker finding）** → **MUST** 修完每一筆 blocker，修完**重派新 checker**（再次 fresh context）複跑；**NEVER** 帶 open blocker finding commit
- **checker 誤解 spec**（主線判定 finding 站不住）→ **NEVER** 靜默 dismiss；**MUST** 在回報寫一行「finding X 不採納，理由：<spec 依據>」留審計軌跡
- **迴圈上限**：checker → fix → re-check 最多 3 個 **fix 輪**（該輪有實際修改）；用盡仍有 blocker 走 [[verify-gate-chain]] 的 `escalation_action`（default HANDOFF）。**禁止無上限 re-check 迴圈**。**輪數用盡 NEVER 等於可以落地**——終止條件見下節

## 終止條件是「最後一輪 0 修改」，不是輪數用盡（MUST）

**每一次**修改後那一版 MUST 再經一顆 fresh checker——包含**最後一次**修改。迴圈只能終止於兩種狀態：

1. fresh checker 對一版**本輪 0 修改**的內容給出 PASS → 落地
2. verify-only 輪仍有 blocker → 走 `escalation_action`，該版本 **NEVER** 落地

fix 輪上限用盡時 **MUST 追加一輪 verify-only checker**，讀修完 blocker 後的完整 diff。該輪結果只有 PASS 或 escalate，**NEVER 在 verify-only 輪再改任何檔**（再改就是又造出一版沒被檢查的內容）。verify-only 輪**不計入** fix 輪上限。

**NEVER 把剛修完 blocker 的那一版直接 commit / publish / handoff**，即使那筆修復很小、即使 gate 全綠、即使輪數已用盡。

**只調高 fix 輪上限 NEVER 算解決**：3 改 5 只是把「最後一次修改沒被檢查」平移到新的最後一輪。

## Red Flags

**漏派**——發現自己在想以下任一句就 **STOP**，補派 fresh-context checker：

- 「這只是改 `rules/core/` 一句措辭，很小」（散播半徑跟改動大小無關；一句措辭錯了全 fleet 一起錯）
- 「migration 我自己跑過了沒問題」（跑得起來 ≠ 既有查詢仍對，那正是擴散面）
- 「把我的實作理由也貼給 checker，它比較好判斷」（附敘事 = fresh context 失效，等於沒派）
- 「checker 說 FAIL，但我覺得它誤解 spec，直接 commit」（NEVER 靜默 dismiss，MUST 留理由）
- 「blocker 都修完了，最後這筆很小，直接 commit」（修完 blocker 的那一版從未被 fresh context 讀過；per § 終止條件）
- 「3 輪已經用盡，不能再派了」（上限管的是 fix 輪；verify-only 輪不計入且是 MUST）

**過度派**——同樣是違反本規約，發現自己在想以下任一句就 **STOP**，自己做完：

- 「這任務有 4 個 phase，照規矩要派 checker」（phase 數不是判準，擴散半徑才是）
- 「我想確認一下自己有沒有做對」（模型自行捕捉並修正；派 agent 複驗是把同一份判斷跑第二次）
- 「effort 標 high，保險起見派一個」（effort 反映難度，不反映擴散半徑）
- 「gate 紅著，先派 checker 看看是什麼問題」（gate 紅 → 先修，per § 派 checker 的前置條件）

## 與既有機制的關係

| 機制 | 本規約的角色 |
| --- | --- |
| [[verify-gate-chain]] | gate chain 是派 checker 的**前置條件**（L0–L2 全綠才派），不是 checker 的複核材料。機械可判定項交給 gate 擋，checker 只花在語意上 |
| [[agent-self-verification]] | self-verification 管的是**證據要不要自己去收**（截圖 / API round-trip / DB query），禁止踢回 user。那是去問環境拿 ground truth；本規約管的是要不要換一顆 context 讀 diff。兩者不衝突也不重疊 |
| [[subagent-scope-discipline]] | 那條是主線 verify **subagent 交回來的 diff scope**（信任問題）。本條 checker 的 PASS 判準 1 也看 scope creep，但焦點在擴散面 |
| [[checker-contract]] | checker-contract 定義 **mechanical** checker 的 output 格式。本規約的 checker 是 **agent** checker，finding 沿用同一回報格式 |

## 為什麼

- **判準是擴散半徑，不是任務長度**：checker 的價值在「這個改動錯了，會波及多少沒被改到的東西」。跨 consumer SoT 錯一行，全 fleet 同時撞；migration 錯一行，沒被改的查詢一起壞。任務跑了幾個 phase、標了什麼 effort，跟這個風險無關
- **gate 抓機械項，checker 抓擴散面**：[[verify-gate-chain]] 的 L0–L2 驗型別 / test / lint，但「這個共用 util 的簽名改了，另外 9 個 import 端還對嗎」gate 綠著也放過——那是要讀 diff 之外的東西才知道的
- **fresh context 買到的是「沒看過實作過程」，不是「更嚴格」**：maker 重讀自己的 code 帶著實作記憶。這份記憶對「我剛才寫錯了嗎」妨礙不大——模型自己就會捕捉並修正。它真正遮蔽的是「這個改動對我沒看過的地方做了什麼」，而那正是高擴散半徑改動的全部風險所在。低擴散半徑的改動沒有這個盲區，派 checker 買不到東西
