# Rule 1 - provision 在 clade 做，consumer session 只 relay，沒有外部客戶會看票的 repo 不建 hub

- Level: `MUST`
- 座標住在 clade `registry/`，所以開 hub／加專案在 clade 主線做；consumer session 只 relay 給 clade 主線，合入後回來在自己的 `.claude/consumer-meta.json` 宣告 `notion`（consumer-self 決策，[[notion-work-coupling]] § Consumer 採用）。
- 沒有外部客戶會看票的 repo 不建 hub。

## Good Example

- 這個例子是好的，因為 consumer 只送需求，registry 由 clade 改。

```text
erp session：「這個 repo 也要 ticket」→ relay clade 主線（客戶 fc、專案代碼 ERP2）→ clade PR 登記 registry → erp 宣告 notion
```

## Bad Example

- 這個例子是壞的，因為 consumer session 直接改 clade registry。

```text
erp session：編輯 ~/offline/clade/registry/notion-hubs.json 加 projects.ERP2
```

# Rule 2 - 依情境選複製來源：新客戶複製 Org 模板，既有 hub 加專案複製該 hub 自己的專案範本

- Level: `MUST`
- **新客戶或獨立 repo**（獨立 repo＝只有一個專案的 hub，同一套模型）→ 複製 clade `registry/notion-fleet.json` 的 `templates.org`：副本自帶 board／專案／里程碑、開發時程追蹤、`驗收完成` button，所有 linked view 自動改指副本自己的 board。開完 hub 順手把副本的「專案標準架構」登記成該 hub 的 `projectTemplate`（下一條就靠它）。
- **既有 hub 加專案** → 複製**該 hub 的專案範本**（registry `hubs.<key>.projectTemplate.pageId`，整份專案頁），範本裡的專案管理頁 view 已指向本 hub board，只要補篩選成新專案。hub 還沒有 `projectTemplate` 時才退回複製同 hub 已有的入口頁（`projects.<任一>.ticketPageId`），並把建範本列為該 hub 的待辦。**NEVER** 拿 Org 模板裡的專案頁來複製——它的 view 指回模板 board，頁面看起來完整，卻永遠看不到本 hub 的票。
- 複製來源的 view 可能本身就缺「所屬專案」篩選或帶失效 sort：先讀出 filter，**有**「所屬專案 contains」那條就把 rowId 換成新專案的，**沒有**才 append 一條——**NEVER** 不看現況就 append（殘留舊 rowId 再加一條會變成兩條 AND，新專案頁看不到任何票）。`audit-notion-hub-schema.ts` 的 `entry-*` 檢查會驗每個 `ticketPageId` 與 `projectTemplate.ticketPageId`，範本入口頁殘留專案篩選會報 `entry-template-project-filter-residual`；頁上除了本 hub 的 board／專案／里程碑／交付項目 view 還留著指向別的 data source 的 view（Org 模板或別 hub 複製殘留）會報 `entry-view-off-board-residual`（範本入口頁 drift、專案入口頁 warn），刪掉那個 view 才算乾淨。
- Board 的 database template **NEVER** 放工程師用的填寫規則或會議分析骨架：客戶按「New」就會看到，對客戶是干擾；填寫規則住 clade 規約。預設新票 = 空白。
- 收尾：專案主檔建列 → 入口頁 Ticket view 篩 `所屬專案` → 寫 `registry/notion-hubs.json`（A 新增整個 hub，ticketStatus／ticketType／fields 照 Org 模板＝fc 同一套字；B 只加 `projects.<CODE> = {pageId, rowId, ticketPageId}`）→ `audit-notion-hub-schema.ts --hub <key>` MUST ok。
- 改 view filter 時每次 provision 用自己的暫存目錄（`mktemp -d`），**NEVER** 固定 `/tmp` 路徑：並行或殘檔會把別頁的 filter 寫上去；寫完 GET 讀回核對。

## Good Example

- 這個例子是好的，因為既有 hub 加專案時複製該 hub 自己的專案範本，篩選補上新專案。

```text
fc hub 加 ERP2：duplicate hubs.fc.projectTemplate.pageId → 改名成 ERP2 專案頁 → 主檔建列 rowId → 專案管理頁 view filter 補「所屬專案 contains rowId」→ registry projects.ERP2 → schema 稽核 ok
```

## Bad Example

- 這個例子是壞的，因為從 Org 模板拿專案頁，view 會指回模板 board。

```text
fc hub 加 ERP2：duplicate Org 模板/專案標準架構/專案管理
```

# Rule 3 - 模板 NEVER 直接使用或填客戶資料，分享 NEVER 涵蓋含 Secrets 的專案頁

- Level: `MUST`
- 模板本身 **NEVER** 直接使用、**NEVER** 填客戶資料。
- 複製來源若是別客戶的 hub，先確認副本不帶對方資料。
- 分享給客戶時只分享 hub（或入口頁）那一層；專案頁底下若有 Secrets／內部子頁，**NEVER** 分享整個專案頁。

## Good Example

- 這個例子是好的，因為只分享入口頁。

```text
分享：Ticket 管理（fc）入口頁 → 客戶帳號 can comment；專案頁（含 Secrets）不分享
```

## Bad Example

- 這個例子是壞的，因為直接在模板上建客戶的票。

```text
Org 模板 board 新增一張「fc：出貨單展開很慢」
```
