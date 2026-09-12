---
description: consumer 採用 Notion 制度時（consumer-meta 的 notion.ticketWorkflow 或 notion.projectWorkflow）適用。症狀：工作做完或發版了但 Notion 狀態還停在舊值、不知道某個 work item 對應哪張 ticket 或哪個 User Story、Notion 現況與 git 實況對不上、拿不準該不該去碰 Notion。狀態轉移授權沿用全域 _notion-<consumer-b>-board/REFERENCE.md §3 表，不另造 state machine
paths: ['tasks/**', 'specs/plans/**', '.claude/consumer-meta.json']
---
<!-- Clade native rule; source: rules/core/notion-work-coupling.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->
<!-- clade-adapters: claude,codex,cursor -->

# Work Item ↔ Notion Ticket 狀態耦合

**核心命題**：consumer 若有 Notion ticket 制度，工作的 Notion ticket 狀態**不能跟 work item 生命週期脫鉤**。最常見的漏洞是「做完了 / 發版了，但對應 ticket 還停在『進行中』甚至『需確認』」——客戶看 board 以為沒人動。本規則把「work item 生命週期事件 → ticket 狀態轉移」綁成**明文步驟**，由 `flow open` 與發版收尾主動推進，**不靠事後想起來**。

此規則優先於個別 skill 的 ad-hoc Notion 描述。狀態轉移授權**一律**沿用 consumer 所採用的 Notion reference skill §3 轉移表（單一真相層），本檔**不**重述 state machine、**不**新增 status 值。

## 什麼是這裡說的 work item

clade 的工作單位是 `flow` work item，它的 carrier 有兩種（見 [[flow-work-tracking]] 與 [[session-tasks]]）：

| carrier | 什麼時候用 |
| --- | --- |
| `tasks/<date>-<slug>.md` | 一般 session 工作清單 |
| `specs/plans/NNN-<slug>/`（含它的 `tasks.md`） | 走 aixbdd 的需求迭代，見 [[aixbdd-workflow]] |

兩種都用 `node vendor/scripts/flow/flow.ts open <slug> --origin tasks:<path>` 開卡。本檔說的「work item」指那張卡與它的 carrier，**NEVER** 讀成別的東西。

---

## 觸發條件（兩者皆成立才生效）

1. **Consumer 採用**：consumer metadata 宣告 `notion.ticketWorkflow: true`（schema 見 `registry/consumer-meta.schema.json` 的 `notion` block；判讀經 [[consumer-meta]] snapshot，**NEVER** 直接 path-resolve consumer repo）。未宣告 / `false` → 本規則**完全不生效**，工作照常跑、不碰 Notion。
2. **該 work item 連結到一張 ticket**：carrier 檔頂部有 ticket 連結（見下方「連結存放」）。沒有連結的工作（典型：來自 `ROADMAP.md` / 內部技術債、非客戶 ticket）→ 本規則**不生效**，不要硬湊一張 ticket。

兩條都成立才推進 ticket 狀態。任一不成立 → silent skip，**NEVER** 因為「想更新點什麼」就去碰 board。

---

## Work item ↔ Ticket 連結存放（single source）

連結寫在 carrier 檔的**最上方**（第一個 `## ` 標題之前）一行 blockquote：

```markdown
> **Notion ticket**: <ticket-url>（page_id: <page-id>）
```

- git-tracked + 人可讀，跟著 carrier 走、不依賴任何 blob store
- **由誰寫**：工作若是從 outbound ticket flow 或 inbound board triage 轉來，**MUST** 在建 carrier 的當下（`flow open` 之前或同一步）把 page_id 寫進這行。日後反查只認這行。
- **NEVER** 只把連結留在 `HANDOFF.md`（HANDOFF 是 session-scoped，交接後會清），也 **NEVER** 只留在 flow 卡的 payload（那是機器狀態，人讀不到）。

---

## 生命週期 → ticket 狀態映射（沿用 REFERENCE.md §3 授權表）

| work item 生命週期事件 | ticket 轉移 | 需要的 evidence | MUST-step 位置 |
| --- | --- | --- | --- |
| **真的開工**（`flow open <slug>` 成功並拿到 work id） | `未開始`\|`需確認` → **`進行中`** | active claim 存在（per [[session-claims]]） | 開卡後、動第一個檔之前 |
| **發版**（`work.done` + `/commit` 出 git tag + push 觸發 deploy） | `進行中` → **`驗收中`** + 填 `修復版本 >= <tag>` | `git describe --tags` 拿得到本次發版 tag | `/commit` 發版完成的當下（見下「驗收中 的 tag 依賴」） |
| 客戶驗收 OK | `驗收中` → `完成` | — | ❌ **客戶側，Claude NEVER** |
| 人工歸檔 | `完成` → `封存` | — | ❌ **客戶側，Claude NEVER** |

**Hard rule（重申 REFERENCE.md §3）**：寫 `狀態` 前 **MUST** 確認該轉移在 §3 表是 ✅ Claude 可推。要碰 ❌（客戶側 `驗收中→完成` / `完成→封存`）→ **STOP**，改成「回報 user + 建議」，由 user 自己在 Notion 點。

### 「驗收中」的 tag 依賴（為什麼不在工作做完的當下就轉）

`進行中 → 驗收中` 在 REFERENCE.md §3 要求**拿得到對應 git tag**（`修復版本 >=` 必須是真 tag）。而 tag 是 `/commit` Step 5 才 bump 版本 + 打 tag + push——所以**把 work item 標 done 的當下還沒有本次發版 tag**，`git describe --tags` 只會拿到上一版。

因此：

- **標 done 的當下 MUST**：(a) 確保 ticket 已是 `進行中`（若還停在 `未開始`/`需確認` 先補轉）；(b) 在收尾訊息**明文列出 pending 動作**：「📌 Notion ticket `<page_id>`：本工作已完成，待 `/commit` 發版產 git tag 後 → 轉 `驗收中` + 填 `修復版本 >= <tag>`」。
- **發版完成後 MUST**：同一主線跑完 `/commit`（tag 已存在、push 已觸發 deploy）後，**立即** `git describe --tags --abbrev=0` 抓 tag，執行 `進行中 → 驗收中` + 寫 `修復版本 >= <tag>`。**NEVER** 把這步丟給「下次想起來」。

> consumer 若有 deploy 後 CI 綠燈確認流程（如 <consumer-b> Post-Push CI Watcher），`驗收中` 轉移 SHOULD 等 CI 綠燈（deploy 真的成功）再推，避免 tag 出去但 deploy 紅燈卻已標驗收中。

---

## 執行機制

- **Runtime**：狀態推進的 Notion operations 走 [[agent-routing]] 〔`notion-ops`〕（gemini → luna → 主線），**NEVER** 主線第一手自己跑。Portable `ntn` CLI 是跨 runtime 的 transport。
- **入口**：走 runtime 的 Notion board synchronization entrypoint，依 consumer reference §3/§4 改單一 `狀態` / `修復版本 >=` 欄位；portable transport 使用 `ntn api -X PATCH "/v1/pages/<page_id>"`。target-specific skill entrypoint 由 adapter fragment 宣告。
- **寫入前 MUST**：由 Notion client 依 consumer metadata 的 `notion.dataSourceId` 重撈 schema，property key（中文 + 全形空格 + `>=`）一字不差 copy-paste，**NEVER** 憑記憶拼 property 名（REFERENCE.md §2 hard rule）。
- **欄位邊界**（REFERENCE.md §2）：只寫 `狀態` 與 `修復版本 >=`（+ 必要時 `備註` 補開發備註）。**NEVER** 動 `名稱`（客戶原始描述）、`發布日期`（客戶提報日，不是發版日）、`驗收日期`（客戶側）、`驗收完成`（系統 readOnly）。

---

## Consumer 採用（consumer-meta `notion` block）

consumer 在自家 metadata 加（schema 見 `registry/consumer-meta.schema.json`）：

```jsonc
"notion": {
  "ticketWorkflow": true,
  "boardDatabaseId": "<database-id>",
  "dataSourceId": "<data-source-id>",      // 建/改 page 用這個
  "referenceSkill": "_notion-<consumer-b>-board"   // 全域 skill dir，承載該 board 的真相層（座標 / schema / 狀態機）
}
```

- consumer-self 決策（per [[consumer-meta]] § Adoption），**NEVER** 由 clade 主線替 consumer 填。
- `boardDatabaseId` / `dataSourceId` / `referenceSkill` 是 per-consumer 事實（不同 consumer 不同 board）——本規則靠它參數化，不寫死 <consumer-b> 座標。
- 未採用的 consumer：`notion` block 缺 / `ticketWorkflow:false` → 本規則 silent no-op。

---

## 與「對外輸出需 user 授權」的關係

clade / 全域行為準則：對外發訊息 / 改工單屬 outbound，預設要 user 明確指示才做。**本規則本身就是那道 standing direction**——user 採用 `notion.ticketWorkflow:true` + 把 ticket 連進 carrier，即等同授權流程在**授權轉移範圍內**（REFERENCE.md §3 的 ✅ 列）自動推進狀態。但：

- 授權**僅限** §3 的 ✅ 開發側轉移；客戶側（`驗收中→完成` 等）仍 **NEVER** 自動碰。
- 採用是 opt-in（consumer-meta flag）+ per-work-item（要有連結），不是全域預設。

---

## MUST

- consumer 採用 + work item 有連結時，**每一個**這樣的 work item 都 **MUST** 在 `flow open` 之後把 ticket 推到 `進行中`、在標 done 時 surface pending `驗收中` 並於發版後完成。不是只處理最後一個。
- 寫 Notion 前 **MUST** 重新抓取 data source schema 校對 property key。
- `驗收中` **MUST** 帶真 git tag 填 `修復版本 >=`。
- 推任何狀態前 **MUST** 確認該工作有 active claim（per [[session-claims]]）——無主 WIP 不代表 board 該動。

## NEVER

- **NEVER** 對 `notion.ticketWorkflow` 未啟用 / work item 無連結的情況硬湊 ticket 更新。
- **NEVER** 碰 §3 客戶側轉移（`驗收中→完成` / `完成→封存` / 跳過驗收直接封存）。
- **NEVER** 覆寫 `發布日期`（客戶提報日）、`驗收日期`、`名稱`、`驗收完成`。
- **NEVER** 無 git tag 就標 `驗收中` 或亂填 `修復版本 >=`。
- **NEVER** 把連結只存 `HANDOFF.md`（session-scoped）或只存 flow 卡 payload（人讀不到）。
- **NEVER** 憑記憶拼 Notion property key（中文 + 全形空格 + `>=`，憑記憶必錯）。

---

# 專案層（Milestone / Epic / User Story / Task）

**與上面 Issue Ticket 層的預設相反。** Ticket 層「無連結 → silent skip」是對的：客戶工單本來就不是每個工作都有。專案層不同——**每一個** work item 都對應到某個 User Story，所以「找不到對應」不是正常狀態，是需要處理的訊號。

> **本層預設**：判定不了 → **問**（runtime question interface）。**NEVER** silent skip，**NEVER** 用猜的值寫入。

## 觸發條件

consumer metadata 宣告 `notion.projectWorkflow: true` 且 `notion.databases.story.dataSourceId` 有值。未宣告 → 本層完全不生效。

座標一律從 consumer-meta 讀（`notion.databases.{milestone,epic,story,task,ticket}`），**NEVER** 寫死在 skill 或 reference doc 裡。

## 層級對應（一次講清楚，避免各處各自解讀）

| Notion | git | 基數 |
| --- | --- | --- |
| User Story | carrier 的**每一條**驗收能力：`specs/plans/NNN-<slug>/spec.md` 的每條驗收標準，或 `tasks/<date>-<slug>.md` 的每條交付目標 | **N:1** — 一個 work item 常對應多個客戶語言的 Story |
| Task | carrier 的 `## N. <phase>` | 1:1 per phase |
| — | carrier 的 `- [ ] N.M` | **不上 Notion**（那是 agent 執行單位，不是溝通單位）|

Story 的 idempotent key 是 **(`Work`, `Capability`) 兩個欄位的組合**，不是標題——標題是客戶語言的中文描述，拿 slug 去比對永遠比不中。

## 三級判定式

### Class 3 — MUST 問，命中任一即停止寫入

問的觸發是**有限枚舉的可觀察 predicate**，不是「覺得不確定就問」。以下六條都不命中 → 一律走 Class 1 或 2 自動處理。

| | Predicate（可機械判定） | 為什麼不能自動 |
| --- | --- | --- |
| **(a)** | Milestone 的 Story 完成率達 100% **且** 該 Milestone 有連結報價單 | 財務／請款後果 |
| **(b)** | Story `待驗收 → 已完成`、Ticket `驗收中 → 完成`、Ticket `完成 → 封存` | 客戶／你的驗收側轉移（沿用 §3 授權表的 ❌ 列）|
| **(c)** | carrier 描述的影響範圍同時命中兩個 client 路徑，或指名某個尚未上線的租戶 | 目標頁面歧義 |
| **(d)** | 新 Story 找不到**唯一**相符的 Epic（0 個或 ≥2 個候選）| 自動猜會生出重複／垃圾 Epic |
| **(e)** | Notion 現況的狀態在生命週期順序中**晚於**即將寫入的值 | 有人手動動過，意圖不明——不靜默覆寫也不靜默放棄 |
| **(f)** | 目標 track 的 Notion 結構尚未建立 | 「現在要不要生出這套結構」是商業決策 |

問完之後，把答案回填給同一支 script 重跑：`--epic <id>` / `--create-epic "<name>"` / `--force-overwrite`。

### Class 2 — 自動寫，但輸出標記待覆核（不阻塞）

有損翻譯或推論，且猜錯成本低、不擋任何不可逆動作。目前只有一條：**Story 標題**從 carrier 的驗收能力描述草擬成客戶語言。

### Class 1 — 自動寫，不打擾

其餘全部。來源事實是二元可查的（`git describe --tags` 有沒有值、active claim 存不存在、carrier 子項是否全勾），且轉移在 §3 授權表的 ✅ 列。

## 生命週期觸發點

**每一個**有 carrier 的 work item 都適用，不是只有「看起來跟客戶有關」的那些。

| 事件 | 掛載點 | 寫入 |
| --- | --- | --- |
| carrier 建立完成 | 建 carrier 檔的收尾 | 建 Story（每條驗收能力一則）+ Task（每個 phase 一則）|
| `flow open` 真開工 | 拿到 work id 之後、動第一個檔之前 | Story → `開發中` + `拍板日` |
| manual review handoff | 交付驗收清單給 review-gui 時 | Story → `待驗收`；依 carrier 現況**補正全部** Task 狀態 |
| `work.done` | 標 done 的收尾 | Story → `待驗收` |
| 發版（版本 bump + tag） | `/commit` **Step 6-A**（或 6-B 選「現在發版」後） | Story `上線日`；重算所屬 Milestone 進度；100% 時觸發 Class 3 (a) |

執行一律透過同一個 consumer Notion synchronization implementation，**NEVER** 在各 skill 各寫一份寫入邏輯——五個掛載點呼叫同一支，避免五份實作彼此漂移。

## Milestone 進度為什麼由 script 算而不是 rollup

Notion **不支援 rollup of rollup**：`Epic.進度` 已經是 rollup(Story)，Milestone 無法再 rollup 它。所以：

1. Story 除了 `Epic` 之外**另有一條直接連到 Milestone 的 relation**（跳過 Epic 層，純粹讓 Notion 能對 Milestone 做原生 rollup）
2. `Milestone.進度` 由 script 在發版時親自算（完成 Story 數 / 總數）並 PATCH，**不賭 Notion rollup 引擎**
3. 100% 時**只做一件事：問**（Class 3 (a)）。**NEVER** 自動轉「已交付」或勾「可請款」

## 失敗模式契約

- **所有寫入 MUST 是絕對值 SET**（狀態＝X、欄位＝Y），**NEVER** 用 delta／increment。這讓任何重試都 idempotent，是下面兩條得以成立的前提。
- **讀失敗**（抓不到 schema 或現況）→ **中止整個寫入**，**NEVER** 用猜的值硬寫。
- **寫入 timeout**（不確定有沒有落地）→ 一律當失敗、留 pending marker，**NEVER** 自動重試（已經等了 45s，疊上去只是把單次延遲變兩倍）。marker 落在 `<consumer>/.clade/notion-sync-pending/`，下一個自然觸發點或人工 reconcile 處理。
- **找不到目標 property** → 訊息 MUST 標「疑似 schema drift」，不可回報成泛用的「寫入失敗」——讓人一眼看出不是網路問題。

## 本層的 NEVER

- **NEVER** 因為判定不了就 silent skip（那是 Ticket 層的規則，不是本層）
- **NEVER** 自動執行 Class 3 的任一條，即使底層訊號看起來很明確
- **NEVER** 把座標寫死在 skill / reference doc（一律讀 consumer-meta）
- **NEVER** 用 delta 寫入，或對 timeout 自動重試
- **NEVER** 把 `- [ ] N.M` 那層 task 同步到 Notion

## Cross-ref

| 主題 | 真相層 |
| --- | --- |
| Notion 狀態機 + 轉移授權表 + 欄位邊界 + 版本對照 | consumer 採用的 Notion reference skill §2–§4（單一真相層） |
| inbound ticket 全生命週期（scan / triage / sync / report） | runtime 的 inbound Notion board skill |
| outbound 決策題建立 ticket | runtime 的 outbound Notion ticket skill |
| consumer 能力宣告 / aggregator | [[consumer-meta]] |
| work item 開卡 / carrier / origin | [[flow-work-tracking]]、[[session-tasks]] |
| ownership / claim | [[session-claims]] |
| 發版 / git tag 產生點 | [[commit]] Step 5（版本號升級 + tag push） |

## 違反時的回報方式

```
[notion-work-coupling] ticket 狀態漏同步

問題：work item <slug> 連結 ticket <page_id>，但 <生命週期事件> 後 ticket 狀態未推進

修正：
  - 重新抓取 schema → 依 §3 授權表推 <正確轉移>
  - 發版類轉移補填 修復版本 >= <git tag>

繞過：
  - consumer 未採用 → 在 consumer metadata 設 notion.ticketWorkflow=false（或留空）
  - 該工作不對應任何客戶 ticket → carrier 不放連結即 silent skip
```
