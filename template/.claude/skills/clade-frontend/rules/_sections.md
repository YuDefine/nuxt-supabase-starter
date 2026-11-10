<!-- Clade native rule; generated section index of rules/*.md; edit canonical sources -->
行號 1 起算、含端點；Read 用 offset=起、limit=迄-起+1。

agent-devtools.md — Nuxt DevTools v4（devframe）＋ medula 讓 agent 經 MCP 讀寫前端狀態時的授權契約——保留授權（clientAuthTokens、NEVER disableAuthorization）、MCP 一律 bearer、缺 token 即關、token 等級同 secret；升 @nuxt/devtools 或改 vite.devtools 時套用
5-12 前導 — Agent DevTools（Nuxt DevTools v4／devframe＋medula）
14-17 層 1：保留授權
19-22 層 2：MCP 一律 bearer，缺 token 即關
24-27 token 是 secret 等級
29-33 區網（綁非 loopback、沒有 tunnel）
35-43 升級

dashboard-shell.md — Nuxt dashboard 外殼（layout、側欄、全站日期區間 picker、sheet／drawer、全站快捷鍵）的互動判準
5-10 前導 — Dashboard 外殼
12-19 日期區間 picker
21-25 Sheet／drawer 與快捷鍵

dashboardstack-reference-first.md — Nuxt 專案做 admin／CRUD 後台、伺服器端分頁資料表格、CSV 匯入匯出、組織／成員／權限頁時，先載入 dashboardstack skill 讀 fleet 已購的參考實作，再交其他 UI skill
5-16 全文 — DashboardStack 參考實作優先

data-table.md — Nuxt 專案寫伺服器端分頁的資料表格（列表頁的分頁／排序／搜尋／篩選、欄位顯示切換、多選、CSV 匯入、批次刪除）時的狀態與互動判準
5-12 前導 — Data Table（伺服器端資料表格）
14-20 查詢狀態
22-28 篩選草稿與已套用
30-33 欄位顯示切換
35-40 多選
42-46 CSV 匯入
48-52 批次刪除

development.md — 開發規範（測試落點, coding style, UI reuse, server 模組不靠頂層副作用）
5-6 前導
8-15 UI Reuse
17-33 Development
35-76 defineProps 型別約束
78-110 Nuxt UI Color Mode 約束
112-126 Server 模組不靠頂層副作用

display-value-integrity.md — 顯示值完整性——統計 / metric / aggregate 顯示給使用者的數字必須等於它宣稱的東西
5-14 前導 — Display Value Integrity
16-33 一個 metric 一個計算來源（MUST）
35-53 Aggregate MUST 顯式列出排除集（MUST）
55-61 混單位欄位 MUST 有同表 discriminator（MUST）
63-70 可被使用者改變的數字 MUST 回讀權威來源（MUST）
72-86 Label 措辭 MUST 被計算式逐字支持（MUST）
88-92 格式化走單一 formatter（MUST）
94-98 聚合位置：時間分桶在 server（MUST）
100-107 CSV 匯出（MUST）
109-121 稽核
123-132 與其他規約的邊界

drag-interaction.md — 拖曳／resize 類 UI 的 commit 時機——拖曳中只動視覺（CSS transform），放開才打 API，失敗 rollback + toast；NEVER 在 pointermove 期間發請求或寫 store
5-10 前導 — 拖曳互動：視覺先行，drop 才 commit
12-22 Iron Law
26-40 必要的實作細節 › 移動門檻區分 click 與 drag
42-49 必要的實作細節 › 幾何只量一次
51-59 必要的實作細節 › 日期位移用日曆運算，不用 epoch 加減
61-77 必要的實作細節 › Optimistic commit 與 rollback
79-91 必要的實作細節 › 三個結束路徑都要處理
93-99 必要的實作細節 › 觸控留給捲動
101-108 必要的實作細節 › pointer capture vs document listener
110-123 拖曳中的預覽
125-129 相關

i18n-boundary.md — 有 UI 的 consumer 定義或變更 i18n 涵蓋範圍、硬編碼語言 surface、翻譯 lint 與 server error localization 邊界時適用
5-10 前導 — i18n Scope Boundary
12-26 Boundary 是架構決策
28-32 Error Localization Boundary

nuxt-charts-paid-first.md — Nuxt 專案做圖表、dashboard、KPI／統計卡、狀態頁、定價表、帳號頁類 UI 時，先載入 nuxt-charts skill 用 fleet 已購的 Full Access block／template，再交其他 UI skill
5-16 全文 — Nuxt Charts 付費資產優先

nuxt-data-perf.md — Nuxt data fetching 選用決策、Pinia Colada 最佳實踐、dedupe/cache/payload 效能規約；涵蓋 useFetch / useAsyncData / $fetch / useQuery / useMutation 全棧
5-10 前導 — Nuxt Data Fetching & Performance
12-22 Data Fetching 選用決策樹
26-33 Hard Rules › HR-1 禁止 setup top-level 裸 $fetch
35-48 Hard Rules › HR-2 高頻觸發 endpoint MUST 處理重複請求
50-57 Hard Rules › HR-3 reference data MUST 有 cache 策略
59-76 Hard Rules › HR-4 Pinia Colada key MUST 用 factory pattern
78-83 Hard Rules › HR-5 useMutation MUST 接 cache invalidation
85-102 Hard Rules › HR-6 取消訊號 MUST 貫通到 HTTP client
104-114 Hard Rules › HR-7 NEVER 用取消當寫入的重複提交防護
116-134 Hard Rules › HR-8 拿掉 composable 的 `await` MUST 同時保住呼叫端的渲染時序
136-155 Hard Rules › HR-9 CSRF-aware fetch MUST 走 library 官方入口，NEVER 覆寫 `globalThis.$fetch`
159-161 Should Rules（非 hard，但稽核會標） › SR-1 大 payload SHOULD 用 pick/transform
163-196 Should Rules（非 hard，但稽核會標） › SR-2 Lazy prefix 限非首屏重元件，且 MUST 搭 hydration strategy
198-207 Should Rules（非 hard，但稽核會標） › SR-3 landing page / public page SHOULD 有 routeRules
209-211 Should Rules（非 hard，但稽核會標） › SR-4 平行獨立 request SHOULD 用 Promise.all
213-219 Should Rules（非 hard，但稽核會標） › SR-5 NuxtImg SHOULD 設 format + loading + priority + sizes
221-223 Should Rules（非 hard，但稽核會標） › SR-9 取消事件 MUST 與錯誤分流，且 MUST 留下訊號
225-276 Server 端與資源層
278-299 Pinia Colada 層（已安裝 consumer 適用）
301-341 Mechanical Enforcement（4 層）
343-364 Self-check Gate（Enforcement Layer 1）
366-374 與其他 rule 的分工

nuxt-dev-watch.md — Nuxt / Vite config 或 dev server 啟動時的 chokidar watch 排除基線，防止治理目錄造成 fd 壓力與 EBADF
10-21 前導 — Nuxt Dev Watch
23-60 MUST
62-68 NEVER
70-76 為什麼這條 rule 存在
78-91 違反偵測
93-97 與其他 rule 的關係
99-114 違反時的回報方式

nuxt-error-localization.md — UI 錯誤訊息必須本地化（繁體中文），禁止直接顯示原始英文 error code 或 message
5-10 前導 — UI 錯誤訊息本地化
12-19 禁止 pattern
21-26 核心原則
28-30 例外

nuxt-form-validation.md — 多欄位表單必用 UForm + Zod；input/textarea 必設 maxlength；placeholder 不代 label
5-8 前導 — Form 驗證規約
10-14 UForm + Zod（MUST）
16-22 maxlength（MUST）
24-26 UFormField（MUST）
28-34 create／edit 共用一份欄位定義
36-38 placeholder 不代 label
40-42 Auto-generate slug 空值 fallback

nuxt-overlay-slot.md — Overlay 元件（USlideover/UModal/UDrawer）body 必用
5-8 前導 — Overlay 元件 slot 與寬度規約
10-28 #body slot（MUST）
30-67 標題走 props，不進 body（MUST）
69-81 寬度覆寫（MUST 用 `:ui` prop）

nuxt-review-bans.md — patterns.json 機械 ban 清單的實作階段投影 — 寫 .vue / app.config.ts 前必讀；不等 /commit review 才抓
5-14 前導 — Nuxt Review Bans（實作階段強制）
16-18 Ban 清單
20-30 Ban 清單 › 1. UBadge size ban（`ubadge-size-ban`，severity: error）
32-38 Ban 清單 › 1b. 字級下限（`text-size-floor`，severity: error，layer: ratchet）
40-48 Ban 清單 › 1c. 可點擊元件尺寸下限（`interactive-size-floor`，severity: error，layer: ratchet）
50-56 Ban 清單 › 2. Client-side mutation ban（`client-side-mutation`，severity: error）
58-64 Ban 清單 › 3. Dark mode hardcoded color（`dark-mode-hardcoded-color`，severity: warning）
66-72 Ban 清單 › 4. Raw img tag（`raw-img-tag`，severity: warning）
74-80 Ban 清單 › 5. Overlay width on class（`overlay-width-class`，severity: error）
82-88 Ban 清單 › 6. Dark mode dark: prefix（`dark-mode-dark-prefix`，severity: warning）
90-96 Ban 清單 › 7. Calendar popover min-width（`calendar-popover-min-width`，severity: warning）
98-104 Ban 清單 › 8. Semantic color hardcode（`dark-mode-semantic-color`，severity: warning）
106-114 app.config.ts 特別注意
116-123 與其他 rule 的關係

nuxt-security.md — nuxt-security 模組設定 baseline — CSP、headers、CSRF 共用值與 per-consumer 擴充規範；設定對外 origin（auth callback、付款回呼）與寫 route middleware 時的信任邊界
5-10 前導 — Nuxt Security Baseline
12-42 Baseline（必對齊欄位）
44-48 Per-consumer 必填欄位
50-63 Integration Recipes（按 integration 組合 CSP）
65-101 CSRF 例外（`routeRules.csurf`）
103-109 對外 origin
111-114 Route middleware 與 server guard
116-120 Cloudflare Web Analytics beacon
122-128 CF Workers 相容性
130-132 升級與 drift 檢查

nuxt-ui-conventions.md — 實作 Nuxt UI component 前強制 grep 既有同語義用法、複製多數 props 組合；慣例一致性在實作時對齊，不等 review 才抓
5-12 前導 — Nuxt UI 專案慣例一致性（實作階段強制）
14-20 Hard rule
22-25 不一致時
27-31 Dashboard 外殼與主題
33-39 禁止事項
41-44 雙生規約
46-59 靜默失效偵測（mechanical）

nuxt-ui-mcp.md — Nuxt UI v3/v4 component / composable / theming / icon 必走 nuxt-ui-remote MCP；ban prescriptive synthesis
5-14 前導 — Nuxt UI MCP（強制走 nuxt-ui-remote）
16-40 範圍
42-73 Component Candidates（設計階段）
75-120 impeccable 在 Nuxt UI 專案（token 對照、落點、live）
122-144 Hard rule — API surface 層
146-183 Hard rule — prescriptive synthesis 層
185-204 MCP 不通時
206-214 為什麼這條 rule 存在

nuxt-ui-native-picker-ban.md — 禁止原生 / 第三方 date / time / calendar picker，改用 Nuxt UI 元件；實作階段強制（不等 /commit review 才抓）
5-23 前導 — 禁止原生 / 第三方 Date / Time Picker（實作階段強制）
25-31 禁止
33-41 正解
43-51 例外（inline ignore）
53-55 CI gate
57-63 規約來源

page-loading-golden-path.md — Nuxt 導航 loading 回饋 golden path — app.vue 必掛 NuxtLoadingIndicator、主資料用非阻塞 fetch + in-content skeleton、重頁可選全域 overlay + 逾時 toast；禁止頂層 blocking await useFetch 抓主資料
5-12 前導 — Nuxt 導航 Loading Golden Path（實作階段強制）
14-60 三層架構（Tier 1/2 是 MUST，Tier 3 OPTIONAL）
62-64 Reference signal（不 block）
66-75 Tier 2.5 Mechanical Enforcement（4 層，對齊 nuxt-ui-native-picker-ban）

runtime/ux-completeness.md — Runtime adapter fragment for ux-completeness.md
5-10 全文 — Runtime adapter: Claude

ui-copy-tone.md — UI 文案語氣硬規則——軟體開發範疇英文一律不顯露、行業詞依 PRODUCT.md Users 判、縮寫展開、中英混用反例、Register 嚴格度與 Exception；寫 user-facing string 或跑 impeccable clarify 時 path-scoped 載入
5-12 前導 — UI Copy Tone
14-22 Golden Rule
24-40 判定流程
44-55 黑名單：軟體開發範疇英文（一律避免顯露） › HTTP / Network
57-66 黑名單：軟體開發範疇英文（一律避免顯露） › Auth / Session
68-77 黑名單：軟體開發範疇英文（一律避免顯露） › Database / Backend
79-92 黑名單：軟體開發範疇英文（一律避免顯露） › Dev Concepts（API / 資料結構）
94-105 黑名單：軟體開發範疇英文（一律避免顯露） › System Internals
107-122 縮寫展開
124-139 中英混用反例（一律 Block）
141-160 白名單：行業共識專業英文（可保留）
162-170 Register × Tone 嚴格度
172-180 在 impeccable 閉環裡的位置
182-193 Block 條件
195-206 Exception 機制

ux-completeness.md — UX 完整性規則——定義 "feature complete"、強制列舉 user-facing surface、防止 DB+API 完成但 UI 缺失
5-13 前導 — UX Completeness
15-26 Definition of Done
28-30 必填規格區塊
32-48 必填規格區塊 › `## Affected Entity Matrix`
50-73 必填規格區塊 › `## User Journeys`
75-95 必填規格區塊 › `## Implementation Risk Plan`
97-106 必填規格區塊 › Scope-sensitive 要求
108-118 必填 Tasks 區塊
120-131 Route Coverage（write endpoint ↔ UI caller）
133-180 必填 Fixtures / Seed Plan
182-184 必填 Backend-only Manual Review 規約
186-205 必填 Backend-only Manual Review 規約 › `## 人工檢查` 限制（hard rule）
207-219 必填 Backend-only Manual Review 規約 › `## N. Backend Verification Evidence` section（取代）
221-231 必填 Backend-only Manual Review 規約 › 例外宣告
233-253 必填 Backend-only Manual Review 規約 › 反面範例（為什麼這條規則存在）
255-293 Exhaustiveness Rule（結構性強制）
295-301 Navigation Reachability Rule
303-308 Reverse Relationship Rule
310-323 State Coverage Rule
325-335 心智模型清單
337-356 Workflow Integration
358-366 必禁事項
