---
name: "clade-frontend"
description: "Frontend, interaction, accessibility, localization, and UX integrity rules. Use when changing UI, forms, display values, interactions, translations, or visual completeness."
---

# SOP

## Phase 1 -- 用任務挑出要讀的 rule

1. READ 逐條對照接下來要做的事：條件成立才把該 rule 列入候選，NEVER 整批讀。
   - `rules/agent-devtools.md`：Nuxt DevTools v4（devframe）＋ medula 讓 agent 經 MCP 讀寫前端狀態時的授權契約——保留授權（clientAuthTokens、NEVER disableAuthorization）、MCP 一律 bearer、缺 token 即關、token 等級同 secret；升 @nuxt/devtools 或改 vite.devtools 時套用；且碰 `nuxt.config.*`、`pnpm-workspace.yaml`
   - `rules/dashboard-shell.md`：Nuxt dashboard 外殼（layout、側欄、全站日期區間 picker、sheet／drawer、全站快捷鍵）的互動判準；且碰 `app/layouts/**`、`packages/*/app/layouts/**`、`layers/*/app/layouts/**` 等 15 處
   - `rules/dashboardstack-reference-first.md`：Nuxt 專案做 admin／CRUD 後台、伺服器端分頁資料表格、CSV 匯入匯出、組織／成員／權限頁時，先載入 dashboardstack skill 讀 fleet 已購的參考實作，再交其他 UI skill；且碰 `app/**/*.vue`、`packages/*/app/**/*.vue`、`layers/*/app/**/*.vue` 等 9 處
   - `rules/data-table.md`：Nuxt 專案寫伺服器端分頁的資料表格（列表頁的分頁／排序／搜尋／篩選、欄位顯示切換、多選、CSV 匯入、批次刪除）時的狀態與互動判準；且碰 `app/**/*.vue`、`packages/*/app/**/*.vue`、`layers/*/app/**/*.vue` 等 10 處
   - `rules/development.md`：開發規範（測試落點, coding style, UI reuse, server 模組不靠頂層副作用）；且碰 `app/**/*.{vue,ts}`、`packages/*/app/**/*.{vue,ts}`、`server/**/*.ts` 等 9 處
   - `rules/display-value-integrity.md`：顯示值完整性——統計 / metric / aggregate 顯示給使用者的數字必須等於它宣稱的東西；且碰 `server/**/*.ts`、`packages/*/server/**/*.ts`、`app/composables/**/*.ts` 等 8 處
   - `rules/drag-interaction.md`：拖曳／resize 類 UI 的 commit 時機——拖曳中只動視覺（CSS transform），放開才打 API，失敗 rollback + toast；NEVER 在 pointermove 期間發請求或寫 store；且碰 `**/composables/**rag*.ts`、`**/composables/**ove*.ts`、`**/composables/**esize*.ts` 等 7 處
   - `rules/i18n-boundary.md`：有 UI 的 consumer 定義或變更 i18n 涵蓋範圍、硬編碼語言 surface、翻譯 lint 與 server error localization 邊界時適用；且碰 `DESIGN.md`、`docs/decisions/**`、`app/**/*.{vue,ts,tsx,jsx}` 等 14 處
   - `rules/nuxt-charts-paid-first.md`：Nuxt 專案做圖表、dashboard、KPI／統計卡、狀態頁、定價表、帳號頁類 UI 時，先載入 nuxt-charts skill 用 fleet 已購的 Full Access block／template，再交其他 UI skill；且碰 `app/**/*.vue`、`packages/*/app/**/*.vue`、`pages/**/*.vue` 等 9 處
   - `rules/nuxt-data-perf.md`：Nuxt data fetching 選用決策、Pinia Colada 最佳實踐、dedupe/cache/payload 效能規約；涵蓋 useFetch / useAsyncData / $fetch / useQuery / useMutation 全棧；且碰 `**/*.vue`、`app/**/*.ts`、`packages/*/app/**/*.ts` 等 13 處
   - `rules/nuxt-dev-watch.md`：Nuxt / Vite config 或 dev server 啟動時的 chokidar watch 排除基線，防止治理目錄造成 fd 壓力與 EBADF；且碰 `nuxt.config.*`、`vite.config.*`、`package.json` 等 5 處
   - `rules/nuxt-error-localization.md`：UI 錯誤訊息必須本地化（繁體中文），禁止直接顯示原始英文 error code 或 message；且碰 `app/**/*.vue`、`packages/*/app/**/*.vue`、`components/**/*.vue` 等 6 處
   - `rules/nuxt-form-validation.md`：多欄位表單必用 UForm + Zod；input/textarea 必設 maxlength；placeholder 不代 label；且碰 `app/**/*.vue`、`packages/*/app/**/*.vue`、`components/**/*.vue` 等 6 處
   - `rules/nuxt-overlay-slot.md`：Overlay 元件（USlideover/UModal/UDrawer）body 必用；且碰 `app/**/*.vue`、`packages/*/app/**/*.vue`、`components/**/*.vue` 等 8 處
   - `rules/nuxt-review-bans.md`：patterns.json 機械 ban 清單的實作階段投影 — 寫 .vue / app.config.ts 前必讀；不等 /commit review 才抓；且碰 `app/**/*.vue`、`packages/*/app/**/*.vue`、`pages/**/*.vue` 等 12 處
   - `rules/nuxt-security.md`：nuxt-security 模組設定 baseline — CSP、headers、CSRF 共用值與 per-consumer 擴充規範；設定對外 origin（auth callback、付款回呼）與寫 route middleware 時的信任邊界；且碰 `nuxt.config.ts`、`app/middleware/**/*.ts`、`packages/*/app/middleware/**/*.ts`
   - `rules/nuxt-ui-conventions.md`：實作 Nuxt UI component 前強制 grep 既有同語義用法、複製多數 props 組合；慣例一致性在實作時對齊，不等 review 才抓；且碰 `app/**/*.vue`、`packages/*/app/**/*.vue`、`pages/**/*.vue` 等 11 處
   - `rules/nuxt-ui-mcp.md`：Nuxt UI v3/v4 component / composable / theming / icon 必走 nuxt-ui-remote MCP；ban prescriptive synthesis；且碰 `app/**/*.{vue,ts}`、`packages/*/app/**/*.{vue,ts}`、`pages/**/*.vue` 等 15 處
   - `rules/nuxt-ui-native-picker-ban.md`：禁止原生 / 第三方 date / time / calendar picker，改用 Nuxt UI 元件；實作階段強制（不等 /commit review 才抓）；且碰 `app/**/*.{vue,ts}`、`packages/*/app/**/*.{vue,ts}`、`pages/**/*.vue` 等 8 處
   - `rules/page-loading-golden-path.md`：Nuxt 導航 loading 回饋 golden path — app.vue 必掛 NuxtLoadingIndicator、主資料用非阻塞 fetch + in-content skeleton、重頁可選全域 overlay + 逾時 toast；禁止頂層 blocking await useFetch 抓主資料；且碰 `app/app.vue`、`packages/*/app/app.vue`、`app/pages/**/*.vue` 等 12 處
   - `rules/runtime/ux-completeness.md`：Runtime adapter fragment for ux-completeness.md；且碰 `tasks/**`、`specs/plans/**`、`app/**/*.vue` 等 7 處
   - `rules/ui-copy-tone.md`：UI 文案語氣硬規則——軟體開發範疇英文一律不顯露、行業詞依 PRODUCT.md Users 判、縮寫展開、中英混用反例、Register 嚴格度與 Exception；寫 user-facing string 或跑 impeccable clarify 時 path-scoped 載入；且碰 `app/**/*.vue`、`packages/*/app/**/*.vue`、`app/**/*.ts` 等 15 處
   - `rules/ux-completeness.md`：UX 完整性規則——定義 "feature complete"、強制列舉 user-facing surface、防止 DB+API 完成但 UI 缺失；且碰 `tasks/**`、`specs/plans/**`、`app/**/*.vue` 等 7 處

## Phase 2 -- 只讀候選 rule 中與任務相關的段落

1. READ `rules/_sections.md` 中候選 rule 的區塊（首行 `<file> — `、空行結束；用 Grep 加 `-A 40` 取（區塊最長約 38 行，讀到空行為止，其後是下一份 rule 的區塊），NEVER 整份讀索引），只挑與任務相關的段落，用 Read 的 offset／limit 讀該行號區間。
2. READ 標題看不出相關與否的 rule 才整份讀；NEVER 用條件清單或段落索引代替 rule 內文。
