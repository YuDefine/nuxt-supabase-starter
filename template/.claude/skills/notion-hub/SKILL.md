---
name: notion-hub
description: "所有 Notion 讀寫的唯一入口（ntn api；NEVER WebFetch／Notion MCP）。Use when 看 board／進度、認領或建客戶票、建決策題問客戶、問驗收、開 hub，或給 Notion 連結要查找／讀取／修改頁面。NOT for 狀態同步（notion-sync）、會議錄音寫入（meeting-notes）、clade 內部待拍板題（flow ask）。"
---


# notion-hub

所有 Notion 讀寫的唯一入口：當前 consumer 所屬 hub（ticket board＋客戶看的 `交付項目`；hub 可省略交付項目、把進度併進 board `進度%`）的六個意圖，加上任何 Notion 頁面的查找與更新；生命週期同步由 flow 事件與 `notion-sync` 自動推進。所有客戶的 hub 共用同一個 workspace，頁面屬於哪個客戶只認 `notion-scope.ts` 的判定。規約在 [[notion-work-coupling]]，跨 hub 架構與七階段速查見 clade home 的 `vendor/snippets/notion-hub/lifecycle.md`。

# SOP

## Phase 1 -- 解析 hub 並選定意圖

1. DELEGATE 執行 `node ~/offline/clade/vendor/scripts/lib/notion-hub.ts resolve --consumer-path .`；輸出 `configured:false` 時只剩 Phase 8 可走（不屬於任何 hub），其餘意圖回報「此 repo 未宣告 notion.hub」並停止，不猜 board。
2. READ 讀取 resolve 輸出的 `hub.ticketStatus`、`hub.ticketType`、`hub.fields`，後續狀態字、類型字與欄位名一律以它們為準；懷疑欄位或選項被改過時 DELEGATE `node ~/offline/clade/scripts/audit-notion-hub-schema.ts --hub <key>`。
3. THINK 先讀取 `rules/Notion執行者與ntn呼叫判準.md`，再依使用者請求選定意圖：看板（Phase 2）、認領客戶票（Phase 3）、工程師建票（Phase 4）、問客戶（Phase 5）、對帳驗收（Phase 6）、開 hub／加專案（Phase 7）、查找或更新 Notion 頁面（Phase 8）。

## Phase 2 -- 看板（唯讀）

1. DELEGATE 經〔`notion-ops`〕依 `references/ntn-cookbook.md` § 讀取 撈本專案票（報告模式另撈交付項目），dump 到檔回傳。
2. THINK 先讀取 `rules/看板分桶與對帳判準.md`，逐張分桶、對帳並標 `⚑`；報告模式另列逾期。
3. WRITE 回報分桶結果；有 `⚑` 時結尾首要建議對應意圖。不改任何欄位。

## Phase 3 -- 認領客戶票

1. DELEGATE 經〔`notion-ops`〕讀票（raw＋客戶 comment），再以 codebase-memory 定位 root cause 與修法草案。
2. THINK 先讀取 `rules/認領分流判準.md`，判可直接做／要客戶先拍板（轉 Phase 5）／前提不成立，並區分是否為 coordinator 派來的票。
3. DELEGATE 可直接做時，先讀取 `rules/客戶面證據判準.md` 定稿 `--title`，再執行 `flow work open <slug> --origin notion:<page-id>`（coordinator 派來的票跳過）與 `node ~/offline/clade/vendor/scripts/notion-sync.ts open --work <id> --ticket <page-id> --title "<客戶看得懂的一句話>"`，交棒 work-route。

## Phase 4 -- 工程師建票

1. DELEGATE 先讀取 `rules/客戶面證據判準.md` 定稿標題與證據，再執行 `node ~/offline/clade/vendor/scripts/notion-sync.ts file --title "<客戶看得懂的一句話>" --kind bug|feature --slug <slug> [--prod-url <prod 頁面>] [--screenshot <png>]…`（已有 work item 用 `--work <id>` 代替 `--slug`）；照做它印的 `export CLADE_WORK_ID=…` 後交棒 work-route，拒寫時依已載入判準修正來源。

## Phase 5 -- 問客戶（決策題 ticket）

1. THINK 先讀取 `rules/決策題撰寫判準.md`，確認符合開決策題的條件（只問一句就改在既有票留 comment），並一次萃取需求標題、拍板題與 code pointer；再讀取 `reply-article` skill 根下的 `rules/對外提問完整性判準.md`，依它排定拍板題順序、把處置題對象寫成類別，並逐個選項推演到客戶答完就能動工。
2. WRITE 先讀取 `templates/客戶決策題ticket.md` 與 `templates/客戶決策題ticket.example.md`，再讀取 `rules/客戶面證據判準.md`，依骨架組出 4 段內容與接手 prompt。
3. DELEGATE 建頁前派 `question-reviewer` 審查（省略 `model`），brief 寫明組好的票面內容、上述判準檔的絕對路徑與回覆者身分；Blocker 修完再審一次，最多兩輪，仍有分歧就整理成排序選項交給 Charles；審查席不可用時主線依同一份判準自審，回報寫明「未經審查席」。
4. DELEGATE 經〔`notion-ops`〕先以 `ntn api "/v1/data_sources/<board>" < /dev/null` 重撈 schema，再依 `references/ntn-cookbook.md` § 建決策題票建頁（`類型` 用 `hub.ticketType.feature`，bug 修正類改用 `hub.ticketType.bug`）；拿到 page id 後回填接手 prompt【第一步】，已有 work item 時再跑 `notion-sync.ts open --work <id> --ticket <page>`。
5. WRITE 先讀當前 repo `HANDOFF.md` 的格式，append 同步條目（ticket URL＋page id、N 題、接手方式），再回報 ticket URL、題數、HANDOFF 位置與接手方式。

## Phase 6 -- 對帳驗收

1. DELEGATE 對本 projectCode 驗收中的票逐張讀 `Work ID`，執行 `node ~/offline/clade/vendor/scripts/notion-sync.ts reconcile --work <id>`；客戶側已完成者對該 work item 執行 `flow work accept`（`accepted_by: customer`，per [[flow-work-tracking]]）。
2. THINK 發版但票仍進行中時，回報 `/commit` Step 6b 的 `release` 沒跑並補跑 `notion-sync.ts release --tag <tag>`。

## Phase 7 -- 開 hub／加專案

1. THINK 先讀取 `rules/hub-provision判準.md`，判新客戶（複製 Org 模板）或既有 hub 加專案（複製該 hub 的專案範本）；目前在 consumer session 就 relay 給 clade 主線並停止。
2. DELEGATE 依 `references/ntn-cookbook.md` § Provision 執行複製、移動、改名與 view filter，逐步讀回確認。
3. WRITE 登記 `registry/notion-hubs.json`，再 DELEGATE `audit-notion-hub-schema.ts --hub <key>` 與 `notion-intake.ts --hub <key>`，兩者都必須 ok。

## Phase 8 -- 查找或更新 Notion 頁面

1. DELEGATE 找頁面執行 `node ~/offline/clade/vendor/scripts/notion-scope.ts search --query <關鍵字> --consumer-path .`，使用者給了連結或 id 執行 `notion-scope.ts owner <連結或 id>… --consumer-path .`，取得每頁歸屬；**NEVER** 直接用 `ntn api /v1/search` 的結果。
2. THINK 先讀取 `rules/頁面歸屬判準.md`，只用範圍內的頁面回答與歸納；要讀內文時經〔`notion-ops`〕依 `references/ntn-cookbook.md` § 讀取 dump 到檔。
3. DELEGATE 要寫入時先過 `rules/頁面歸屬判準.md` § 寫入 gate（對寫入目標跑 `notion-scope.ts owner`），放行才經〔`notion-ops`〕依 `references/ntn-cookbook.md` § 寫入 寫入，並讀回確認。
