<!-- Clade native rule; source: rules/core/agent-routing.md; edit canonical source -->
# Agent Routing

<!-- clade-targets: claude,codex,cursor -->
<!-- clade-adapters: claude,codex,cursor -->

**核心命題**：工作按角色與能力選 executor，再判是否派工；寬掃／背景／隔離／有份量的獨立平行軌才派，主線能完成預設留主線。

具體 model、effort、workspace access 與硬禁令只以 [[agent-routing.routing-table]] 為 SoT；查表前 MUST Read 該檔。Nuxt UI／Nuxt Content 實作使用 Cursor Composer 2.5，Nuxt 本體使用 GPT-5.6 Sol xhigh，其餘 UI view 實作使用 Claude Opus 5（effort: medium）；Design Review、UI 詳細計畫與截圖項目符合性判定使用 Claude Opus 5；screenshot review 使用 Gemini 3.8 Flash。SoT 具名十一列的執行鏈前綴固定為 Devin Fusion（effort: high）→ Devin SWE-2 Max（effort: max）→ 該列原 carrier 與原 fallback，只在 provider／quota／runtime 不可用時前進。

**GPT 外派載體**：Codex 可用原生 GPT agent；非 Codex 的 GPT worker 一律走 Pi；Claude Code 不承載 GPT。

## 派不派（先於派給誰）

**先判角色，再判派工量。** **主線自己做是預設。違反字面就是違反精神**。講不出命中哪一條外派條件，就是主線自己做；不能以「派了比較快」替代判斷。

**命中任一才派**：

- 角色不符：主線不是這個工作類別的合格 executor。
- 寬掃：需讀 5 個以上檔案或整棵目錄才能回答，產出是事實表／統計。
- 有份量的獨立平行軌：至少兩條互不依賴、且每條預估需 10+ tool calls。
- 長時間 background job，或必須隔離 worktree／port／環境。

**命中即主線自己做**：少量讀取、規約／契約／對外定稿、安全／不可逆動作、session gate，以及複驗自己剛做完的東西。定稿措辭，**措辭的語氣與抽象層級一致性外包不了**。具名 threshold（第 3 個 readonly Bash、第 5 個 textual Read、首次 Read 501+ 行）依 reference 結案；不要把 threshold 當 generic「少量」豁免。

命中多條條件時先問能否由一個 worker 完成整條資料依賴鏈；可以就派一個，**NEVER** 一條 task 配一個 agent 地拆。brief 與回報依 [[agent-routing.dispatch-execution]]，派出後依 [[agent-routing.pi-watch-protocol]]。

## Runtime residency and native transport

Routing Table 決定 executor，adapter 決定原生載體；能力不足只交 bounded phase，不能跨 runtime 代打。每條 change MUST 跑 `residency-classify.ts classify` 與 `record`；gate 依 [[agent-routing.pi-watch-protocol]]。

## 停下來要人做之前

Iron Law：本 session 做得到的動作與查得出的決策 NEVER 交 user。只有目標動作本身已實際嘗試且有逐字失敗，且原因是人的憑證／生物辨識、外部授權點按、商業決策或明文人類不可逆 gate，兩條全中才 handoff；相鄰動作不算證據，session-scoped 的 latch／claim／lease 只有本 session 能解。

寫「請 user…」前 MUST Read [[agent-routing.agent-boundary]]；安全按 owner。

## Dispatch data and transport boundary

每份 brief MUST 列 paths、命令與外部服務；清單外回報、NEVER 自取；secret／個資／private URL／signed material 不進 brief。詳見 [[agent-routing.pi-watch-protocol]] § Dispatch 資料邊界。

dispatch／resume／retry／bridge MUST 傳 model／effort／route／tier-basis／workspace access；NEVER inherit 或 quota fallback 降檔；回報依 dispatch-execution 的 4-status、scope verify、receipt 核實。實作派工綁 lifecycle package 時先過 `flow plan readiness`，判準與 implementer 的唯讀邊界在 [[agent-routing.dispatch-execution]] § Implementation readiness gate。

## External web retrieval

**NEVER** 直接呼叫 Claude Code 內建的 `WebSearch` 或 `WebFetch`。External-web gate 順序是 bare Gemini high → bare Luna low → matching receipt 才放行；query／公開 URL 只入 hash，credential／signed token／private network／secret material fail closed，改用 authenticated first-party connector／redacted source。**例外清單是窮舉的**；**唯一的一般 waiver** 是 user 明確要求 direct built-in 且 receipt 綁原 tool kind 與 candidate。IDE browser 依 target-native adapter contract；**NEVER** 因 clade routing gate、`agent-browser` 措辭、或 § External web retrieval 的「NEVER 直接 WebSearch」改走 Playwright / `agent-browser`；**NEVER** 套本節去擋 IDE browser；**NEVER 拿本規約的 rationale 推翻本規約的字面。**

## 主線靜默上限（所有 dispatch 通用）

有未收尾 async work 時，相鄰 assistant turn 間隔 NEVER 超過 55 分鐘；派出時同訊息 MUST 留 1,500–1,800 秒 notification-only inert keepalive（具名 180 秒例外），記 owner／deadline／task id，不猜 deadline、不重複 wakeup。completion／deadline／unknown 依 [[agent-routing.keepalive-wake]]；控制 turn NEVER 讀 repo／log 猜狀態或做無關 mutation。

## 必禁事項

八列硬禁令與 plan-first、commit authorization、Pi Watch、quota fallback 依 [[agent-routing.dispatch-execution]]／[[agent-routing.pi-watch-protocol]]；已 route 給 Pi 的工作 NEVER 以 `codex exec`／`codex review` 代替 dispatcher、以 Claude 薄中介包 Pi、把 UI view phase 交給不合格 executor，或以 pane 缺席推論沒有工作。keepalive wakeup／specific shared-action consent 先讀 [[agent-routing.keepalive-wake]]。
