---
name: notion-hub
description: "consumer 所屬 Notion hub 的唯一入口。Use when 看 board／進度、評估或認領客戶票、在 prod 發現問題要建票、建決策題問客戶拍板、或問客戶驗收了沒。NOT for 生命週期狀態同步（由 notion-sync 跟隨 flow 事件推進）、未宣告 notion.hub 的 repo、clade 內部待拍板題（走 flow ask 與 /decisions）。"
---

<!-- clade-skill-scope: both -->

# notion-hub

當前 consumer 所屬 Notion hub（ticket board ＋ 客戶看的 `交付項目`）的**唯一入口**。規約在
[[notion-work-coupling]]；本 skill 只承載**人主動發起**的五個意圖。

**生命週期大半不在這裡。** `flow plan open`／`flow done` 成功後 `follow` 自動推進 ticket 狀態與
交付項目 進度，`/commit` Step 6b 跑 `release`——**NEVER** 在本 skill 裡叫人「做完記得同步 Notion」。
例外一個手動掛載點：非 `file` 建票的工作（`flow open` 或認領客戶票）在開工前 MUST 跑一次
`notion-sync.ts open --work <id>` 建 `交付項目` 列——`follow` 依設計永不建列，漏跑這步的 work item
不會出現在客戶時程頁（掛載點全表見 [[notion-work-coupling]]）。

## Runtime

- **確定性 script 主線直接跑**：`vendor/scripts/notion-sync.ts`、`vendor/scripts/lib/notion-hub.ts resolve`、
  `scripts/audit-notion-hub-schema.ts`。它們的寫入範圍、授權轉移表、schema 檢查、sidecar 都寫死在 script 裡。
- **自由形式的 Notion 讀寫**（`ntn api` 查詢、MCP `notion-fetch`／`notion-create-pages`／comment）走
  Routing Table 〔`notion-ops`〕：Pi `--model gemini --effort high` → luna → blocker。**NEVER** 主線第一手自己跑
  `ntn`／MCP；**NEVER** `luna-cursor`（Notion auth 在 `$HOME`）。
- 客戶看得到的文字（ticket 名稱、決策題、comment）是定稿措辭：Pi 起草後主線 **MUST** 收斂重寫才寫入。

## 開工前置（每次）

1. `node ~/offline/clade/vendor/scripts/lib/notion-hub.ts resolve --consumer-path .` → `configured:false` 就回報
   「此 repo 未宣告 notion.hub」並**停止**，不猜 board。
2. 狀態字用輸出的 `hub.ticketStatus`，`類型` 字用 `hub.ticketType`，欄位名用 `hub.fields`（已含本 hub 的改名覆寫）。
   **NEVER** 憑記憶寫任何一個——不同 hub 不同字，客戶也會改。
3. 懷疑欄位或選項被改過 → `node ~/offline/clade/scripts/audit-notion-hub-schema.ts --hub <key>`。

## 五個意圖

| 意圖 | 觸發 | 做什麼 | 之後 |
| --- | --- | --- | --- |
| 看板（唯讀） | 「看 board／客戶丟了什麼／進度報告／哪些卡住」 | § 1 | — |
| 認領客戶票 | 「這張怎麼修」＋客戶票 | § 2：評估 → `flow open --origin notion:<id>` → `notion-sync open` | work-route |
| 工程師建票 | prod 截圖／DB 發現、「這是 bug」「這要做」 | § 3：`notion-sync file` | work-route |
| 問客戶 | 需要客戶拍板才能往下 | § 4：建決策題 ticket | 客戶回覆後回 work-route |
| 對帳驗收 | 「客戶驗收了嗎／對一下」 | § 5：讀客戶側狀態 → `flow accept` | — |

### 1. 看板（唯讀）

經 〔`notion-ops`〕 撈本 projectCode 的票（filter `所屬專案` = `project.rowId`；board 是 hub 共用，使用者明說才看全 hub），
recipe 見 [reference/cookbook.md](reference/cookbook.md) § 1。依 `stageOf` 分桶：

- 🆕 新進未處理（backlog 且 `Work ID` 空）——`優先級` P0 或 bug 類型的做輕量初判（root cause 方向一行、疑似檔、`estimate-hours`），不改欄位
- 🚧 進行中——**每張** MUST 讀 `Work ID`（`<consumerId>/<workId>`）：前綴不是本 repo → `⚑ 屬別 repo`；是 → `notion-sync.ts status --work <id>`，spine 已 done／accepted 但票仍進行中 → `⚑ 疑似已修好未發版`；空 → cookbook § 5 模糊對帳
- ⏳ 待客戶驗收、❓ 等拍板、⚠️ stale（進行中／驗收中且 `提報日期` 距今 > 14 天）、✅ 已收斂（只報數量）

報告模式另撈 `交付項目`（filter `專案`）列 `逾期`。**整個意圖不改任何欄位。** 有 `⚑` → 結尾首要建議對應意圖。

### 2. 認領客戶票

1. 經 〔`notion-ops`〕 讀票（raw + 客戶 comment）；codebase-memory 定位 root cause 與修法草案。
2. 三向分流：
   - **可直接做** → 使用者同意後 `flow open <slug> --origin notion:<page-id>`，緊接 `notion-sync.ts open --work <id> --ticket <page-id> --title "<客戶看得懂的一句話>"`（票 → 進行中 ＋ `Work ID`；建 交付項目 列——客戶提的 bug 與功能都建，D3）。然後交給 work-route。
   - **要客戶先拍板** → § 4。
   - **前提不成立／重複／已修** → 回報使用者，客戶側處理（封存類 NEVER 自動碰）。

### 3. 工程師建票（發現即建）

工程師自己在 prod／資料裡發現問題、或決定要做一個功能時，**先建票再動手**：

```bash
node ~/offline/clade/vendor/scripts/notion-sync.ts file \
  --title "<客戶看得懂的一句話>" --kind bug|feature --slug <slug> \
  [--prod-url <consumer prod 網域上看得到問題的頁面>] [--screenshot <問題畫面.png>]…
```

一次做完：建票（進行中、`類型`=`hub.ticketType[kind]`、`所屬專案`、`提報日期`、`備註`=prod URL、內文「問題畫面」截圖）→
`flow open --origin notion:<page>` → 寫 `Work ID`。**工程師發現的 bug 不建 交付項目**（D3），feature 會建。
印出的 `export CLADE_WORK_ID=…` 照做，然後交給 work-route。已經有 work item 就用 `--work <id>` 代替 `--slug`。

`file` 拒寫的三種情況照訊息處理：hub 未宣告 `ticketType`（跑 schema 稽核後補 registry）、`--prod-url` 不是 consumer
prod 網域（`.claude/consumer-meta.json` `deploy.prodUrl`）、`類型` 選項對不上（schema drift）。

### 4. 問客戶（決策題 ticket）

寫 code 前有 ≥1 個只有非技術決策者能拍板、且會決定 schema／API／UI 範圍的問題時用；純技術決策自己決、1–2 句的小確認在 chat 問。
ticket 結構、撰寫規約、接手 prompt 六段全文在 [reference/decision-ticket.md](reference/decision-ticket.md)。

- 建票經 〔`notion-ops`〕（MCP `notion-create-pages`，cookbook § 3）：`狀態`=`hub.ticketStatus['needs-customer']`、`類型`=`hub.ticketType.feature`（bug 修正類用 `.bug`）、`所屬專案` relation、`提報日期` 今日。
- 已有 work item 時由 `notion-sync.ts open --work <id> --ticket <page>` 綁 `Work ID`；沒有就等客戶回覆後走 § 2。
- 既有客戶票只需要問一句 → 在該票留 comment（口語、給選項情境），並把 `狀態` 設成 `hub.ticketStatus['needs-customer']`（cookbook § 2）。
- 客戶沒回就回報「還沒回」並結束；**NEVER** 建議「N 天後 ping 客戶」。

### 5. 對帳驗收

客戶在 board 把票推到 完成／封存（客戶側轉移，machine NEVER 做）之後：

1. 對本 projectCode 驗收中的票逐張讀 `Work ID` → `notion-sync.ts reconcile --work <id>`（交付項目 跟隨 ticket）。
2. 客戶側已 完成 → 對該 work item `flow accept`（`accepted_by: customer`，per [[flow-work-tracking]]）。
3. 發版了但票還在進行中（`⚑ 疑似已修好未發版`）→ 不是本意圖的事：那代表 `/commit` Step 6b 的 `release` 沒跑，回報並補跑 `release`。

## 客戶面證據（硬規則，D2）

- `備註` 與票內文 **NEVER** 出現 github.com（PR／CI run／tag／merge commit）——PR 連結只進 `PR` 欄，其餘留在 flow artifacts。`notion-sync.ts` 會拒寫。
- 客戶面的網址只放 consumer prod 網域的完整 URL；截圖放內文（`file` 的「問題畫面」、`release` 的「驗收畫面（<tag>）」）。
- `檔案和媒體` 是客戶欄，機器 **NEVER** 寫；客戶側轉移（驗收中→完成、完成→封存）與 `預估完成日`（沒經人確認）**NEVER** 碰。

## 常見坑

1. **狀態字／類型字／欄位名憑記憶** → 一律 resolve 的 `hub.*`；寫錯 Notion 直接拒絕。
2. **自己 PATCH 狀態繞過 script** → 授權表、regression 偵測、sidecar 都在 script；唯一例外是 § 4 的 needs-customer。
3. **把 PR 連結貼進備註給客戶看** → 客戶打不開也不該看；寫 `PR` 欄。
4. **掃到別專案的票** → board 是 hub 共用，預設 filter `所屬專案`。
5. **在 skill／文件寫 Notion id** → 一律 `registry/notion-hubs.json`。
6. **叫人「做完同步 Notion」** → 生命週期由 flow 事件自動推進；沒推進代表 hook 或 Step 6b 沒跑，修那裡。

## 觸發訊號

- 「看一下 ticket／board」「客戶丟了什麼」「進度報告」「哪些卡住／逾期」→ § 1
- 「這張怎麼修」「評估一下這張」→ § 2
- 「prod 上這個是 bug」「我發現…」「開一張票」「這個功能要做」→ § 3
- 「建 ticket 問客戶」「問老闆 N 題」「拍板才能寫」→ § 4
- 「客戶驗收了嗎」「對一下 board 跟 git」→ § 5
