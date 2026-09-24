---
description: consumer 宣告 notion.hub 時適用。症狀：自己發現 prod 問題不知道要不要開票、工作做完或發版了但 Notion 狀態還停在舊值、想把 PR 或截圖當證據給客戶、客戶時程頁（交付項目）看不到這件工作、不知道某個 work item 對應哪張 ticket、Notion 現況與 git 實況對不上、拿不準該不該去碰 Notion、想在 skill 或文件裡寫 Notion 座標或狀態名。座標一律 registry/notion-hubs.json、欄位名一律 lib/notion-hub.ts FIELDS、寫入一律 notion-sync.ts
paths: ['tasks/**', 'specs/plans/**', '.claude/consumer-meta.json', 'registry/notion-hubs.json', 'vendor/scripts/notion-sync.ts', 'vendor/scripts/lib/notion-hub.ts', 'vendor/scripts/lib/notion-stage.ts', 'vendor/scripts/flow/notion-follow.ts', 'scripts/audit-notion-hub-schema.ts']
---
<!-- Clade native rule; source: rules/core/notion-work-coupling.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->
<!-- clade-adapters: claude,codex,cursor -->

# Work Item ↔ Notion Hub 耦合

**核心命題**：consumer 若屬於某個 Notion hub，工作的 Notion 狀態**不能跟 work item 生命週期脫鉤**，而且客戶看的時程頁（`交付項目`）**必須由機器維護**，不靠事後想起來。最常見的兩個漏洞：「做完了 / 發版了，但 ticket 還停在『進行中』」與「客戶時程頁上這件工作根本不存在或進度% 是上上週手填的」。本規則把「生命週期事件 → Notion 寫入」綁成明文步驟，全部經同一支 `notion-sync.ts`。

## Hub 模型（一個客戶一個 hub）

| 層 | Notion 上的東西 | 誰看 | 誰寫 |
| --- | --- | --- | --- |
| **ticket board** `Issue & Feature Ticket` | 客戶提報、或工程師發現的 bug / 需求，該 hub 所有專案共用一張 | 客戶 + 開發 | 客戶建票與客戶欄；machine 寫狀態 / 版本 / Work ID / PR，工程師建票時給客戶欄初值 |
| **主檔** `專案`、`里程碑` | 內部結構；`專案` 一列 = 一個 projectCode | 內部 | 人建列；進度% 是 rollup，沒有人手填的欄 |
| **交付項目**（在 `開發時程追蹤` 頁） | 客戶看的工作清單：一列 = 一個 work item 或合約交付項 | 客戶 | machine（`狀態` / `進度%` / `Work ID` / relation）；`預估完成日` 是**人確認後**才寫 |

`任務` 層**不投影**：`- [ ] N.M` 那層 task 留在 carrier，NEVER 同步到 Notion。

座標全部在 `registry/notion-hubs.json`（一個 hub 一組 board / 主檔 / 交付項目 / 時程頁 / 各 projectCode 的 page 與主檔列）。**NEVER** 在 rule / skill / 文件 / script 寫死任何 Notion id；要用就經 `vendor/scripts/lib/notion-hub.ts`（`resolveConsumerHub`，或 CLI `node vendor/scripts/lib/notion-hub.ts resolve`）。

## 觸發條件（兩者皆成立才生效）

1. **Consumer 屬於某 hub**：consumer metadata 宣告 `notion.hub` + `notion.projectCode`（schema 見 `registry/consumer-meta.schema.json`；hub 與 projectCode 必須在 `registry/notion-hubs.json` 存在）。未宣告 → 本規則**完全不生效**，`notion-sync.ts` 自己 exit 0 什麼都不做。
2. **有 work item**：`flow open` 拿到 work id。沒有 work item 的動作（讀 board、回 comment、問客戶）不在本規則，走 runtime 的 `notion-hub` skill。

ticket 連結是**選填**：work item 若來自客戶 ticket，`flow open --origin notion:<page-id>` 或 `notion-sync.ts open --ticket <page-id>` 把它釘住；來自 ROADMAP / 技術債的工作沒有 ticket，**照樣**在 `交付項目` 出現一列（這正是 Q5 的決策：交付項目 不綁死 ticket，不要為了出現在時程頁造假票）。

## 欄位契約（property key 一字不差）

欄位名的 canonical 寫法在 `vendor/scripts/lib/notion-hub.ts` 的 `FIELDS`；客戶改了欄名的 hub 在 `registry/notion-hubs.json` 宣告 `fields` 覆寫，所有 writer 只經 `hub.fields` 取名。**NEVER** 為某個 hub 在 script 或 skill 寫分支——差異只進 registry。下表以 canonical 名列 machine 會碰的：

| 表 | machine 寫 | 人確認後 machine 寫 | 客戶 / 人寫（machine NEVER 碰） |
| --- | --- | --- | --- |
| ticket board | `狀態` `修復版本 >=` `上線日期` `Work ID` `所屬專案` `備註` `優先級` `PR` | — | `名稱` `類型` `提報人` `提報日期` `截止日期` `檔案和媒體` `驗收日期`（`名稱` `類型` `提報日期` 只在 machine 自己建票時給初值） |
| 交付項目 | `狀態` `進度%` `Work ID` `專案` `里程碑` `原始 Ticket` | `預估完成日` | `Item`（建列時 machine 給初值，之後客戶可改字） |

**每個欄位只有一個 writer**。`PR` 是選配欄（board 還沒建時 `release` 跳過並提示）。`提報日期` 是客戶提報日不是發版日（歷史命名坑，2026-09-16 已從 `發布日期` 改名）；發版資訊寫 `修復版本 >=` + `上線日期`。

狀態與 `類型` 選項名**不是**契約：Notion API 不能改 status 選項，所以每個 hub 在 registry 的 `ticketStatus` 把同一套生命週期（backlog / needs-engineer / needs-customer / in-progress / acceptance / done / archived）對映到自己的字；`類型` 同理，`ticketType` 把 bug / feature 對映到本 hub 的選項（未經 live schema 驗證前不宣告，`file` 會拒寫）。`交付項目.狀態` 是 API 建的 select，各 hub 相同：`待處理 / 進行中 / 待驗收 / 完成`。

## 生命週期 → Notion 寫入

| work item 事件 | 指令 | ticket（有連結時） | 交付項目 |
| --- | --- | --- | --- |
| **工程師發現**（bug / 要做的功能） | `notion-sync.ts file --title "<客戶看得懂>" --kind bug\|feature --slug <slug> [--prod-url <url>] [--screenshot <png>]…` | 建票 → in-progress + `Work ID`（script 自己 `flow open --origin notion:<page>`）；`備註`=prod URL、內文問題截圖 | 只有 feature 建列；工程師發現的 bug **不建** |
| **真的開工**（`flow open` 成功） | `notion-sync.ts open --work <id> [--ticket <page>] [--title "<客戶看得懂的一句話>"]` | → in-progress + `Work ID` | upsert：`狀態` 進行中、`進度%` 25、`專案` relation、`Work ID` |
| 階段推進（`flow plan open`、`flow done` 自動觸發；中途勾 tasks **不自動**觸發——要人跑一次 `follow` 或 `status` 才反映） | `notion-sync.ts follow --work <id>` | 由 flow／plan 狀態推導，只往前（requirements → needs-engineer、PM 已確認 → in-progress） | 只更新既有列：requirements 階段 10、有 tasks.md 後 `進度%` = 25 + 65 × tasks 完成比（上限 90）、done 為 待驗收 90 |
| 中途進度（人給的絕對值） | `notion-sync.ts progress --work <id> --progress <n>` | — | `進度%` 絕對值 |
| **標 done**（`flow done`） | `notion-sync.ts done --work <id>` | 確保已是 in-progress | `狀態` 待驗收、`進度%` 90 |
| **發版**（`/commit` 出 tag 並 push） | `notion-sync.ts release --work <id> --tag "$(git describe --tags --abbrev=0)" [--prod-url <url>] [--screenshot <png>]…` | → acceptance + 版本 + `上線日期` + `PR`；`備註`=prod URL、內文驗收截圖 | `進度%` 100（狀態留 待驗收） |
| 給客戶承諾日期 | `notion-sync.ts eta --work <id> [--target YYYY-MM-DD]` → 回建議；**人確認後** `--confirmed` 重跑 | — | `預估完成日` |
| 客戶驗收後對帳 | `notion-sync.ts reconcile --work <id>` | 只讀 | 跟隨 ticket：done/archived → 完成、acceptance → 待驗收 |
| 客戶驗收 OK / 歸檔 | ❌ | `驗收中 → 完成`、`完成 → 封存` **客戶側，machine NEVER** | — |

### 掛載點（MUST）

- **發現即建票**：工程師在 prod／資料裡發現問題、或決定做一個功能時，**先** `file` 再動手——它同時鑄 work id，之後的推進全部自動。
- **flow 事件自動跟隨**：`flow plan open` 與 `flow done` 成功後，flow 以 detached 子行程觸發 `follow`（fail-open，未宣告 hub 的 repo 零成本；`CLADE_NOTION_FOLLOW=0` 關閉）。**NEVER** 在 work-route 或任何 skill 裡加「記得同步 Notion」步驟——Notion 跟隨 flow，不是 flow 呼叫 Notion。

- **`flow open` 之後、動第一個檔之前**：跑 `open`。
- **`flow done` 的收尾**：`follow` 已自動把 交付項目 推到 待驗收 90；收尾訊息明列「待 `/commit` 發版後跑 `release`」——標 done 的當下**還沒有**本次 tag（tag 是 `/commit` Step 5 才打），所以 `release` 一定在發版後。
- **`/commit` Step 6b**（tag 已 push、deploy 已觸發）：同一主線**立即**跑 `release`。consumer 有 post-push CI watcher 時 SHOULD 等綠燈再跑。**NEVER** 留給「下次想起來」。
- **`預估完成日`**：任何要寫它的時機（開工、客戶問、里程碑排程）**MUST** 先跑不帶 `--confirmed` 的 `eta` 拿建議（來源優先序：`flow eta` 宣告 → Notion 現值 → 無），用 runtime 的詢問介面讓使用者確認**那個日期**，確認後才帶 `--confirmed` 寫。NEVER 用模板數字，NEVER 沒問就寫。

### 客戶面證據契約（D2）

| 證據 | 放哪 | 誰寫 |
| --- | --- | --- |
| consumer prod 網域上看得到問題／修正的完整 URL | `備註` | `file` / `release` 的 `--prod-url` |
| 問題畫面、驗收畫面截圖 | 票內文（image block，標題「問題畫面」／「驗收畫面（<tag>）」） | `file` / `release` 的 `--screenshot` |
| GitHub PR | `PR` 欄（工程師側） | `release`（從 work item 的 commit／url artifact 查） |
| CI run、merge commit、tag URL | 只留 flow artifacts | — |

- `備註` 與票內文 **NEVER** 出現 github.com 連結，或 consumer prod 網域以外的網址；`notion-sync.ts` 寫入前拒絕（`customerFacingViolation`）。prod 網域取自 consumer `.claude/consumer-meta.json` 的 `deploy.prodUrl`（退回非 localhost 的 `NUXT_PUBLIC_SITE_URL`），沒宣告就拒寫。
- `檔案和媒體` 是客戶欄，machine **NEVER** 寫——截圖一律進內文。

### needsDecision（script 不寫、回報給呼叫端問）

| predicate | 為什麼不能自動 |
| --- | --- |
| `eta-needs-human` | 客戶看得到的承諾日 |
| `customer-side` | ticket 已在 驗收中 / 完成 / 封存，machine 不改回 |
| `transition-refused` | 轉移不在 `MACHINE_TICKET_TRANSITIONS` |
| `status-regression` | Notion 現況比即將寫入的值更後面——有人手動動過（`--force-overwrite` 是問過之後的回填） |
| `progress-regression` | 生命週期推進（open / done / release）要寫的 進度% 低於現值——重跑舊階段或有人手動改過 |
| `ticket-bound-elsewhere` | 連結 ticket 的 `Work ID` 已是別的 work item；script 對這件工作**整個不寫**，不當作沒有 ticket 繼續 |
| `tag-not-containing-head` | release 的 tag 不包含目前 HEAD，證明不了修正已在版本內（人確認後 `--confirmed`） |
| `unknown-status` | ticket 現況對映不到 hub 的 `ticketStatus`，或 交付項目 `狀態` 不在四個 API 選項內 → registry 過期或有人改了選項 |

呼叫端拿到 `needsDecision` 非空 → 用 runtime 的詢問介面問，帶答案重跑同一指令。**NEVER** 因為判不了就 silent skip，也 **NEVER** 自動執行任一條。

## 執行機制

- **Runtime**：確定性 script（`notion-sync.ts`、`lib/notion-hub.ts resolve`、`scripts/audit-notion-hub-schema.ts`）主線直接跑；自由形式的 Notion 讀寫一律 `ntn api`（**NEVER** Notion MCP／WebFetch），走 [[agent-routing]] 〔`notion-ops`〕（gemini → luna → blocker），**NEVER** 主線第一手自己跑。transport 是 `lib/notion-client.ts` 直接呼叫 Notion HTTPS API（token 取自 `ntn login` 的 auth 檔；同一份 API version / timeout / sidecar），不經 `ntn` CLI 子行程。
- **寫入前**：script 用 `hub.fields` 對 data source 現況做 schema 檢查，缺欄位就以「疑似 schema drift」中止，**NEVER** 猜。常駐對帳跑 `node scripts/audit-notion-hub-schema.ts`（exit 1 = drift，2 = 讀不到 live schema，n/a **NEVER** 讀成 0 drift）；drift → 補 registry `fields`／`ticketType`，**NEVER** 改 `FIELDS` 或在 script 分支。
- **失敗模式**：所有寫入是絕對值 SET；讀失敗中止；寫入 timeout 留 marker 在 `<consumer>/.clade/notion-sync-pending/` 不自動重試，`notion-sync.ts pending` 列出、下一個自然觸發點重跑（重跑 idempotent）。
- **Work ID 是對帳鍵**：ticket 與 交付項目 都存 `Work ID` = `<consumerId>/<workId>`（`lib/notion-hub.ts` `encodeWorkKey` / `parseWorkKey`；flow work id 只在單一 repo 內唯一，而 projectCode 可被多個 repo 共用），反查時再限定本專案 relation。reconcile / scan 先用它精確對，找不到才退回標題關鍵字（模糊、有 false positive）。

## Consumer 採用

```jsonc
"notion": { "hub": "fc", "projectCode": "<consumer-b>" }
```

- consumer-self 決策（per [[consumer-meta]] § Adoption），**NEVER** 由 clade 主線替 consumer 填。
- 新 hub / 新 projectCode → 先照 `vendor/snippets/notion-hub/README.md` 範本在 Notion 建好（主檔加一列、專案頁），再改 `registry/notion-hubs.json`，跑 schema 稽核到 exit 0。consumer 同時宣告 `deploy.prodUrl`，否則 `--prod-url` 證據一律拒寫。registry **不投影**到 consumer（它列了客戶名與 Notion id，正是 audit-clade-leak 要擋的東西）；Notion ops 只在有 `ntn login` 與 clade checkout 的機器跑，reader 經 `CLADE_HOME` 或 `~/offline/clade` 找 registry。

## 與「對外輸出需 user 授權」的關係

consumer 宣告 `notion.hub` 即等同授權流程在**machine 欄位 + 授權轉移表**內自動推進；表外的（客戶側轉移、`預估完成日`、改客戶欄）仍需當次明確授權。

## Cross-ref

| 主題 | 真相層 |
| --- | --- |
| hub 座標 / 狀態字彙 / projectCode | `registry/notion-hubs.json`（schema 同目錄） |
| 欄位契約 / 授權轉移 / 欄位所有權 | `vendor/scripts/lib/notion-hub.ts`（`FIELDS` `COLUMN_OWNERSHIP` `MACHINE_TICKET_TRANSITIONS`） |
| 寫入實作 | `vendor/scripts/notion-sync.ts`（唯一寫入路徑，所有掛載點共用） |
| 人主動發起的五個意圖（看板／認領客戶票／工程師建票／問客戶／對帳驗收） | runtime 的 `notion-hub` skill |
| 階段推導（flow／plan → ticket 階段、進度%） | `vendor/scripts/lib/notion-stage.ts`；hook 在 `vendor/scripts/flow/notion-follow.ts` |
| live schema 對帳 / 新 hub 範本 | `scripts/audit-notion-hub-schema.ts` / `vendor/snippets/notion-hub/README.md` |
| consumer 能力宣告 | [[consumer-meta]] |
| work item 開卡 / carrier / origin | [[flow-work-tracking]]、[[session-tasks]] |
| 發版 / tag 產生點 | [[commit]] Step 5、Step 6b |

## 違反時的回報方式

```
[notion-work-coupling] Notion 漏同步

問題：work item <id>（hub <hub> / <projectCode>）在 <生命週期事件> 後未跑 notion-sync.ts <command>

修正：
  - node ~/offline/clade/vendor/scripts/notion-sync.ts <command> --work <id> [--tag <tag>]
  - needsDecision 非空 → 問完帶答案重跑

繞過：
  - consumer 不屬於任何 hub → consumer metadata 不放 notion 區塊即 silent no-op
```
