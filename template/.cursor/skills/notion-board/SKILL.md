---
name: notion-board
description: "Inbound 管理當前 consumer 所屬 Notion hub 上客戶既有的 ticket：scan 分桶、triage 評估、sync 回寫、reconcile 對帳、report 全景。Use when 使用者要看 board、評估某張 ticket、同步狀態、對帳或要進度報告。NOT for 主動建新 ticket 問客戶（走 notion-ticket），NOT for 未宣告 notion.hub 的 repo。"
---


# notion-board

當前 consumer 所屬 Notion hub 的 ticket board **inbound 全生命週期管理員**：客戶在 Notion 口語化建 ticket（bug / 需求）→ 本 skill 負責**讀取、分流、評估、開發中狀態同步、git 對帳、進度全景、跟客戶雙向 comment**。

核心命題：最大的時間黑洞是「逐張讀客戶口語 → 對應到 codebase → 規劃 → 做完還要記得回 Notion 改狀態填版本」。本 skill 把這條 loop 自動化到**開發側可自動推進、客戶側絕不亂碰**的程度。

## 與 /notion-ticket 的分工（兩者方向相反）

| | `/notion-ticket`（outbound） | `/notion-board`（本 skill，inbound） |
| --- | --- | --- |
| 方向 | Claude → 客戶（主動發問） | 客戶 → Claude（接收處理） |
| 動作 | **建一張新的決策題 ticket**，埋 handoff prompt 等客戶拍板 | **管理客戶已建的 ticket**：讀 / 分流 / 同步 / 對帳 / 報告 |
| 觸發 | 「建 ticket 問客戶」「問客戶 N 題」 | 「看一下 board」「掃 ticket」「同步狀態」「進度報告」「這張怎麼修」 |

> 邊界：**要不要新建一張 page 主動發問客戶** → `/notion-ticket`。**處理已經在 board 上的東西** → 本 skill。triage 時發現某 ticket 需要客戶先拍板，本 skill 轉呼叫 `/notion-ticket` 的撰寫規約留 comment 或建決策題。

**Runtime**：本 skill 的 Notion 讀寫走 Routing Table 〔`notion-ops`〕——Pi `--model gemini --effort high`；exit 2／3／4 → luna（`--route fallback-chain --tier-basis quota-fallback --retry-of <label>`，不帶 `--table-row`）；luna 再失敗才回主線。**NEVER** 主線第一手自己跑 `ntn`／MCP。**NEVER** `luna-cursor`。

## 開工前置（每次必做）

1. **解析 hub**：`node ~/offline/clade/vendor/scripts/lib/notion-hub.ts resolve --consumer-path . ` → 拿 `hub.board.dataSourceId`、`hub.ticketStatus`（本 hub 的狀態字）、`projectCode`、`project.rowId`。`configured:false` → 回報「此 repo 未宣告 notion.hub」並**停止**，不要猜 board。
2. **狀態字一律用 `hub.ticketStatus`**（backlog / needs-engineer / needs-customer / in-progress / acceptance / done / archived 對映到本 hub 的字）。**NEVER** 憑記憶寫「未開始」「需確認」——不同 hub 不同字（fc 是 `待處理 / 需工程師確認 / 需使用者確認`，<client-a> 是 `未開始 / 需確認`）。
3. **欄位名一律從 `FIELDS.board`**（同一支 resolve 的輸出有 `fields`），property key 含中文、全形空格、`>=`，copy-paste 不手打。寫入前 script 會對 data source 現況做 schema 檢查。
4. **自動化邊界是 hard rule**（[[notion-work-coupling]] § 欄位契約）：machine 只寫 `狀態`（授權轉移表內）、`修復版本 >=`、`上線日期`、`Work ID`、`所屬專案`、`備註`、`優先級`；客戶側 `名稱` / `類型` / `提報人` / `提報日期` / `截止日期` / `檔案和媒體` / `驗收日期` 與 `驗收中→完成`、`完成→封存` **NEVER** 碰。
5. **狀態寫入只走 `notion-sync.ts`**（open / done / release / reconcile），本 skill 不自己 PATCH `狀態`。唯一例外是 triage 的 `backlog → needs-customer / needs-engineer`（script 沒有這個入口）：用 `ntn api -X PATCH` 寫單一 `狀態` 欄，且狀態字取自 `hub.ticketStatus`。
6. 客戶附圖（in-app 截圖）public API 拿不到 → 走 [reference/cookbook.md](reference/cookbook.md) § 附圖方案 C。

## 子命令

### `scan` — board 全掃 + 分桶（Intake，唯讀）

1. `ntn api -X POST "/v1/data_sources/<board.dataSourceId>/query" -d '{"page_size":100,"filter":{"property":"所屬專案","relation":{"contains":"<project.rowId>"}}}' > /tmp/board.json`，`has_more` 翻頁，dump 到檔再解析。**只掃本 projectCode 的票**（board 是 hub 共用，別把其他專案的票混進來）；使用者明說要看全 hub 才拿掉 filter。
2. 依 `狀態`（用 `stageOf` 語義）分桶：
   - 🆕 **新進未處理**：backlog 且 `Work ID` 空
   - 🚧 **進行中**：in-progress —— **每張** MUST 做 git cross-ref（步驟 3.5）
   - ⏳ **待客戶驗收**：acceptance
   - ❓ **等拍板**：needs-customer / needs-engineer
   - ⚠️ **stale**：in-progress / acceptance 且 `提報日期` 距今 > 14 天仍未進展
   - ✅ **已收斂**：done / archived（預設摺疊，只報數量）
3. 對 🆕 桶中 `類型=需緊急修` 或 `優先級=P0` 的，**自動**做輕量初判（不改欄位）：root cause 方向一行 + codebase-memory 定位疑似檔 + `estimate-hours` 估工時。
3.5. **進行中防漏（MUST）**：對 🚧 每張先讀 `Work ID`（格式 `<consumerId>/<workId>`）。非空且前綴 ≠ 本 repo consumerId → 標 `⚑ 屬別 repo` 跳過；前綴相符 → 取 `/` 後的 workId， `node ~/offline/clade/vendor/scripts/notion-sync.ts status --work <id>` 看 spine 狀態（done / accepted 但 ticket 仍 in-progress → 標 `⚑ 疑似已修好待同步`）；空 → 退回 cookbook § git 模糊對帳。
4. 輸出精煉摘要表，**不改任何狀態**。有 `⚑` → 結尾首要建議跑 `reconcile`。

### `triage <ticket-id|關鍵字>` — 單張深入評估

1. `ntn api "/v1/pages/<id>"` 拿 raw；要好讀 markdown / 客戶 comment 用 MCP `notion-fetch` / `notion-get-comments`。
2. codebase-memory（`search_graph` / `trace_path` / `get_code_snippet`）定位相關 code，做 root cause + 修法草案。
3. **三向分流**：
   - **可直接做** → 經 user 同意後：`flow open <slug> --origin notion:<page-id>` 開卡，**緊接著** `notion-sync.ts open --work <id> --ticket <page-id> --title "<客戶看得懂的一句話>"`（ticket → in-progress + `Work ID`；交付項目 建列）。接 `/wt` 開工。
   - **要客戶先拍板** → `狀態` 寫 `hub.ticketStatus['needs-customer']`，留 comment 問客戶（口語化、給選項情境，比照 `/notion-ticket` 撰寫規約）；決策題夠多時轉 `/notion-ticket` 建結構化決策段。
   - **前提不成立 / 重複 / 已修** → 回報 user，建議客戶側處理（封存類不自動碰）。
3a. **carrier 登記（MUST，在任何 Notion 寫入或開工之前）**：task 檔 / plan 最上方一行 `> **Notion ticket**: <url>（page_id: <id>）`（per [[notion-work-coupling]]），另在 `HANDOFF.md` 登記一筆「修完 → `notion-sync.ts done`，發版 → `release`」。
4. triage 結論可選擇性 `insert_content` 一段「🛠 開發備忘」到 ticket 內文，方便客戶 / 未來 session 看。

### `sync <ticket-id|關鍵字>` — 開發完回寫

「做完了同步 Notion / 更新狀態 / 填版本」時跑。**這是最容易漏的人工步驟。**

1. 找到 ticket 的 `Work ID`，以第一個 `/` 切出 consumerId 與 workId（consumerId ≠ 本 repo → 這張不歸本 repo，停）（沒有 → 先問 user 這張對應哪個 work item，或 `flow open` 補開）。
2. 未發版（`git describe --tags` 拿不到含本次 fix 的 tag）→ `notion-sync.ts done --work <id>`（交付項目 → 待驗收；ticket 留 in-progress）。**不填版本**，版本是已發版證據。
3. 已發版 → `notion-sync.ts release --work <id> --tag <tag>`（ticket → acceptance + `修復版本 >=` + `上線日期`；交付項目 進度% 100）。
4. `needsDecision` 非空 → 用 AskUserQuestion 問，帶答案重跑。**NEVER** 自動執行客戶側轉移。
5. 多張同次發版 → 逐張跑（script per work item），收尾列表回報。

### `reconcile` — git ↔ board 已發版對帳

「哪些其實已修好沒改狀態 / 對一下 git 跟 board / 發版後同步看板」時跑。

1. 撈本 projectCode 全部 in-progress 的票。
2. 有 `Work ID` 且前綴是本 repo → `notion-sync.ts status --work <workId> --json`：輸出的 `rows.work.state` 為 done / accepted 且 `rows.work.artifacts` 內有 `tag` 類 artifact → **sync 候選**（版本 = 該 tag）；沒有 tag artifact 就 `git tag --contains <commit artifact>` 補查。
3. 沒 `Work ID` → cookbook § git 模糊對帳（標題抽關鍵字 grep + `git tag --contains`），命中標 `needs-human-confirm`。
4. **MUST 向 user 展示候選清單 + 每張證據，逐張取得明確 OK 後才回填**（走 `sync` 步驟 3）。**NEVER** 自動批次改 board。
5. 交付項目 側：對已由客戶標 `完成` 的 ticket 跑 `notion-sync.ts reconcile --work <id>` 讓 交付項目 跟上。

### `report` — 進度全景（唯讀）

同 `scan` 撈全量，輸出管理視角：各狀態筆數 + 緊急未開始（`優先級` / `類型`，按 `提報日期` 新→舊）、stale 清單（含卡多久）、近期已發版對照（`修復版本 >=` ↔ tag）、待客戶驗收清單。另撈 `交付項目`（filter `專案` relation = project.rowId）列 `逾期` 為 true 的。**不改任何欄位。**

## 雙向 comment

- 問澄清：`notion-create-comment`（口語化、給選項情境，禁技術術語）。讀回覆：`notion-get-comments`。
- **MUST NOT** 主動建議「N 天後幫你 ping 客戶」（per 全域 CLAUDE.md § 不要把工作往後放）。客戶沒回就回報「還沒回」並結束。
- 內文 / 備註提到系統頁面 **MUST** 給完整 prod URL（見該 consumer `.env` 的 `NUXT_PUBLIC_SITE_URL`），相對路徑客戶打不開。

## 常見坑

1. **狀態字憑記憶** → 用 `hub.ticketStatus`；fc 與 <client-a> 不同字，寫錯 Notion 直接拒絕。
2. **把「提報日期」當發版日** → 那是客戶提報日；發版寫 `修復版本 >=` + `上線日期`（由 `release` 寫）。
3. **沒發版就填版本 / 推 acceptance** → 版本是已發版證據。
4. **自動推到「完成 / 封存」** → 客戶側，script 會拒絕；只能查 + 經 user 同意留提醒。
5. **改客戶的 `名稱` / 刪客戶證據圖** → 永不動。
6. **忘了 `Work ID`** → 等於放棄精準對帳，逼 `reconcile` 退回模糊 grep。`triage` 開工時 MUST 經 `notion-sync.ts open` 寫上。
7. **scan / report 動到欄位** → 兩者唯讀。
8. **掃到別專案的票** → board 是 hub 共用，預設 filter `所屬專案` = 本 projectCode。
9. **自己 PATCH 狀態繞過 script** → 授權表、regression 偵測、sidecar 都在 script；繞過就沒有保護。
10. **在 skill / 文件寫 Notion id** → 一律 `registry/notion-hubs.json`。

## 觸發訊號 cheatsheet

- 「看一下 ticket / board / 看板」「客戶丟了什麼」「有哪些新的」→ `scan`
- 「這張怎麼修 / root cause / 評估一下」→ `triage`
- 「做完了同步 Notion / 更新狀態 / 填版本」→ `sync`
- 「哪些其實已修好沒改狀態 / 對一下 git 跟 board / reconcile / 發版後同步看板」→ `reconcile`
- 「進度報告 / 還剩哪些 / 整體狀況 / 哪些卡住 / 逾期」→ `report`
- 「在 ticket 上回客戶 / 問客戶這張」→ comment

> 反向：「**建** ticket / **問** 客戶 N 題 / **發** ticket 給老闆拍板」是 outbound → `/notion-ticket`。
