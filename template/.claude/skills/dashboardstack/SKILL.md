---
name: dashboardstack
description: Nuxt admin／CRUD 後台、資源列表與表單、server-side 資料表格、CSV 匯入匯出、組織／成員權限：先讀已購 DashboardStack 參考實作再自組。NOT for 圖表／KPI 卡（用 nuxt-charts）、NOT for 單純 Pinia 狀態（用 pinia-store）、NOT for 新增 server API route（用 server-api）。
---


# DashboardStack

fleet 持有 DashboardStack **Commercial License**（2026-10-22 購入，5 seats，商業專案無限、一次性）。授權內容與取得方式：

| 種類 | 在哪 | 怎麼取得 |
| --- | --- | --- |
| Nuxt scaffold 原始碼（resource 系統 `defineResource`、通用 CRUD API、六種檢視、server-side table、CSV 匯入匯出、組織／成員／權限、事件、主題） | PRIVATE repo `YuDefine/nuxt-dashboard-layer`，首 commit `75218d4` 是 `ds init` 原樣（上游 diff 基準） | `gh repo clone YuDefine/nuxt-dashboard-layer` 到 session scratchpad 讀檔 |
| `@dashboardstack/runtime` | npm，MIT | 一般依賴，不受授權邊界限制 |
| `ds` CLI 與授權啟用 | 只在 desk（授權綁 1 台裝置） | 一般開發不需要；要重新 scaffold 才上 desk |

layer **還沒移植成 Supabase 版**（scaffold 是 D1＋R2＋CF Queues＋nuxt-charts v2），所以目前只能**當參考實作讀**，**NEVER** 讓 consumer `extends` 它。移植進度看 clade `specs/plans/W-2026-10-22-dashboardstack-adoption/plan.md`；移植完成後本 skill 的 Phase 3 改成「先 `extends` layer」。

clade 已從這份 scaffold 抽出判準寫成 rule（只寫判準、不貼原始碼）；本 skill 負責在實作當下把兩邊接起來：先看 DashboardStack 怎麼做，再用 clade rule 判哪些照搬、哪些要改。

# SOP

## Phase 1 -- 判定適用

1. THINK 需求碰到下列任一項就走本 skill：admin／後台的資源列表＋新增／編輯／刪除、伺服器端分頁的資料表格（排序、搜尋、篩選、欄位切換、多選、批次刪除）、CSV 匯入或匯出、看板／行事曆／時間軸等多種檢視、組織與成員管理、角色／權限設定頁、dashboard 外殼（側欄、全站日期區間、sheet）。只畫圖、KPI 卡、狀態頁走 `nuxt-charts`，兩者都碰到就兩支都跑（外殼與資料表格先本 skill，圖表區塊交 `nuxt-charts`）。

## Phase 2 -- 授權前置

1. READ 先讀取 `rules/授權邊界與移植差異.md` Rule 1，照它檢查目的 repo 的可見度。
2. THINK 目的 repo 不是 `PRIVATE`／`INTERNAL`（含查不到）：**跳過 Phase 3**，只讀 `rules/參考實作對照表.md` 右欄的 clade rule，直接進 Phase 4 自己寫，**NEVER** clone 或讀參考實作。是 `PRIVATE`／`INTERNAL` 才進 Phase 3。

## Phase 3 -- 讀參考實作（只限 PRIVATE／INTERNAL 目的 repo）

1. READ 先讀取 `rules/授權邊界與移植差異.md` Rule 4，照它驗 layer repo 仍是 PRIVATE 後 clone 到 session scratchpad（不放進 consumer repo）；印 `NOT-PRIVATE` 或 `CLONE-FAILED` 就停下回報。
2. READ 先讀取 `rules/參考實作對照表.md`，依需求找到要讀的檔與對應的 clade rule，兩邊都讀完才進下一步。**NEVER** 只讀參考實作就照抄，也 **NEVER** 只讀 clade rule 就從零寫（Phase 2 step 2 判定跳過本 Phase 的 PUBLIC repo 除外）。

## Phase 4 -- 落地

1. THINK 先讀取 `rules/授權邊界與移植差異.md` Rule 2，逐項判參考實作用到的 D1／R2／Queues／Better Auth／nuxt-charts v2 在目的 repo 要換成什麼；clade rule 與參考實作衝突時以 clade rule 為準。
2. WRITE 照判定落地，每個以參考實作為底的檔第一行寫來源註記，格式照 `rules/授權邊界與移植差異.md` Rule 3。
3. READ 圖表、KPI 卡、狀態區塊照 `nuxt-charts` skill 跑，**NEVER** 沿用 scaffold 的 nuxt-charts v2 寫法。

## Phase 5 -- 驗證

1. DELEGATE 跑目的 repo 的 typecheck 與 build。
2. DELEGATE 起 dev server 實際截圖，亮暗兩種主題都看，列表的分頁／排序／篩選、表單送出、匯入匯出、權限不足的畫面都要實際操作過。
3. WRITE 在 PR 說明或回報裡列出參考了哪些檔、對照了哪些 clade rule、哪些地方刻意與參考實作不同及原因。
