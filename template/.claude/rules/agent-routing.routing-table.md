---
description: Routing Table 的對照資料層——工作類別 × 由誰執行（model・effort）× 為什麼的逐列表，以及 effort 檔位對照表。跨列的硬禁令與判準留在 [[agent-routing]] § Routing Table，本檔只承載查表用的列。**單純「要派工」不會自動載入本檔**：查表決定 model／effort 的那一刻，MUST 依 [[agent-routing]] § Routing Table 的強制指針主動 Read；改本表任一列或動 pi-routing-*.ts / pi-dispatch.ts 時 path-scoped 載入
paths:
  [
    '.claude/rules/agent-routing.md',
    'rules/core/agent-routing.md',
    'vendor/scripts/pi-routing-policy.ts',
    'vendor/scripts/pi-routing-gate.ts',
    'vendor/scripts/pi-dispatch.ts',
  ]
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/agent-routing.routing-table.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

<!-- clade-targets: claude,codex,cursor -->
<!-- clade-adapters: claude,codex,cursor -->

# Agent Routing — Routing Table（對照資料層）

三端共用本表的工作角色；Cursor 的模型 residency 與載體見 `vendor/cursor-rules/cursor-model-residency.mdc`。Cursor Task 不代替 Pi 或 Claude Code。

**Pi 派工的 model 維合法值**：`astra`、`sol`、`gemini`、`luna`、`luna-cursor`、`grok-xai`、`grok-cursor`（`grok` 是 `grok-cursor` 的向後相容別名）。同一 tier 的 `-cursor` 變體是**換配額池、不換檔位**，只在配額降級鏈上出現。External-web 第一手的 bare `gemini` 解析到 Gemini CLI provider；**NEVER** 改傳 Cursor catalog 的完整 `gemini-3.8-flash` slug 冒充同一跳。

> 本檔是 [[agent-routing]] § Routing Table 的下推對照表。**判準留在該節**（合法 model 值、
> `*-cursor` 的路徑可見性、workspace mutation 的 admission、`--route`／`--tier-basis`／
> `--table-row` 的記帳義務、以及每一條硬禁令）；本檔只回答「這類工作查出來是哪個 model、哪個
> effort、為什麼」。取證與跑分在 [[agent-routing.routing-table-rationale]]。

## effort 與執行載體

每一個 Gemini 3.8 Flash 工作都使用 `high`，包含首派與 fallback。`gemini` 是 Pi model alias，實際 provider 為 `google-gemini-cli`、model 為 `gemini-3.8-flash`。Grok 4.6 的 `grok-xai` 與 `grok-cursor` 分別表示 xAI 與 Cursor 配額池。

GPT worker 的 transport 依 [[agent-routing]] § Session transport boundary：Codex 主線 → 任一 GPT 可用原生 agent；每個非 Codex 主線的 GPT 外派一律走 Pi。**Astra 用途白名單**：`planning`、`decision`、`review`。GPT-6 Astra 只承接這三類唯讀工作，不承接實作與修復。

每一個 xAI Grok 4.6 工作的 fallback 都先接 Cursor Grok 4.6，保留該 Grok 工作的 effort，再走該列後續 fallback。每一跳都核對實際 runtime、workspace access 與工具能力。Cursor Pi pool 不支援 mutation；遇到修改任務時不啟動 Cursor，在 authoritative payload／ledger 的 `skipped_tiers` 記明 capability 原因後才交下一個可執行模型，保留同一 work 身分。

每一次 Design Review、UI 詳細計畫、截圖符合性判定先用 Claude Opus 5（effort: medium）；有實際 quota、runtime、工具或任務失敗證據時，交 GPT-5.6 Sol（effort: high）。Fallback 保留圖片、fresh context 與原驗收契約，失敗回報 blocker。

## 工作類別對照

列名是每列開頭 〔`如此標示`〕 的 slug，`--tier-basis table-row` 時逐字填進 `--table-row`。Fallback 是原工作列的執行鏈，不另建立工作類型。

| 工作類別 | 主模型／執行方式 | Effort | Fallback／契約 |
| --- | --- | --- | --- |
| 〔`non-ui-implementation`〕一般非 UI 實作 | GPT-5.6 Luna | medium | 修改、測試、修復與交付同一條鏈；機械具名列沿用該列 |
| 〔`non-ui-implementation-escalate`〕複雜非 UI 實作／修復升級 | GPT-5.6 Sol | high | 根因／方案需要裁決時交 GPT-6 Astra，修改仍交實作者 |
| 〔`implementation-decision`〕實作中的根因／方案裁決 | GPT-6 Astra | medium | 唯讀分析證據，交付根因、修法限制與驗收條件 |
| 〔`detailed-planning`〕非 UI 詳細實作計畫 | GPT-6 Astra | medium | 唯讀產出範圍、介面、依賴、task→file 與驗收 |
| 〔`dep-upgrade-first-pass`〕dep-upgrade 首輪升版 | xAI Grok 4.6 | low | Cursor Grok 4.6 low → Gemini 3.8 Flash high → blocker |
| 〔`dep-upgrade-research`〕dep-upgrade 失敗後研究重試 | xAI Grok 4.6 | high | Cursor Grok 4.6 high → Gemini 3.8 Flash high → blocker |
| 〔`web-search`〕WebSearch／WebFetch | Gemini 3.8 Flash | high | GPT-5.6 Luna low → 有對應失敗 receipt 才放行同種內建工具 |
| 〔`code-review`〕Code review／commit 0-A | GPT-6 Astra；合格獨立跨模型 reviewer | medium | Claude Fable 5.1（effort: medium）；須符合 `review-policy.md` 的模型差異與資格。Critical／Major 觸發深度 review 與跨模型裁決 |
| 〔`ui-implementation`〕Nuxt UI 元件組裝／Nuxt Content 實作 | Cursor 原生 Composer 2.5 | 依原生能力 | 範圍限 Nuxt UI／Content；當次 catalog 必須提供 Composer 2.5，不可用時回報 blocker |
| 〔`nuxt-core-implementation`〕Nuxt 本體實作 | GPT-5.6 Sol | xhigh | Nuxt 框架、模組與執行邏輯；GPT 依原生／Pi transport，不使用 Cursor Task |
| 〔`ui-view-implementation`〕其餘 UI view 實作 | Claude Opus 5 | medium | 排除 Nuxt UI／Content 與 Nuxt 本體；Claude Code 原生／Herdr carrier，不可用時回報 blocker |
| 〔`design-review`〕Design Review／視覺品質判讀 | Claude Opus 5 | medium | GPT-5.6 Sol high；實際讀圖與設計要求 |
| 〔`ui-detailed-planning`〕UI 詳細實作計畫 | Claude Opus 5 | medium | GPT-5.6 Sol high；保留 UI 範圍、互動、狀態與驗收 |
| 〔`screenshot-review-verify`〕Screenshot review 全部四種模式（`[verify:ui]`、archive 前 QA、commit 0-B、ad-hoc） | Gemini 3.8 Flash | high | browser、截圖與 evidence 收集；不代簽符合性 gate，不換其他模型 |
| 〔`screenshot-match-analysis`〕截圖 vs 驗收項目符合性判定 | Claude Opus 5 | medium | GPT-5.6 Sol high；逐張讀實際圖片與完整 item，回 PASS／FAIL／UNCERTAIN |
| 〔`mechanical-fanout`〕Mechanical fan-out／收集、掃描、驗證矩陣 | Gemini 3.8 Flash | high | GPT-5.6 Luna low；觸發與 threshold gate 依 [[agent-routing]] |
| 〔`copywriting-draft`〕行銷／產品文案草稿與變體 | Gemini 3.8 Flash | high | 失敗直接回主線；最終文字由主線重寫 |
| 〔`notion-ops`〕Notion 讀寫 | Gemini 3.8 Flash | high | GPT-5.6 Luna high；仍無法完成時回報 blocker |
| 〔`read-heavy-scan`〕封閉來源固定欄位抽取／read-heavy scan | Gemini 3.8 Flash | high | GPT-5.6 Luna low；來源矛盾交主線整理為 `implementation-decision` |
| 〔`commit-0c-fix-verify`〕commit 0-C fix-verify loop | xAI Grok 4.6 | high | Cursor Grok 4.6 high → GPT-5.6 Sol high；同一實作者最多兩輪 check→fix |
| 〔`commit-0c-fix-verify-escalate`〕commit 0-C 修復升級 | GPT-5.6 Sol | high | 承接 Grok 4.6 未收斂的修復，主線重跑檢查 |
