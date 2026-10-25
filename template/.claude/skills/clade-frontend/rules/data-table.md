---
description: Nuxt 專案寫伺服器端分頁的資料表格（列表頁的分頁／排序／搜尋／篩選、欄位顯示切換、多選、CSV 匯入、批次刪除）時的狀態與互動判準
paths: ['app/**/*.vue', 'packages/*/app/**/*.vue', 'layers/*/app/**/*.vue', 'app/composables/**/*.ts', 'packages/*/app/composables/**/*.ts', 'layers/*/app/composables/**/*.ts', 'pages/**/*.vue', 'packages/*/pages/**/*.vue', 'components/**/*.vue', 'packages/*/components/**/*.vue']
---
<!-- Clade native rule; source: rules/modules/framework/nuxt/data-table.md; edit canonical source -->
<!-- clade-targets: claude,agents -->

# Data Table（伺服器端資料表格）

本規約對**每一個**資料列來自分頁 API 的表格生效，不是只有新寫的那一張。各節以「命中這個情境」為條件，彼此獨立。

鄰接規約：`useAsyncData` key 怎麼定 → [[nuxt-data-perf]] HR-2；儲存格的貨幣／數字／日期格式與 CSV 匯出 → [[display-value-integrity]]；列表 API 的 query 與回應形狀 → `server-api` skill 的列表查詢判準（[[server-api]]）。

## 查詢狀態

表格的查詢狀態＝`page`、`pageSize`、`sort`、`search`、已套用的 `filters`。

- **頁碼重設**：`search` 或 `filters` 變動 → `page` **MUST** 回到 1（結果集換了，停在第 5 頁常常是空頁）。`sort` 變動不重設。`pageSize` 變動後 `page` 超過新的 `totalPages` 時夾回最後一頁。
- **與 URL 雙向同步**：初次載入從 route query 讀出查詢狀態（不合法的值退回預設值）；之後每次變動用 `router.replace` 寫回 route query。只讀一次不寫回＝重新整理、分享連結、上一頁都會丟掉使用者的篩選。用 `replace` 不用 `push`，否則每打一個字都多一筆瀏覽紀錄。
- **篩選契約單一來源**：篩選樹（group and/or＋condition field/operator/value）的型別與 Zod schema 只在 `shared/` 定義一份，前端篩選元件與 server 解析都 import 它。**NEVER** 前端自己另寫一份 operator 清單——兩邊漂移時 server 會拒絕或忽略前端送來的條件。

## 篩選草稿與已套用

篩選面板可以一次改多個條件時：

- 維持兩份狀態：`draft`（面板內正在編輯的）與 `applied`（表格查詢實際用的）。表格查詢**只讀** `applied`；按「套用」才把 `draft` 複製到 `applied`。
- `applied` 被面板以外的路徑改變（上一頁還原 URL、清除全部、移除單一篩選 chip）時，`draft` **MUST** 以 `applied` 重設——否則下次打開面板看到的是過期草稿，一按套用就把剛移除的條件加回來。
- 「已啟用 N 個篩選」的 N 只算**有值**的條件，加上**不需要值**的 operator（為空、不為空）；空白條件不計。

## 欄位顯示切換

- 顯示／隱藏以欄位的 `accessorKey`（或 column `id`）為單位。選取欄與操作欄 **MUST** 設成不可隱藏（`enableHiding: false`）。
- 隱藏設定依 resource key 持久化（例：`table-columns:<resource>`），讀回時忽略已不存在的欄位 key。不持久化＝使用者每次進頁都要重新關一次欄位。

## 多選

- 選取欄由同一支 composable 產生並插在第一欄，**NEVER** 每張表各自手刻。
- 表頭 checkbox 三態：全選、未選、部分選（indeterminate）。每個 checkbox（表頭與每一列）**MUST** 有 `aria-label`。
- `getRowId` **MUST** 回傳 record id，**NEVER** 用列索引——用索引時換頁或重新排序後，選取會落到另一筆資料上。
- 資料重新載入（refresh、換頁、篩選變動）後清空 `rowSelection`。

## CSV 匯入

- 解析 **MUST** 用成熟的 CSV parser（例如 `papaparse`）。**NEVER** 以 `split('\n')`／`split(',')` 自拆——引號內的逗號與換行、CRLF、UTF-8 BOM 都會讓欄位錯位，而且不會報錯。
- 流程是三步：上傳 → 欄位對應 → 結果。欄位對應時 CSV 表頭與 resource 欄位的 key 或 label 不分大小寫比對、自動帶入；每個 CSV 欄位都可以選「略過」。resource 的必填欄位還有任何一個沒對應到 CSV 欄位時，「下一步」**MUST** 停用並標出缺哪幾個——放行的話每一列都會以同一個原因失敗。
- 結果頁**每一筆**輸入列都要落在「已匯入／已略過（附原因）／錯誤（附列號與可讀訊息）」其中之一，三者加總等於輸入列數。列號 **MUST** 是使用者在試算表裡看到的列號：資料列的 0-based index 加上表頭列數再加 1（一列表頭時，第一筆資料是第 2 列）；server 回的若是陣列 index，由前端換算後再顯示。**MUST NOT** 靜默丟列——使用者沒有辦法發現少了哪幾筆。server 端批次匯入的回應契約見 [[api-patterns]]。

## 批次刪除

- 送出前 **MUST** 先確認，確認框寫出要刪幾筆。
- 走批次 endpoint；沒有批次 endpoint 時用 `Promise.allSettled` 並行送出並統計結果。**NEVER** 用逐筆 `await` 迴圈遇到第一筆失敗就停，也 **NEVER** 在有任何一筆失敗時顯示「刪除成功」。
- 結束後回報「N 筆成功、M 筆失敗」（M > 0 時列出失敗的是哪幾筆），然後 refresh 表格並清空選取。
