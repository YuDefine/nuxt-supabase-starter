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
<!-- Clade native rule; source: rules/core/agent-routing.routing-table.md; edit canonical source -->
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

**判不進任一列時的預設鏈（MUST）**：工作對不上下表任何一列、而它若照主線模型走就會是 Claude Opus 5 時，**MUST** 依序試 `--model grok-xai --effort high` → `--model grok-cursor --effort high` → Claude `sonnet` effort `high`。每一跳都核對 workspace access 與工具能力：Cursor Pi pool 不支援 mutation，遇修改任務跳過該格並在 `skipped_tiers` 記明原因，保留同一 work 身分。下表**已具名 Claude Opus 5 的四列**（`ui-view-implementation`／`design-review`／`ui-detailed-planning`／`screenshot-match-analysis`）照列派，**NEVER** 改走本鏈。

本鏈的起點是「**Opus 5 等級但無落點**」。原判 Claude `sonnet`／`haiku` **等級**的委派工作是另一題，依 [[agent-routing]] § Native delegation model boundary 轉派 **`--model grok-xai --effort high`**（2026-09-10 拍板，取代原本的 `gemini` 首跳：同級或更好的實測品質、更便宜的座位）——兩條 **NEVER** 互換：本鏈的 `sonnet` 是第三跳終點，不是起點。

**`--tier-basis delegate-sub` 的 effort 是結論的另一半，NEVER 只對 model 交叉檢查。** 檔位跟著 model 走，與 `pi-routing-gate.ts` 的 `delegateExpectedEffort` 同一張表：gate-output row 落 astra／medium，其餘每一跳（`grok-xai` 首派、升 Sol、配額降級）都是 `high`；`pi-dispatch.ts` 對兩半都比對、矛盾即 exit 1。配額耗盡沿 `FALLBACK_NEXT` 的 grok 鏈往下走，那些跳仍宣告 `delegate-sub`（挑首派的政策沒有改變），**MUST** 帶 `--retry-of`。**NEVER** 靜默填一個 `--effort low`——它與「判定根本沒發生」事後不可區分。

**`sonnet` 在本檔只有一種合法出現：兩個 grok 池都耗盡之後的終端 carrier。** 它 **NEVER** 是任何工作的檔位選擇。這兩者形狀相同（欄位裡都寫著 `sonnet`）但前提相反：終端 carrier 的前提是 grok 已經不可用，所以它不可能改派 grok；而檔位選擇的前提是「這件事只值 sonnet」，那件事現在一律去 `--model grok-xai --effort high`。逐字反開脫：「反正規約裡本來就有 sonnet」——去看那個 `sonnet` 前面有沒有「耗盡」兩個字，沒有就是本節禁的那一種。

**Herdr pane 拒收 `sonnet`**（`herdr-session-handoff.ts` 的 `refuseSonnetTier`，2026-09-10）：pane 的 model 值域是 Claude-only，所以每次判定落在「sonnet 等級」時 transport 給不出更便宜的座位，欄位就被填成 `sonnet`。Grok 4.6 high 只有 `pi-dispatch.ts` 到得了，所以那道拒絕訊息指的是那支指令，不是另一個可以直接替換的 slug。relay successor 是唯一例外形狀：它持有整個主線位置、當不了 Pi seat，所以判「還是主線複雜度」就 `--model opus`，判「只值 sonnet 等級」就**不要 relay**，改用上面那條 grok worker 派掉、本 session 自己留著。

**NEVER 因為表上沒有你想派的模型就自己挑一個。** 對不上任一列的正解是走上面這條鏈，**NEVER** 是填 `--route manual` 去蓋掉一個從沒發生過的判定——`manual` 是政策成功指標的分母，填錯讀起來是假陰性而不是缺資料。逐字反開脫：「Herdr 要求明確 `--model`，那就在 Claude 值域裡挑一個」（2026-09-09 實測：五筆 dispatch 全部這樣填成 `sonnet` ＋ `manual`，而 `sonnet` 在本表的主模型欄位一次都沒出現過）。

## 工作類別對照

列名是每列開頭 〔`如此標示`〕 的 slug，`--tier-basis table-row` 時逐字填進 `--table-row`。Fallback 是原工作列的執行鏈，不另建立工作類型。

| 工作類別 | 主模型／執行方式 | Effort | Fallback／契約 |
| --- | --- | --- | --- |
| 〔`non-ui-implementation`〕一般非 UI 實作 | GPT-5.6 Luna | medium | 修改、測試、修復與交付同一條鏈；機械具名列沿用該列 |
| 〔`non-ui-implementation-escalate`〕複雜非 UI 實作／修復升級 | GPT-5.6 Sol | high | 根因／方案需要裁決時交 GPT-6 Astra，修改仍交實作者 |
| 〔`implementation-decision`〕實作中的根因／方案裁決 | GPT-6 Astra | medium | 唯讀分析證據，交付根因、修法限制與驗收條件 |
| 〔`detailed-planning`〕非 UI 詳細實作計畫 | GPT-6 Astra | medium | 唯讀產出範圍、介面、依賴、task→file 與驗收 |
| 〔`version-upgrade-first-pass`〕version-upgrade 首輪升版 | xAI Grok 4.6 | low | Cursor Grok 4.6 low → Gemini 3.8 Flash high → blocker |
| 〔`version-upgrade-research`〕version-upgrade 失敗後研究重試 | xAI Grok 4.6 | high | Cursor Grok 4.6 high → Gemini 3.8 Flash high → blocker |
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

## Pi 派工的 model 維與 workspace capability（原在 `agent-routing.md` § Routing Table）

> **Pi 派工是 (model, effort) 二維**，model 維合法值：`astra`、`sol`、`gemini`、`luna`、`luna-cursor`、`grok-xai`、`grok-cursor`（`grok` 是 `grok-cursor` 的向後相容別名）。同一 tier 的 `-cursor` 變體是**換配額池、不換檔位**，只在配額降級鏈上出現，**NEVER** 拿它當第一手選擇。**Routing Table 已列明檔位的類別照列派**；**原本會派 Claude subagent 的委派工作**（原判 `sonnet`／`haiku`）依 § Native delegation model boundary轉派 `--model grok-xai`（檔位見對照表）。**NEVER 派 `--model terra`**（2026-08-11 拍板）。External-web 第一手的 bare `gemini` 解析到 Gemini CLI provider；**NEVER** 改傳 Cursor catalog 的完整 `gemini-3.8-flash` slug 冒充同一跳。
>
> **`*-cursor` NEVER 接要讀 cwd 以外路徑的任務**（cursor 池的 `$HOME` / `/tmp` 是空 tmpfs，拿到的是**與真結果同形**的全 missing 表）。配額鏈走到那一格時，brief 指涉 cwd 以外路徑就**跳過該格**進終端步驟——判的是**這份 brief**，不是列名。`pi-dispatch.ts` 會掃 brief 拒跑（exit 1），但它只看得到 brief 寫出來的路徑，**NEVER** 拿它當自己不必判的理由。**NEVER** 用 `PI_CURSOR_SANDBOX_BIND` 繞過。
>
> **Workspace capability 與路徑可見性是兩個獨立 predicate。** **每一個**會修改 working tree、lockfile、Git index 或建立 commit 的 Pi caller／brief 都屬 `mutation`：concrete table row 由 `pi-routing-policy.ts` 分類，manual caller **MUST** 帶 `--workspace-access mutation`；quota retry **MUST** 沿用 dispatcher 的 `next_step`／`--retry-of`，由 ledger 繼承同一 capability。只讀 inspection／review 才是 `readonly`；manual caller 要進 Cursor pool 時顯式帶 `--workspace-access readonly`。
>
> **違反字面就是違反精神：任何 workspace mutation dispatch，NEVER 選 `grok-cursor`、`luna-cursor` 或 `sol-cursor`，包含每一個 fallback candidate。** `pi-dispatch.ts` 在 Cursor admission fail closed。**NEVER** 為了 mutation 放寬這道 security boundary——兩句最常見的開脫、Red Flags 與實證邊界在 [[agent-routing.routing-table-rationale]] § Cursor sandbox 與 mutation。

### Routing 硬禁令（逐列，原本嵌在表格列內）

下推的是**列的內容**，不是列的禁令。每一條都以 [[agent-routing.routing-table]] 的列名為鍵——
查到那一列時 MUST 回頭讀本節硬禁令表對應列，**NEVER** 只讀對照表就派。

| 列 | 硬禁令 |
| --- | --- |
| `--model gemini`（Routing Table 類別內降檔） | **NEVER** 靜默改用舊 Flash model。 |
| 〔`web-search`〕 | 查不到就回「查不到」，**NEVER** 拿二手彙整頁充數。 |
| 〔`screenshot-review-verify`〕 | 四個模式一律用 Gemini 3.8 Flash（effort: high）；由主線直接呼叫 Pi dispatcher，**NEVER** 以 subagent 中介轉派。模型不可用就回報 blocker，**NEVER** 靜默改派其他模型。 |
| 〔`screenshot-match-analysis`〕 | Opus 5（effort: medium），無法執行時 GPT-5.6 Sol（effort: high）；兩者均讀實際截圖與 item 要求；收集與判定**NEVER** 併成同一次 dispatch。 |
| 〔`mechanical-fanout`〕 | **NEVER** 以「我自己順手跑掉比較快」略過本列（成因見 rationale）。 |
| 〔`copywriting-draft`〕 | 本列 **NEVER** 進全域配額降級鏈（exit 2／3／4 一律直接回本 task 主線自己寫）。**主線 MUST 收斂重寫每一條採用的文案，NEVER 原樣貼進交付物**——Pi 回的是素材不是成稿。本列只涵蓋行銷／產品對外文案，**NEVER** 從本列外推到規約措辭／commit message／技術文件／PR 描述／對外報告。 |
| 〔`notion-ops`〕 | Gemini 3.8 Flash（effort: high）→ GPT-5.6 Luna（effort: high）→ blocker。**本列 NEVER 續走其他 fallback**（Notion auth 在 `$HOME`）。**NEVER** 主線第一手自己跑 ntn／MCP。 |
| 〔`read-heavy-scan`〕 | **NEVER** 拿「反正我讀一下就知道了」略過 gate，也 NEVER 把固定輸出 schema 當成不需裁決的證據。 |
| 〔`commit-0c-fix-verify-escalate`〕 | **NEVER** 當第一手：只在 grok 2 輪後仍紅、grok 報 pass 但主線重跑仍紅、或 grok 兩池都 exit 4 時進。 |

> **每一次** pi dispatch **MUST 帶 `--route` 與 `--tier-basis`**（缺就 exit 1）：前者記走哪條政策（[[agent-routing.routing-table]] 某列 → `routing-table`；§ Native delegation model boundary → `claude-delegate-sub`；配額降級鏈 → `fallback-chain`；皆非才**顯式** `manual`），後者記該政策對 model 的**結論**（六值見 reference）；dispatcher 交叉檢查兩者與 `--model`、矛盾即 exit 1。**NEVER** 不確定就填 `manual` ／ `table-row`——與「判定沒發生」不可區分。重試帶 `--retry-of <label>`，**NEVER** 用 `<label>2`。
>
> **`--tier-basis table-row` 時 MUST 再帶 `--table-row <列名>`**（缺就 exit 1）：列名是 [[agent-routing.routing-table]] 每列開頭 〔`如此標示`〕 的 slug，dispatcher 拿該列的 model 交叉檢查。**NEVER** 因為「反正 table-row 也是查表」就省略它。**NEVER** 在派工當下偏離列上的 model —— 認為某列該換檔位就先改 [[agent-routing.routing-table]] 再派。
>
> **Routing Table 類別的檔位選擇中，NEVER** 拿「輸出會被下游機械消費」當降檔理由：下游若只驗 JSON schema 而不驗語意，降檔引入的錯誤會被自動放大。只有下游具備**獨立且夠強的語意 gate** 才可降檔。（§ Native delegation model boundary 的轉派自帶語意 gate 要求——它的第 3 條 predicate 就是這一條。）
>
> **跑分、配額權重、grok 擴權取證這三類「拿數字當理由」的陷阱，全文在 [[agent-routing.routing-table-rationale]]**——它 paths-gated 於改對照表或動 `pi-routing-*.ts` 的時刻。要拿任何數字支持一次降檔 / 轉列之前 MUST 先讀它，**NEVER** 憑印象引用比例。
