---
description: Routing Table 的對照資料層——工作類別 × 由誰執行（model・effort）× 為什麼的逐列表，以及 effort 檔位對照表。跨列的硬禁令與判準也在本檔（§ Pi 派工的 workspace capability 與路徑可見性、§ Routing 硬禁令）。**單純「要派工」不會自動載入本檔**：查表決定 model／effort 的那一刻，MUST 依 [[agent-routing]] 檔頭的強制指針主動 Read；改本表任一列或動 pi-routing-*.ts / pi-dispatch.ts 時 path-scoped 載入
paths:
  [
    '.claude/rules/agent-routing.md',
    'rules/core/agent-routing.md',
    'vendor/scripts/pi-routing-policy.ts',
    'vendor/scripts/pi-routing-gate.ts',
    'vendor/scripts/pi-dispatch.ts',
  ]
---
<!-- Clade native rule; source: rules/core/agent-routing.routing-table.md; edit canonical source -->
<!-- clade-targets: claude,codex,cursor -->
<!-- clade-adapters: claude,codex,cursor -->

# Agent Routing — Routing Table（對照資料層）

三端共用本表的工作角色；Cursor 的模型 residency 與載體見 `vendor/cursor-rules/cursor-model-residency.mdc`。Cursor Task 不代替 Pi 或 Claude Code。

> 本檔是 [[agent-routing]] § Routing Table 的下推對照表。**判準留在該節**（合法 model 值、
> `*-cursor` 的路徑可見性、workspace mutation 的 admission、`--route`／`--tier-basis`／
> `--table-row` 的記帳義務、以及每一條硬禁令）；本檔只回答「這類工作查出來是哪個 model、哪個
> effort、為什麼」。取證與跑分在 [[agent-routing.routing-table-rationale]]。
> 機械 SoT 是 `vendor/scripts/pi-routing-policy.ts` 的 `TABLE_ROW_POLICIES`／`ROW_CHAINS`／
> `DELEGATE_SUB_CHAIN`／`NATIVE_TABLE_ROW_POLICIES`／`chainTerminal()`——本表與它 MUST 同一個 commit 一起改。

## 禁用（Charles 2026-09-24；GPT 全面退場 2026-09-29）

**NEVER** 派下列任一 model，任何列、任何 fallback、任何「額度耗盡備援」都一樣：

| 禁用 | 備註 |
| --- | --- |
| **所有 GPT model**（GPT-6 Sol、Astra、Luna、`luna-cursor`、`terra`） | Charles 2026-09-29「全面捨棄 GPT 系列」。Pi 的 `sol` 進 `RETIRED_MODEL_TIERS`；Herdr `--launcher cx` 拒派；`--tier-basis adjudication`（綁 sol）在 Pi 退場，改走 `implementation-decision`；`codex-review-safe.sh` 整支拒跑 |
| Claude Fable 5.1 | **所有用途**，含原 0-A 額度耗盡備援格 |
| Claude Haiku、Sonnet 5 以下 | Sonnet **5.5** 只准坐下表標它的列與 § delegate-sub 的兩個接手點（2026-09-29），其餘 sonnet 等級委派仍走 § delegate-sub 鏈 |
| Cursor Composer 2.5 | 原 `ui-implementation` 列併入 `ui-view-implementation` |
| Devin Fusion | Devin 只剩 SWE-2 Max 一格，且是任意列的**可選**載體（見下） |
| `terra` | 2026-08-11 起禁用，不變 |

**Pi 派工的 model 維合法值**：`gemini`、`grok-xai`、`grok-cursor`（`grok` 是 `grok-cursor` 的向後相容別名）。`pi-dispatch.ts` 對上表任一 tier 在解析 model 之前就 exit 1。

## effort 與執行載體

**effort 跟著 model 走，不跟著列走**（`TIER_EFFORT`／`CLAUDE_MODEL_EFFORT`）：**Grok 4.7 一律 `xhigh`**；**Gemini 3.8 Flash 一律 `high`**（它沒有 xhigh runtime id，未知值過去會靜默退成 medium，現在 `lib/google-gemini-cli.ts` 直接 throw）；Claude Opus 5.5 預設 `medium`（鏈尾載體 `dispatch-fallback` 為 `low`）；**Claude Sonnet 5.5 一律 `high`**。任何一跳的 effort 與此不符，dispatcher exit 1。

**Sonnet 5.5 為什麼是 `high`（Charles 2026-09-29）**：`high` 是它自己的 API 預設（對稱於 Opus 5.5 用它自己的預設 `medium`）。官方「agentic coding 從 `medium` 起跳」的依據是 aggregate eval，本規約禁止拿 aggregate 跑分推導檔位（[[agent-routing.routing-table-rationale]]）；它接手的是原 Sol xhigh 的列，model 與 effort 同時降會疊加；官方也寫明低 effort 較常沒跑檢查就回報完成，正衝突於實作列的交付要求。`xhigh`／`max` 不開。**要降 `medium` 先補量測**：同一份真實 brief 各跑 ≥5 次，比「回報前有沒有跑真的檢查」與 commit 0-A findings 數。

**Sonnet 5.5 的載體**：in-process 用 `sonnet-implementer` subagent（frontmatter 釘 model 與 effort；brief MUST 含 `routing-row: <列名>` 一行，routing gate 依它放行）——`general-purpose` 加 `model: sonnet` 會繼承 session effort，不是合格載體；Herdr 用 `cc`／`ccw` child `--model claude-sonnet-5-5 --effort high`（`sonnet` 別名會被釘到 5.5）。**NEVER** 派 cloud session（cloud 只收 repo 釘 Opus 5.5 的設定）。Sonnet 以安全分類器拒答（`stop_reason: refusal`、Claude Code 的 Usage Policy 拒答訊息、空產出）**不算品質失敗**，直接交主線。

**Opus 卡住升 `high`（Charles 2026-09-28）**：同一問題已在 `medium` 失敗一次、或修法只修到一層，**且**有可跑的檢查（測試、指令、可重現步驟）時，下一次 Claude child 可以開 `high`——`herdr-session-handoff.ts --tier-basis stall-escalation --retry-of <前一次 medium 的 label> --effort high`。缺 `--retry-of`、或 basis 不是 `stall-escalation` 的 `high` 一律拒絕；`max` 任何 basis 都開不了。**NEVER** 用「這題很難」「這是裁決」代替前一次 medium 失敗的事實。

`gemini` 是 Pi model alias，實際 provider 為 `google-gemini-cli`、model 為 `gemini-3.8-flash`；**NEVER** 改傳 Cursor catalog 的完整 `gemini-3.8-flash` slug 冒充同一跳。

**Grok 4.7 xhigh 的池序**：先 `grok-xai`（xAI 配額池），不可用再 `grok-cursor`（Cursor 配額池，釘 `grok-4.7`）。`grok-cursor` 那一跳**只有在本機 pi-cursor-sdk 把 effort 映射到 Cursor 的 `reasoning_effort` 參數時才上鏈**（`lib/cursor-sdk-effort.ts` 的 `cursorSdkMapsReasoningEffort()`）；沒映射時 SDK 會靜默丟掉 xhigh，該跳記進 `skipped_tiers`（`cursor-effort-unsupported`）後往下走。Cursor 池另兩個跳過條件不變：workspace mutation（sandbox 唯讀）與 `notion-ops`（`$HOME` 是空 tmpfs）。

**執行鏈的「→」只在 provider／quota／runtime 不可用時前進**；quality／test failure 不前進。**鏈走完之後由誰接手**看下表的「鏈尾」欄：`dispatch-fallback` subagent（Claude Opus 5.5（effort: low），frontmatter 固定；讓主線不吞原始輸出），或主線（Claude Opus 5.5（effort: medium））自己做。**NEVER** 回報 blocker 當鏈尾，也 **NEVER** 改派禁用 model。

## 判不進任一列時

工作對不上下表任何一列 → **主線（Claude Opus 5.5（effort: medium））自己做**。**NEVER** 因為表上沒有你想派的模型就自己挑一個，也 **NEVER** 填 `--route manual` 去蓋掉一個從沒發生過的判定——`manual` 是政策成功指標的分母，填錯讀起來是假陰性而不是缺資料。

## delegate-sub（原判 sonnet／haiku 等級的委派工作）

依 [[agent-routing]] § Native delegation model boundary：`--model grok-xai --effort xhigh` → `grok-cursor` xhigh → 鏈尾：readonly 交 `dispatch-fallback`（Claude Opus 5.5（effort: low））；**mutation 交 `sonnet-implementer`（Claude Sonnet 5.5（effort: high））**——`dispatch-fallback` 沒有 Edit／Write——它也不可用時主線做。Grok 維持首跳是刻意的：它吃外部額度，把與 Opus 同池的 Claude 額度留給主線與 commit 0-A。`--tier-basis delegate-sub` 的 effort 是結論的另一半，`pi-dispatch.ts` 與 `pi-routing-gate.ts` 對 model 與 effort 兩半都比對、矛盾即 exit 1。配額降級沿鏈往下，那些跳仍宣告 `delegate-sub` 並 **MUST** 帶 `--retry-of`。

品質失敗不前進鏈：delegate 的 Grok 產出品質不合格（exit 2）→ `pi-routing-gate.ts fallback --reason delegate-quality-escalation` 解 latch → 升一次 `sonnet-implementer`（brief 帶 `routing-row: delegate-sub` 與失敗內容）→ 仍不合格主線自己做。

## Devin SWE-2 Max（任意 Pi 列可選）

`swe-2-max`（effort `max`）**不是任何列的固定前綴**。任何 Pi 列，以及 `DEVIN_ELIGIBLE_NATIVE_ROWS` 的六個 native 列（Sonnet 四列、`implementation-decision`、`detailed-planning`），都**可以**選它，但**只限相對不急、即便緩慢也不造成堵塞的任務**。dispatcher 看不到急不急，所以由派工方宣告：Herdr `--launcher devin` **MUST** 帶 `--non-blocking`，缺了 exit 2。可不可選 Devin 是逐列旗標（`devinEligibleRow()`），**不是**從「Claude-only」推導：`ui-view-implementation`、`design-review`、`ui-detailed-planning`、`screenshot-match-analysis`、`dotclaude-authoring`、`code-review-opus` 不接受 Devin。catalog 只認 `devin models list` 的 exact `swe-2-max`，**NEVER** 猜 suffix 或 alias。

**Sonnet 四列不預設 Devin（Charles 2026-09-29 14:1xZ，取代同日 08:15Z「非急件預設 Devin」）**：`non-ui-implementation`／`nuxt-core-implementation`／`commit-0c-fix-verify`／`version-upgrade-first-pass` 一律預設派 Claude Sonnet 5.5（effort: high）——要的是穩定。Devin 只在派工方明確指定（就緒清單 `launcher: devin`）時才用；主持者的自動加派（`vendor/scripts/coordinator-ready.ts` 的 `sonnetRowCarrier`）**NEVER** 自己挑 Devin。`implementation-decision`／`detailed-planning` 的 Devin 同樣只是可選，預設 Opus。

派得出 Devin 的機器是 desk 與 zenbook，兩台都 **MUST** 先 `devin auth status` 判已登入，未登入的那台不派。Devin 省的是額度不是負載：工具指令在派出的那台跑，要卸本機負載就派到負載較低的那台（cloud 固定跑 Opus，Pi 列不改派 cloud）。Devin session 不能 `--continue`，續做一律開新 session 帶 durable brief。載體怎麼跟 cloud、Claude pane 混搭見 [[agent-routing.dispatch-execution]] § Cloud session 載體。

## 工作類別對照

列名是每列開頭 〔`如此標示`〕 的 slug，`--tier-basis table-row` 時逐字填進 `--table-row`。執行鏈的第一跳就是 `--table-row` 要求的 `--model`；後面各跳是配額降級，帶 `--route fallback-chain --retry-of <label>`，由 dispatcher 的 `next_step` 給出。

| 工作類別 | 執行鏈（effort 依上節） | 鏈尾 | 備註 |
| --- | --- | --- | --- |
| 〔`non-ui-implementation`〕非 UI 實作（併入原 `-escalate`） | Claude Sonnet 5.5（effort: high） | 主線 | 修改、測試、修復與交付同一條鏈 |
| 〔`implementation-decision`〕實作中的根因／方案裁決（含 TD／backlog triage） | Claude Opus 5.5（effort: medium） | 主線 | 唯讀分析證據，交付根因、修法限制與驗收條件；TD／backlog 的分類、優先序與處置判定也走本列；in-process 載體 `Plan` subagent 顯式帶 `model: 'opus'`；Devin 可選 |
| 〔`detailed-planning`〕非 UI 詳細實作計畫 | Claude Opus 5.5（effort: medium） | 主線 | 唯讀產出範圍、介面、依賴、task→file 與驗收；載體同上；Devin 可選 |
| 〔`nuxt-core-implementation`〕Nuxt 本體實作 | Claude Sonnet 5.5（effort: high） | 主線 | Nuxt 框架、模組與執行邏輯 |
| 〔`version-upgrade-first-pass`〕version-upgrade 首輪升版 | Claude Sonnet 5.5（effort: high） | 主線 | — |
| 〔`version-upgrade-research`〕version-upgrade 失敗後研究重試 | Gemini 3.8 Flash high → Grok 4.7 xhigh | 主線 | mutation：Cursor 池那跳跳過 |
| 〔`commit-0c-fix-verify`〕commit 0-C fix-verify loop（併入原 `-escalate`） | Claude Sonnet 5.5（effort: high） | 主線 | 同一實作者最多兩輪 check→fix |
| 〔`web-search`〕WebSearch／WebFetch | Gemini 3.8 Flash high → Grok 4.7 xhigh | `dispatch-fallback` | 鏈尾 subagent 帶 WebSearch／WebFetch；主線 **NEVER** 直接呼叫內建工具 |
| 〔`mechanical-fanout`〕Mechanical fan-out／收集、掃描、驗證矩陣 | Gemini 3.8 Flash high → Grok 4.7 xhigh | `dispatch-fallback` | 觸發與 threshold gate 依 [[agent-routing]] |
| 〔`read-heavy-scan`〕封閉來源固定欄位抽取／read-heavy scan | Gemini 3.8 Flash high → Grok 4.7 xhigh | `dispatch-fallback` | 來源矛盾交主線整理為 `implementation-decision`；只收 location ＋可機械複驗欄位，逐字原文不走本列（見硬禁令） |
| 〔`code-locate`〕唯讀定位搜尋（找檔／符號／呼叫點；回 `file:line` ＋結論，不回檔案原文；取代 in-process `Explore`） | Gemini 3.8 Flash high → Grok 4.7 xhigh | 主線 | 鏈尾是主線自己 Read／Grep，**NEVER** `dispatch-fallback`（Charles 2026-09-28：連 Opus 5.5（effort: low）都不用）；readonly |
| 〔`notion-ops`〕Notion 讀寫（自由形式 `ntn api`，NEVER Notion MCP；確定性 script 除外，見硬禁令） | Gemini 3.8 Flash high → Grok 4.7 xhigh（僅 `grok-xai`） | `dispatch-fallback` | Cursor 池 `$HOME` 為空 tmpfs，永不上鏈 |
| 〔`screenshot-review-verify`〕Screenshot review 全部四種模式（`[verify:ui]`、archive 前 QA、commit 0-B、ad-hoc） | Gemini 3.8 Flash high | `dispatch-fallback` | browser、截圖與 evidence 收集；取證與 `screenshot-match-analysis` 判定仍分兩步 |
| 〔`copywriting-draft`〕行銷／產品文案草稿與變體 | Gemini 3.8 Flash high | `dispatch-fallback` | 最終文字由主線重寫 |
| 〔`ui-view-implementation`〕UI view 實作（併入原 `ui-implementation`：Nuxt UI／Content） | Claude Opus 5.5（effort: medium） | 無 fallback | Claude Code 原生／Herdr carrier |
| 〔`design-review`〕Design Review／視覺品質判讀 | Claude Opus 5.5（effort: medium） | 無 fallback | 實際讀圖與設計要求 |
| 〔`ui-detailed-planning`〕UI 詳細實作計畫 | Claude Opus 5.5（effort: medium） | 無 fallback | 保留 UI 範圍、互動、狀態與驗收 |
| 〔`screenshot-match-analysis`〕截圖 vs 驗收項目符合性判定 | Claude Opus 5.5（effort: medium） | 無 fallback | 逐張讀實際圖片與完整 item，回 PASS／FAIL／UNCERTAIN |
| 〔`dotclaude-authoring`〕更新 `.claude/` 的檔案（skills、rules、agents、commands、hooks、settings；含投影到 consumer `.claude/` 的 clade 源檔） | Claude Opus 5.5（effort: medium） | 無 fallback | Claude Code 原生／Herdr carrier（`cc`／`ccw`）；範圍與對 `non-ui-implementation` 的優先序見下方 § `dotclaude-authoring` 的範圍 |
| 〔`code-review-opus`〕Code review／commit 0-A（0-A.1／0-A.2／task reviewer／whole-branch／非 commit review 全部） | Claude Opus 5.5（effort: medium）（Claude Code 主線：in-process `commit-0a-reviewer` subagent；叫不出 Claude subagent 的 runtime：Herdr Claude child） | 無 fallback；**額度耗盡 → gate 保持未完成** | row id 保留 `-opus` 字尾以延續既有 receipt／ledger（原 `code-review`／`code-review-fable` 兩列已刪，歷史 ledger 裡的 `code-review` 是 Astra）。Claude Code 主線跑 `claude-review-safe.sh prepare medium` → AGENT_CALL → FINALIZE；NEVER 走 Pi；NEVER 主線自審補位 |

**原 GPT-6 Sol 的六列**（2026-09-29）改由 native Claude 席位承接，不再經 Pi：實作四列 Sonnet 5.5（effort: high）、判讀兩列 Claude Opus 5.5（effort: medium）——後兩者錯誤會被下游放大、量小（09-24〜09-29 約 8 次），且官方明言最難的推理選 Opus。

**Sonnet 列品質失敗**：① 主線先診斷，**NEVER** 原樣重派；② brief／規格問題 → 修 brief 再派一次 Sonnet；能力問題（跨層、跨模組推理）→ 派 Claude Opus 5.5（effort: medium）child，`--tier-basis quality-escalation --retry-of <Sonnet 那次的 label>`；小修 → 主線自己做；③ Opus 5.5（effort: medium）再失敗 → 既有 `stall-escalation` 升 high。**NEVER** 借 `stall-escalation` 做 Sonnet → Opus 的跨 model 升級（它量的是 Opus 被迫升 high 的次數）。refusal 不走這條，直接交主線。

「無 fallback」的 native 各列在該席位不可用時由主線自己做；commit gate 例外——`code-review-opus`（0-A）與 commit 0-B 用到的 `design-review`／`screenshot-match-analysis`：產出 changeset 的那條線不是它的 reviewer，所以 gate 保持未完成（`commit` skill `review-policy.md`）。

唯讀定位搜尋走 `code-locate` 列，**不再**有「不在表上的 Claude 載體」：`Explore` subagent 在任何 model、任何 permission mode（含 plan mode）都被 `pi-routing-gate.ts` 攔下，gate 把 `prompt` 落成 brief 並印出可逐字照跑的 `pi-dispatch --table-row code-locate` 指令。掃描矩陣與固定欄位抽取照舊走 `mechanical-fanout`／`read-heavy-scan` 列，見 [[agent-routing.dispatch-execution]] 第 4 條。

### `dotclaude-authoring` 的範圍（Charles 2026-09-26）

`.claude/` 是 Claude Code 自己讀的 prompt／規約面，由 Claude 撰寫才與讀者對齊。判定只看**這次派工要寫入的路徑**，不看任務標題：

| 可觀察 predicate | 列 |
| --- | --- |
| 寫入路徑含 `.claude/` 目錄段（任何 repo、任何深度：`.claude/skills/**`、`.claude/rules/**`、`.claude/agents/**`、`.claude/commands/**`、`.claude/hooks/**`、`.claude/settings*.json`） | 本列 |
| clade 源檔，投影後落在 consumer `.claude/`：`rules/core/**`、`rules/modules/**`、`capabilities/**/{skills,agents,commands,hooks,references}/**` | 本列（改源頭與改投影是同一份讀者） |
| `claude-md/**`（落在 consumer `CLAUDE.md`，不在 `.claude/`）、`vendor/scripts/**`、`scripts/**`、`capabilities/**/scripts/**`（不在上一條那五個段之下的 `scripts/`，見下方重疊判定）與其他程式碼 | **不是**本列，照原表查（通常 `non-ui-implementation`） |

**`capabilities/**` 兩條同時命中時**（例如 `capabilities/core/skills/<name>/scripts/*.ts`）：看寫入路徑裡**最靠近 `capabilities/` 的**那個 `skills`／`agents`／`commands`／`hooks`／`references`／`scripts` 目錄段——前五者之一 → 本列（skill 底下的 `scripts/` 投影後落在 consumer `.claude/skills/<name>/scripts/`，第一條也命中）；是 `scripts` → 不是本列（例如 `capabilities/core/scripts/**`）。只看路徑字串，**NEVER** 依檔案副檔名或任務標題改判。

**與 `non-ui-implementation` 的優先序**：同一件同時寫 `.claude/`（含上表源檔）與其他程式碼時——

1. 兩側拆得開（各自能獨立通過驗收）→ **拆成兩次派工**，各自依寫入路徑查表。
2. 拆不開（同一個行為契約的兩端，例如改 hook 腳本連帶改 `settings.json` 註冊與它的測試）→ **本列優先**，整件由 Claude Opus 5.5（effort: medium）做。理由：Opus 寫程式碼沒有檔位缺口，而 `.claude/` 規約面影響整個 fleet，本列要的是 Opus 的判讀（原本要擋的是 GPT 寫給 Claude 讀的規約）。

consumer 端的 `.claude/rules/local/**` 同樣命中第一條；本列只決定載體，**不**改變「clade 源檔先改 clade 再散播」的路由（`clade-source-routing`）。

已退場的列 id（`non-ui-implementation-escalate`、`commit-0c-fix-verify-escalate`、`ui-implementation`、`code-review`、`code-review-fable`）只留在歷史 ledger；新派工帶它們 dispatcher exit 1 並指出吸收它的列（`RETIRED_TABLE_ROWS`）。

## Pi 派工的 workspace capability 與路徑可見性

> **`*-cursor` NEVER 接要讀 cwd 以外路徑的任務**（cursor 池的 `$HOME` / `/tmp` 是空 tmpfs，拿到的是**與真結果同形**的全 missing 表）。鏈走到那一格時，brief 指涉 cwd 以外路徑就**跳過該格**往下走——判的是**這份 brief**，不是列名。`pi-dispatch.ts` 會掃 brief 拒跑（exit 1），但它只看得到 brief 寫出來的路徑，**NEVER** 拿它當自己不必判的理由。**NEVER** 用 `PI_CURSOR_SANDBOX_BIND` 繞過。
>
> **Workspace capability 與路徑可見性是兩個獨立 predicate。** **每一個**會修改 working tree、lockfile、Git index 或建立 commit 的 Pi caller／brief 都屬 `mutation`：concrete table row 由 `pi-routing-policy.ts` 分類，manual caller **MUST** 帶 `--workspace-access mutation`；quota retry **MUST** 沿用 dispatcher 的 `next_step`／`--retry-of`，由 ledger 繼承同一 capability。只讀 inspection／review 才是 `readonly`。
>
> **違反字面就是違反精神：任何 workspace mutation dispatch，NEVER 選 `grok-cursor`**，包含每一個 fallback candidate。`pi-dispatch.ts` 在 Cursor admission fail closed。**NEVER** 為了 mutation 放寬這道 security boundary——Red Flags 與實證邊界在 [[agent-routing.routing-table-rationale]] § Cursor sandbox 與 mutation。

### Routing 硬禁令（逐列）

查到某一列時 MUST 回頭讀本節對應列，**NEVER** 只讀對照表就派。

| 列 | 硬禁令 |
| --- | --- |
| 任一列 | **NEVER** 派 § 禁用 表內的 model；**NEVER** 用非 `TIER_EFFORT` 的 effort。 |
| 〔`web-search`〕 | 查不到就回「查不到」，**NEVER** 拿二手彙整頁充數。主線 **NEVER** 直接呼叫內建 WebSearch／WebFetch——鏈尾是 `dispatch-fallback` subagent。 |
| 〔`screenshot-review-verify`〕 | 由主線直接呼叫 Pi dispatcher，**NEVER** 以 subagent 中介轉派首跳。收集與判定 **NEVER** 併成同一次 dispatch。 |
| 〔`screenshot-match-analysis`〕 | 逐張讀實際截圖與 item 要求；**NEVER** 把取證 dispatch 的自述當判定。 |
| 〔`mechanical-fanout`〕 | **NEVER** 以「我自己順手跑掉比較快」略過本列（成因見 rationale）。 |
| 〔`copywriting-draft`〕 | **主線 MUST 收斂重寫每一條採用的文案，NEVER 原樣貼進交付物**——Pi 回的是素材不是成稿。本列只涵蓋行銷／產品對外文案，**NEVER** 外推到規約措辭／commit message／技術文件／PR 描述／對外報告。 |
| 〔`notion-ops`〕 | **NEVER** 上 Cursor 池（Notion auth 在 `$HOME`）。**NEVER** 主線第一手自己跑 ntn。**本列不涵蓋確定性 script**：`vendor/scripts/notion-sync.ts`、`vendor/scripts/lib/notion-hub.ts resolve`、`scripts/audit-notion-hub-schema.ts` 主線直接跑。Notion MCP 不是本列的合法 transport，**NEVER** 使用。 |
| 〔`read-heavy-scan`〕 | **NEVER** 拿「反正我讀一下就知道了」略過 gate，也 NEVER 把固定輸出 schema 當成不需裁決的證據。**NEVER 在本列的 brief 要求 verbatim `raw`／逐字引用**：本列每筆只收 location（`file` ＋ `line` 或 JSON pointer）＋可機械複驗欄位（該行命中的字面 token、計數）；要逐字原文的抽取不派本列，由主線拿 location 以確定性指令（`sed -n '<line>p' <file>`、`grep -nF '<token>' <files>`）自己取回。回傳裡只要出現 `raw`／引用字串，**每一筆** MUST 以 `grep -F` 對它所標的檔複驗，任一筆不中就**整份作廢**重取，**NEVER** 挑命中的那幾筆用（`pi-dispatch.ts` 對本列 JSON 回傳機械複驗的範圍：`raw`／`raw_value` 兩種 key，對 `file`／`path`／`source` 或 `location` 的 `path:line` 解出的檔，空字串也算不中，不中即 exit 2 帶 `verbatim_raw_mismatch`；其他 key 名的引用字串、非 JSON 回傳與鏈尾 `dispatch-fallback` 的輸出不在範圍內，由消費端自己驗）——捏造物與真結果同形（exit 0、schema 對、行數對），不複驗就沒有偵測面（TD-953：同一份 brief 5 reps 中 1 rep 有 43/172 筆 heading 為檔內不存在的捏造）。 |
| 〔`code-locate`〕 | 回傳只收 `file:line` ＋結論，**NEVER** 在 brief 要求檔案原文或逐字引用。每一筆 `file:line` MUST 可機械複驗（`sed -n '<line>p' <file>` 命中回報的符號／token），**任一筆不中就整份作廢**重取，**NEVER** 挑命中的那幾筆用——精神同 `read-heavy-scan`。鏈走完由主線自己 Read／Grep，**NEVER** 派 `dispatch-fallback` 或 `Explore`。 |
| 〔`non-ui-implementation`〕〔`nuxt-core-implementation`〕〔`version-upgrade-first-pass`〕〔`commit-0c-fix-verify`〕 | **NEVER** 經 Pi、**NEVER** cloud；effort 恆 `high`（Herdr table-row 准入逐字比對）；in-process 只准 `sonnet-implementer`，brief MUST 有 `routing-row:` 行；品質失敗照上方 § Sonnet 列品質失敗，refusal 直接交主線。 |
| 〔`implementation-decision`〕〔`detailed-planning`〕 | **NEVER** 經 Pi（`--tier-basis adjudication` 已退場）；**NEVER** 改派 Sonnet 以「省額度」——判讀錯誤會被下游放大。 |
| 〔`dotclaude-authoring`〕 | **NEVER** 經 Pi 派工（`pi-dispatch.ts` 以 Claude-only 拒跑）；**NEVER** 以「只是改一行 settings／改幾個字」把 `.claude/` 寫入塞進 `non-ui-implementation` 的派工——拆不開就整件走本列。 |
| 〔`code-review-opus`〕 | **NEVER** 經 Pi 派工；effort 恆 `medium`；Opus 額度耗盡 → gate 保持未完成，**NEVER** 改派其他模型、**NEVER** 主線自審補位；receipt MUST 記 requested／observed model 與 `model_verification`，`requested_model` 不是 Opus 5.5 的 verdict 不得當 gate 證據。 |

> **每一次** pi dispatch **MUST 帶 `--route` 與 `--tier-basis`**（缺就 exit 1）：前者記走哪條政策（本表某列 → `routing-table`；§ delegate-sub → `claude-delegate-sub`；配額降級 → `fallback-chain`；皆非才**顯式** `manual`），後者記該政策對 model 的**結論**；dispatcher 交叉檢查兩者與 `--model`、`--effort`，矛盾即 exit 1。**NEVER** 不確定就填 `manual` ／ `table-row`——與「判定沒發生」不可區分。重試帶 `--retry-of <label>`，**NEVER** 用 `<label>2`。
>
> **`--tier-basis table-row` 時 MUST 再帶 `--table-row <列名>`**（缺就 exit 1）。**NEVER** 在派工當下偏離列上的 model —— 認為某列該換檔位就先改本表（與 `pi-routing-policy.ts`）再派。
>
> **Routing Table 類別的檔位選擇中，NEVER** 拿「輸出會被下游機械消費」當降檔理由：下游若只驗 JSON schema 而不驗語意，降檔引入的錯誤會被自動放大。
>
> **跑分、配額權重、擴權取證這三類「拿數字當理由」的陷阱，全文在 [[agent-routing.routing-table-rationale]]**。要拿任何數字支持一次降檔 / 轉列之前 MUST 先讀它，**NEVER** 憑印象引用比例。
