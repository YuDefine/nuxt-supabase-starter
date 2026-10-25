---
description: Nuxt 專案做 admin／CRUD 後台、伺服器端分頁資料表格、CSV 匯入匯出、組織／成員／權限頁時，先載入 dashboardstack skill 讀 fleet 已購的參考實作，再交其他 UI skill
paths: ['app/**/*.vue', 'packages/*/app/**/*.vue', 'layers/*/app/**/*.vue', 'app/composables/**/*.ts', 'packages/*/app/composables/**/*.ts', 'layers/*/app/composables/**/*.ts', 'server/api/**/*.ts', 'packages/*/server/api/**/*.ts', 'layers/*/server/api/**/*.ts']
---
<!-- Clade native rule; source: rules/modules/framework/nuxt/dashboardstack-reference-first.md; edit canonical source -->
<!-- clade-targets: claude,agents -->

# DashboardStack 參考實作優先

fleet 持有 DashboardStack Commercial License：整套 Nuxt admin／CRUD scaffold 的原始碼收在 PRIVATE repo `YuDefine/nuxt-dashboard-layer`。`impeccable`、`nuxt-ui`、`dataviz` 不知道這份授權，照它們的 SOP 會從零設計。

- **MUST**：新增或重做 admin／後台資源列表與表單、伺服器端分頁資料表格、CSV 匯入匯出、多種資源檢視、組織／成員／角色／權限頁、dashboard 外殼時，在任何 UI skill 出設計、寫元件或 API 之前，先叫用 `dashboardstack` skill 跑完它的 Phase 1–3（判適用、目的 repo 可見度、讀參考實作與對照的 clade rule；目的 repo 不是 PRIVATE／INTERNAL 時 skill 會跳過 Phase 3，只讀 clade rule）。
- 同一個畫面也有圖表、KPI 卡、狀態區塊時，那部分照 [[nuxt-charts-paid-first]] 交 `nuxt-charts` skill。
- **NEVER** 在 PUBLIC repo 寫入參考實作的原始碼或改寫後的程式碼；PUBLIC repo 只照 clade rule 的判準自己寫。
- 專案沒有 `dashboardstack` skill 投影（`.claude/skills/dashboardstack/` 不存在）時，停下回報「缺 dashboardstack 投影」，不要改用其他 skill 繞過。
