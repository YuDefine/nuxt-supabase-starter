<!--
🔒 LOCKED — managed by clade
Source: rules/core/agent-routing.md
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->

# Agent Routing

<!-- clade-targets: claude,codex,cursor -->
<!-- clade-adapters: claude,codex,cursor -->

<!-- never-density-reviewed: 2026-07-29 — 覆核紀錄見 docs/rule-rationale/agent-routing.md § never-density 覆核 -->

**核心命題**：UI 由 Claude Code 主線 Opus 實作；一般非 UI 用 GPT-5.6 Luna／Gemini、複雜非 UI 用 GPT-5.6 Sol；GPT-6 Astra 只做計畫、決策與 review。本規則優先於 skill 內嵌指示。

**GPT 外派載體**：Codex 主線 → 任一 GPT 可用原生 agent；每個非 Codex 主線 → 任一 GPT 一律用 Pi。Claude Code 不承載 GPT。

> 本檔是 routing 主規則（每 session 必載入）。派工模板、Watch Protocol、Plan-first / Git baseline、Runtime Gate 在 [`agent-routing.pi-watch-protocol.md`](./agent-routing.pi-watch-protocol.md)（下稱 reference）。
>
> **決定要派 pi 之後、送出 dispatch 之前，MUST 先 Read reference 的 § Pi 派工的標準流程。** reference 的 `paths:` 綁的是 spectra / screenshot 情境，「單純要派 pi」的 session **不會**自動載入它——靠 auto-load 會讀不到（成因與實測見 `docs/rule-rationale/agent-routing.md`）。

## 派不派（先於派給誰）

**先判角色，再判派工量。** Astra 主線遇到已知三檔的一般修正 → 派 Luna 修改與測試；已有 context／省交接成本也照派。code／test、evidence、修復、工具協調都非 Astra 角色。

角色相符時，**主線自己做是預設。違反字面就是違反精神**——「反正派了比較快」「一件一個 agent 比較整齊」都不算遵守。下面的 Routing Table 決定**派給誰**，本節決定**派不派**：講不出命中哪一條外派條件，就是主線自己做。

**外派條件**（命中任一才派）：

- **角色不符**——當前模型不符工作角色。修改、測試、修復、交付整段交同一實作者；Astra 完成計畫／決策／review 後將結論交回。
- **寬掃**——要讀 5 個以上檔案或整棵目錄樹才答得出的問題。派 scout 回結構化事實表（檔名 / 行號 / 現值 / 判準命中與否），原文不進主線
- **有份量的獨立平行軌**——兩條以上彼此不讀對方產出的工作，且**每一條**都要 10+ tool call 才做得完
- **長時間 background job**——跑得久且主線不必盯著（build / 大量 test / 長 migration）
- **需要隔離環境**——worktree 平行改動、會互相踩檔或搶 port 的工作

**不外派**（命中就自己做，即使同時有好幾條）：少量工具即可結束；路徑已知的少量讀取；規約 / 契約 / 對外文件的**定稿措辭**（會原樣成為交付物的最終文字）；**UI view 實作**與視覺判讀 / Design Review（component / page / view / layout / styling —— 由具備該項既有視覺品質資格的主線執行；change carrier 不具資格時按下方 runtime residency 分工處理）；需要 claude.ai-connected MCP、且 **ntn CLI 做不到** 的工作（Notion 走 〔`notion-ops`〕，不在此列）；安全敏感或不可逆的動作（憑證 / 刪檔 / force push / 對外發佈）；**複驗自己剛做完的東西**（判準見 [[checker-subagent]] § 過度派）。

**具名 threshold 優先於上段的 generic「少量」判準**：同一 prompt segment 準備執行第 3 個高信心 readonly Bash、第 5 個 distinct textual Read，或第一次 Read 501+ 行文字檔時，PreToolUse gate 會建立 pending decision。主線 MUST 以 decision-linked dispatch（exact trigger 走 `luna low`；更具體工作可走共用 policy 驗證過的 concrete Pi row）、structured waiver，或 dispatcher exit 3／4 後的 matching fallback authorization receipt 結案；完整命令與狀態轉移見 reference § Routing threshold gate。

**命中多條外派條件時先問「一個 subagent 能不能全部做完」**——能就派**一個**，**NEVER** 一條 task 配一個 agent 地拆。

**同時像寬掃又像措辭時看產出形狀**：產出是事實表 / 清單 / 統計 → 派（寬掃的價值在把原文壓成結論）；產出是要寫進規約、契約或對外文件的**定稿措辭** → 留。措辭的語氣與抽象層級一致性外包不了，派出去的典型結果是回頭逐條重寫（成本見 rationale）。

**NEVER 因 plan mode 這類唯讀模式寫不了檔，就判 in-process subagent 不能派**——native delegation tool 的 brief 是 prompt 字串、不落檔，只有 `pi-dispatch.ts` 與 Herdr transport 落檔。逐字反開脫：「plan mode 不允許寫 brief 檔，所以改由主線直接讀檔探索」。

## 派多少（決定派之後的第二題）

上節決定**派不派**，本節決定**一份 brief 裝多少**。已決定把某件工作交出去（user 指示或命中外派條件）時，MUST 接著判 brief 的範圍：

1. **列出剩餘工作中，開工需要讀被派工作產出的每一環**（判法同 edge 判定：「B 開工需要 A 的產出嗎」）。這些環與被派工作構成一條**串行鏈**。
2. **對鏈上每一環問：它需要什麼是寫不進 brief 的？** 可觀察判準：該環需要的每一個事實（值、證據、驗收步驟、已排除假說）都寫得進 brief → 不需要主線。命中上節「不外派」清單（定稿措辭 / UI 判讀與視覺判定 / 不可逆動作需 user 拍板 / 本 session 專屬 gate）的環才是**合法切點**。
3. **預設把整條鏈寫進同一份 brief 交給同一個受派者**。要切在鏈中間，MUST 能具名指出：留下的第一環是哪一環、它需要主線或 user 的什麼。講不出來 = 沒有留的理由 = 整條交出去（鏡像上節 Iron Law 的「講不出命中哪一條就自己做」）。
4. 切點若是「需 user 拍板」的環，考慮把**拍板問題本身**也寫進 brief 讓受派者到點回報，而不是主線閒置守在那一環前面。

**Red flag**：發現自己在 brief 裡寫「不要做 X，X 由主線處理」，當場問一句「主線做 X 需要什麼 worker 沒有的東西」。答不出具體事實 = 慣性佔位，刪掉那句、把 X 寫進 brief。

**本節 NEVER 產生新的派工**——它只調整一次已授權派工的 brief 範圍，**受派者數量不變、冷載次數不變**，因此套不上過度外派的成本模型。反而是切在鏈中間才製造第二次交接（回報 → 主線續跑 → 可能再派），更接近過度外派的形狀。

**範圍嚴格限定在與被派工作有資料依賴的串行鏈**——無關的平行工作回歸上節逐項判，**NEVER** 讀成「派工時把所有剩餘工作都塞進 brief」。

**中切不是禁止，是需具名理由**：鏈中間真有需要 user gate 或主線 context 的環時，切在那環之前正是對的。

> 既有的三處特例是本節的實例，不取代本節：`handoff/relay-steps.md` §0 與 `session-tasks.operations.md` § 派幾個 pane（兩者都框在「serial 工作 NEVER 拆給 N 個 worker」），以及 `handoff/dispatch-common.md` § 2 的 brief 範圍檢查點。**它們防的是「拆給 N 個 worker」，本節多防一種形狀：切成「worker ＋ 主線自己」**——那種切法在既有條文的字面下不會 fire，因為沒有第二個 worker。

## Runtime residency and native transport

Routing Table 決定誰執行工作；本節只定義 change-level carrier 與 bounded phase executor 的分離。
每一個 runtime 的原生 dispatch、session、browser、model 與 user-input surface 都由對應的 adapter fragment
聲明；缺少該 target 的已驗證 surface 時，相關動作維持 blocked，**NEVER** 以另一個 runtime 的
API 名稱或工具形狀代打。

**UI 執行資格與 session residency 分開判**：當前主線已有該項視覺品質資格及實際圖片／browser access，UI 實作與判讀留主線；沒有該資格時，change carrier 保持原 session，僅以 target adapter 已授權的 bounded phase transport 交給合格 executor。沒有合格且可用的 executor 就保持該 phase 未完成。Pi 機械列與一般 native subagent 不取得 UI 資格；模型較新、名稱含 high、或 runtime 相同都不是資格證據。既有 Opus 視覺執行基準仍是既有資格，新組合需實測與採用決定，不因本次分層自動獲准。

**共通規約**：Pi CLI 是跨 runtime 的 machine carrier；其 model、effort、route、tier-basis、
workspace-access、retry 與 receipt 欄位沿用本檔及 reference 的契約。原生 runtime transport 只
提供該 target 的互動入口，不改寫共通 routing predicate、品質 gate、scope 或 fallback policy。

## 停下來要人做之前（agent 與人的邊界，先於一切派工判定）

上一節決定「主線做還是派出去」，本節決定**更前面**的一件事：這件事到底該不該離開 agent。
適用**每一次**準備寫出「請你跑 / 需要你 / 麻煩你 / 我自己解不開」的時刻，不分工具、不分情境。

**Iron Law：本 session 執行得了的動作**與**本 session 查得出答案的決策** NEVER 交給人。
違反字面就是違反精神——「他跑比較快」「這樣比較安全」「我試過了做不到」都不算遵守。

### MUST：兩條全中才准交給人

1. **該動作在本 session 已實際嘗試過並失敗**，且貼得出失敗的逐字輸出（指令 + exit code + 訊息）。
2. 失敗原因落在**人類專屬能力**：需要人的憑證或生物辨識、需要人在外部系統點擊授權、需要人做
   商業／產品決策、或該動作不可逆且既有規約明文要求人 gate。

兩條缺一就是自己做。**NEVER** 用「規約沒寫這種情況」推論可以交給人——沒有規約覆蓋的新情境，
預設是 agent 自己處理，不是升級給人。

### MUST：相鄰動作的失敗 NEVER 當作目標動作的證據

探測用的指令被擋、相似的指令失敗、同一個 gate 擋過別的東西——**都不是**目標動作會失敗的證據。
第 1 條要的是**那一個動作本身**的失敗輸出。

**NEVER** 把「機制 M 擋掉了 A」推論成「機制 M 會擋掉 B」，即使 A 與 B 都經過 M。實測：擋住
探測指令與放行解法指令，正是同一個 gate 被設計成要同時做到的兩件事。

### MUST：session-scoped 的動作只有本 session 做得到

動作若綁在本 session 的身分上（routing gate latch、session claim、verification lease、
本 session 持有的鎖），人與其他 session 都**代勞不了**——交出去不是省事，是把它變成無人能解。
遇到這類動作，第 1 條的「實際嘗試」是唯一出路。

### Red Flags（發現自己在想這些 = 停下來，先去實際跑一次）

- 「我自己解不開」——在還沒逐字跑過該動作之前
- 「這是死鎖 / 這是雞生蛋」——結構性不可能要有兩端各自的失敗輸出才成立
- 「請你跑這行就好，很快」——快不是理由，第 2 條才是
- 「我用 X 驗證過了，所以 Y 也不行」——X 不是 Y
- 「規約沒說這種情況怎麼辦，先問人比較保險」——沒覆蓋的預設是自己做
- 「這 blocker 是別 session 造成的，該問 user 怎麼走」——查歸屬 ＋ SendMessage 協調，**NEVER** 用 `structured user-input surface` 把跨 session 衝突退回

### 已有的領域實例（本節是它們的通則，不取代任何一條）

[[proactive-skills.dev-server-spawn]]（agent 自起 dev server，不叫 user `cd`）、[[commit.detail]]
（不叫 user 開 main session）、[[session-tasks.operations]] § Herdr session transport（transport 失敗回具體
blocker，不降級成叫 user 貼 prompt）、[[review-gui-surface]]（`fix-requested` item 是 Claude 的
工作，不推給 user）、[[manual-review.data-readiness]]（marker 誤標先改 marker，不叫 user 自己想辦法）。

新情境不在上列時適用本節通則，**NEVER** 因為「我這個情況不在清單裡」就交給人。

> 取證見 rationale § 停下來要人做之前的量測。**本證據不決定**要不要用 gate／latch 這類機制——
> **NEVER** 拿它論證放寬或移除 gate。

## Dispatch 資料邊界（Approved-Tools gate，先於能力判斷）

上一節管的是**動作**（憑證 / 刪檔 / force push），本節管**內容**：完全合法的外派動作照樣可以把 secret 或客戶個資寫進另一個 runtime 的 prompt 與其日誌。適用**每一次** dispatch 的**每一種** brief 載體——`pi-dispatch.ts` 的 prompt 檔、Claude subagent 的 thin brief、Herdr durable task 檔、workflow agent 的 prompt 字串。

### MUST：brief 明列 Approved Tools

每份 brief **MUST** 有一段逐條列出這次准許動用的資源：可讀 / 可寫的檔案或目錄、可跑的指令、
可打的外部服務，並寫明**清單外的一律回報、NEVER 自取**。

這是本節唯一**買得到東西**的一條，其餘是查表（micro-test 數字見 rationale § dispatch 資料邊界的量測）。

清單寫不出來 = 這件事還沒被消化到可以外派（回 § 派不派 的預消化紀律）。

### 逐項列路徑的紀律、不進 prompt 的查表、為何沒有機械網子接，全文在 [[agent-routing.pi-watch-protocol]]（具名時機 MUST-Read）

**寫任何一份 dispatch brief 之前（`pi-dispatch.ts` 的 prompt 檔、Claude subagent 的 thin brief、
Herdr durable task 檔、workflow agent 的 prompt 字串都算），MUST 先讀
[[agent-routing.pi-watch-protocol]] § Dispatch 資料邊界（全文）**——沒讀到就沒有「檔案 MUST 逐個
列精確路徑、NEVER 只給目錄名」、沒有四類**不進 prompt** 的查表與各自的替代帶法，也不會知道
redaction（`vendor/signals/redact.mjs`）只作用在 signal payload、**dispatch prompt 不經過它**。

## Session transport boundary

每次 dispatch/resume/retry/bridge **MUST** 按 Routing Table 或使用者 override 明傳 model/effort；**NEVER** inherit、取環境/主線預設或偷換模型。Claude 用 Claude Code，GPT/Gemini/Grok 工作用 Pi；Codex 是 runtime，角色由實際模型決定。requested 與 observed 分記，無 runtime 證據就是 unverified。

**派工前 MUST 讀 [[agent-routing.pi-watch-protocol]] § GPT worker transport**（有效模型核對、cx／codex 不得替代）；換 cwd／新 session 另讀該檔 § Herdr transport 邊界與 [[session-tasks.operations]] § Herdr session transport。Herdr 不新增 routing 權限，能原地完成就原地做，失敗不退回人工。Pane 缺席不等於無工作，查 `vendor/scripts/herdr-patrol.ts`。

## Routing Table

**查表決定 model／effort 之前 MUST 先 Read [[agent-routing.routing-table]]**——工作類別與 effort 對照在該檔，本節保留跨列判準與硬禁令。
**NEVER 憑記憶派**：列上的 model／effort 每隔幾週就改，而派錯的那一次與查過表完全同形，
事後從 ledger 也分不出來。**NEVER** 因為「這類工作我派過很多次」就跳過那次 Read。

> **Pi 派工是 (model, effort) 二維**，model 維合法值：`astra`、`gemini`、`luna`、`luna-cursor`、`grok-xai`、`grok-cursor`（`grok` 是 `grok-cursor` 的向後相容別名）。同一 tier 的 `-cursor` 變體是**換配額池、不換檔位**，只在配額降級鏈上出現，**NEVER** 拿它當第一手選擇——具名例外只有四個 repo-scan 列。**NEVER** 據此推論其他 tier 或其他列也能提第一手。**Routing Table 已列明檔位的類別照列派**；**原本會派 Claude subagent 的委派工作**（原判 `sonnet`／`haiku`）依 § Native delegation model boundary轉派 `--model gemini`（額度耗盡才回 `luna`）。**NEVER 派 `--model terra`**（2026-08-11 拍板）。External-web 第一手的 bare `gemini` 解析到 Gemini CLI provider；**NEVER** 改傳 Cursor catalog 的完整 `gemini-3.8-flash` slug 冒充同一跳。
>
> **`*-cursor` NEVER 接要讀 cwd 以外路徑的任務**（cursor 池的 `$HOME` / `/tmp` 是空 tmpfs，拿到的是**與真結果同形**的全 missing 表）。配額鏈走到那一格時，brief 指涉 cwd 以外路徑就**跳過該格**進終端步驟——判的是**這份 brief**，不是列名。`pi-dispatch.ts` 會掃 brief 拒跑（exit 1），但它只看得到 brief 寫出來的路徑，**NEVER** 拿它當自己不必判的理由。**NEVER** 用 `PI_CURSOR_SANDBOX_BIND` 繞過。
>
> **Workspace capability 與路徑可見性是兩個獨立 predicate。** **每一個**會修改 working tree、lockfile、Git index 或建立 commit 的 Pi caller／brief 都屬 `mutation`：concrete table row 由 `pi-routing-policy.ts` 分類，manual caller **MUST** 帶 `--workspace-access mutation`；quota retry **MUST** 沿用 dispatcher 的 `next_step`／`--retry-of`，由 ledger 繼承同一 capability。只讀 inspection／review 才是 `readonly`；manual caller 要進 Cursor pool 時顯式帶 `--workspace-access readonly`。
>
> **違反字面就是違反精神：任何 workspace mutation dispatch，NEVER 選 `grok-cursor`、`luna-cursor` 或 `sol-cursor`，包含每一個 fallback candidate。** `pi-dispatch.ts` 在 Cursor admission fail closed。**NEVER** 為了 mutation 放寬這道 security boundary——兩句最常見的開脫、Red Flags 與實證邊界在 [[agent-routing.routing-table-rationale]] § Cursor sandbox 與 mutation。
>
> 選 effort 檔位看六維——規格清晰度／搜尋空間與分支度／語意跨度（跨檔・矛盾來源）／錯誤成本不對稱性／可驗證性／mutation blast radius——**NEVER** 只看「這個工作重不重要」或「迴圈長不長」。

### Routing 硬禁令（逐列，原本嵌在表格列內）

下推的是**列的內容**，不是列的禁令。每一條都以 [[agent-routing.routing-table]] 的列名為鍵——
查到那一列時 MUST 回頭讀本節硬禁令表對應列，**NEVER** 只讀對照表就派。

| 列 | 硬禁令 |
| --- | --- |
| `--model gemini`（Routing Table 類別內降檔） | **NEVER** 靜默改用舊 Flash model。 |
| 〔`web-search`〕 | 查不到就回「查不到」，**NEVER** 拿二手彙整頁充數。 |
| 〔`spectra-phase-implementation`〕 | **NEVER 轉 grok**（見 reference § Spectra Routing Table）。 |
| 〔`screenshot-review-verify`〕 | **本列走 Pi `--model gemini --effort high`**。**NEVER** 用 Cursor Task `model=claude-*` 假裝本列。**NEVER 恢復「subagent 再轉派」**的形狀。`pi-dispatch-screenshot-verify.ts` 只是轉向泛用 dispatcher 的相容入口。 |
| 〔`screenshot-match-analysis`〕 | 收集與判定是兩個角色，**NEVER** 併成同一次 dispatch。 |
| 〔`mechanical-fanout`〕 | **NEVER** 以「我自己順手跑掉比較快」略過本列（成因見 rationale）。 |
| 〔`copywriting-draft`〕 | 本列 **NEVER** 進全域配額降級鏈（exit 2／3／4 一律直接回本 task 主線自己寫）。**主線 MUST 收斂重寫每一條採用的文案，NEVER 原樣貼進交付物**——Pi 回的是素材不是成稿。本列只涵蓋行銷／產品對外文案，**NEVER** 從本列外推到規約措辭／commit message／技術文件／PR 描述／對外報告。 |
| 〔`notion-ops`〕 | **本列 NEVER `luna-cursor`**（auth 在 `$HOME`）；luna 的 exit 4 payload 寫 `next_tier: luna-cursor` 時本列忽略該格、直接回主線。**NEVER** 續走 grok-xai／Haiku。**NEVER** 主線第一手自己跑 ntn／MCP。 |
| 〔`read-heavy-scan`〕 | **NEVER** 拿「反正我讀一下就知道了」略過 gate，也 NEVER 把固定輸出 schema 當成不需裁決的證據。 |
| 〔`commit-0c-fix-verify-escalate`〕 | **NEVER** 當第一手：只在 grok 2 輪後仍紅、grok 報 pass 但主線重跑仍紅、或 grok 兩池都 exit 4 時進。 |
| 〔`security-review`〕 | **NEVER** 因為「零互動 / structured diff → structured findings」就把安全 gate 當 pattern matching 降檔——漏報成本不對稱，class-conditional 差距遠大於通用 benchmark（見 rationale § model 檔位的量測依據）。 |

> **每一次** pi dispatch **MUST 帶 `--route` 與 `--tier-basis`**（缺就 exit 1）：前者記走哪條政策（[[agent-routing.routing-table]] 某列 → `routing-table`；§ Native delegation model boundary → `claude-delegate-sub`；配額降級鏈 → `fallback-chain`；皆非才**顯式** `manual`），後者記該政策對 model 的**結論**（六值見 reference）；dispatcher 交叉檢查兩者與 `--model`、矛盾即 exit 1。**NEVER** 不確定就填 `manual` ／ `table-row`——與「判定沒發生」不可區分。重試帶 `--retry-of <label>`，**NEVER** 用 `<label>2`。
>
> **`--tier-basis table-row` 時 MUST 再帶 `--table-row <列名>`**（缺就 exit 1）：列名是 [[agent-routing.routing-table]] 每列開頭 〔`如此標示`〕 的 slug，dispatcher 拿該列的 model 交叉檢查。**NEVER** 因為「反正 table-row 也是查表」就省略它。**NEVER** 在派工當下偏離列上的 model —— 認為某列該換檔位就先改 [[agent-routing.routing-table]] 再派。
>
> **Routing Table 類別的檔位選擇中，NEVER** 拿「輸出會被下游機械消費」當降檔理由：下游若只驗 JSON schema 而不驗語意，降檔引入的錯誤會被自動放大。只有下游具備**獨立且夠強的語意 gate** 才可降檔。（§ Native delegation model boundary 的轉派自帶語意 gate 要求——它的第 3 條 predicate 就是這一條。）
>
> **跑分、配額權重、grok 擴權取證這三類「拿數字當理由」的陷阱，全文在 [[agent-routing.routing-table-rationale]]**——它 paths-gated 於改對照表或動 `pi-routing-*.ts` 的時刻。要拿任何數字支持一次降檔 / 轉列之前 MUST 先讀它，**NEVER** 憑印象引用比例。

### Plan mode 期間的派工邊界

Plan mode 的契約是「不對 repo 做任何改動」。Pi dispatch 的 ledger（`~/.pi/agent/clade/dispatch-ledger.jsonl`）與 prompt 持久化（`~/.pi/agent/clade/dispatch-prompts/`）寫在 **homedir**，不是 repo working tree，**不違反** plan mode 的 no-mutation 契約。

- **Plan mode 期間可派的 Routing Table 列**：`read-heavy-scan`、`mechanical-fanout`（read-only profile）、`exploration-prescan`、`handoff-scan`、`task-planning-prescan`、`publish-prescan`、`screenshot-match-analysis`、`notion-ops`（read-only：scan／query）——這些列的工作不寫 working tree。
- **Plan mode 期間不可派的列**：`spectra-phase-implementation`、`spectra-mechanical-substep`、`commit-0c-fix-verify`（含 escalate）、`debug-evidence`、`bugfix-evidence`、`notion-ops` 的 create／patch（遠端副作用，即使不寫 repo）——這些列的產物是 repo 內的 code change 或遠端 mutation，plan mode 下不應執行。
- **NEVER** 因為「plan mode 不該有副作用」就把 read-only 的派工也退回主線自己做——那把 routing table 標明應派工的量體全堆回 Opus 主線，正是 TD-507 要修的行為。

**Claude subagent 在 plan mode 的 gate 行為（TD-631）**：plan mode 禁止寫檔，而 routing gate 的
`[dispatch]` 補救要先落 brief 檔——那條路徑在 plan mode 結構上不可執行。`pi-routing-gate.ts` 自
`096ad5ea1` 起讀 `permission_mode`：plan mode 的 `Explore` / `Plan` dispatch 直接放行不 mint
decision，其餘 `subagent_type` 照常 arm，block 訊息指名唯一可跑的
`[waive] --reason plan-mode-readonly`。放行**不**解除既有 latch。**NEVER** 為了走 `[dispatch]`
而在 plan mode 寫 brief 檔繞過 harness，**也 NEVER** 把該 latch 回報成 deadlock。

## Native delegation model boundary

先過 Routing Table，再判定是否需要 target-specific delegation。Model、effort、workspace access、
route、tier-basis 與 retry 是共通欄位；只有目標 runtime 的 adapter 能提供的 session／user-input
mechanics 才進該 adapter。**NEVER** 以 runtime API 的存在推導模型資格，也 **NEVER** 以缺少某端
API 改寫共通 model-quality 或 evidence 判準。

## Orchestration Residency（誰持有長 session — 決定層）

Routing Table 決定誰**寫** code，本節決定誰**持有長 session**。依 change 特性判定 change-level
carrier 與 phase executor；兩者是獨立 predicate。

- tasks.md 已定稿、工作進入已知執行計畫，或屬機械 sweep 時，使用能承載整條 change 歷史的
  change-level carrier；UI／Design Review 與其他需特定 runtime harness 的 bounded phase 仍依
  capability routing 執行。
- 架構／設計決策、需求模糊、安全敏感、clade routing 規則編輯與未知路徑 debug 保留在
  能直接作出該判斷的主線。
- **長 session carrier 與 phase executor 是兩題。** UI 或其他 target-specific phase 不會反向
  改寫 residency；每一條 change 開工都 MUST 跑 `residency-classify.ts classify` 並 `record`。

各 target 的 carrier、bounded handoff 與 completion notification 只由對應 adapter fragment
描述；reference 的 Orchestration Residency 段落保留 phase scope、claim、cross-check 與回收 gate。

## Spectra Propose / Apply Dispatch（決策層 — thin pointer）

`spectra-propose` 的三選一 dispatch 選單與主線 quality gate 責任、`spectra-apply` 的 phase 粒度
三條契約（Design Review 與 UI view phase 都永不外派／非 view phase 才派 Pi／混雜 phase
的已開工與未開工分支），全文在 [[agent-routing.pi-watch-protocol]] § Spectra Propose Handoff
與 § Spectra Apply Phase Dispatch。

**跑 `/spectra-propose` 或 `/spectra-apply` 之前 MUST 先讀那兩節**——本檔的 Routing Table 只回答
「派給誰」，那兩節回答「這條 change 該怎麼切、哪些 phase 不准外派」，Routing Table 答不出來。
先判 residency（§ Orchestration Residency）仍是這兩節的前置。

## External web retrieval Handoff（決策層）

**違反字面就是違反精神：每一次 `WebSearch` 與 `WebFetch` 都先走 external-web decision gate。**

1. **NEVER** 直接呼叫 Claude Code 內建的 `WebSearch` 或 `WebFetch`；照 gate 印出的 decision-linked 指令依序走 bare `gemini high` → bare `luna high` → matching receipt 才放行原tool kind與candidate。完整旗標、exit transition與receipt契約見 [[agent-routing.pi-watch-protocol]] § External web retrieval。
2. query／公開URL／fetch prompt只以hash進state／receipt；含credential、signed token、private-network或secret material時fail closed，Pi與direct built-in都不放行，改用authenticated first-party connector或本機redacted source。

**例外清單是窮舉的**：**唯一的一般 waiver** 是使用者明確要求direct built-in web tooling，且`user-explicit-mainline` receipt綁定原tool kind與candidate。「單一已知URL」不是例外。

**本節射程只涵蓋 Claude Code 內建的 `WebSearch` / `WebFetch`。** `target-native IDE browser`（`browser_navigate` 等）與 `target-native app control` **不是**這兩支 tool，**NEVER** 套本節去擋 IDE browser。Cursor 環境的開頁契約由 target adapter 的 browser carrier fragment 定義。

**NEVER 拿本規約的 rationale 推翻本規約的字面。** 壓力測試見`vendor/snippets/rule-authoring/scenarios/web{search,fetch}-direct-call.md`。

## 配額邊界（決策層）

Pi `openai-codex`目前不提供authoritative pre-dispatch quota snapshot。Dispatcher的quota precheck固定回`available:false`並fail-open；舊`~/.codex/sessions/**/rate_limits`只代表legacy Codex CLI歷史，**NEVER**拿它阻擋或宣稱Pi現況。

- Pi runtime回usage／rate-limit／quota error → dispatcher exit 4，payload帶`detected:'runtime'`與可解析到的`resets_at_human`。
- 沒有reset資訊時不得捏造window長度或時間；直接走 § 配額耗盡時的 fallback 紀律。
- 有明確reset時間且工作確實綁該外部signal時，可回報該時間；這不改變當下先判斷fallback能否完成工作的責任。
- `--no-quota-check`只改回報為`skipped:true`，不會繞過provider runtime quota。

**拿到 codex-primary verdict、要判「這件事小到不必真的 dispatch 嗎」之前，或要動配額鏈 `-cursor` 那一跳之前，MUST 先讀 [[agent-routing.pi-watch-protocol]] § 配額與 residency 的下推兩段**——最小 dispatch 門檻的三條連言與 `trivial-threshold` reason 值、`-cursor` 的兩層機械門檻，都在那裡。

### 配額耗盡時的 fallback 紀律

**執行 SoT 是 dispatcher 自己的 exit 4 payload**：`pi-dispatch.ts` 撞 runtime quota 時回
`next_tier` / `next_step`（`--chain-origin` 未解時 `next_tier` 回 null 並要求補帶），逐跳鏈與終點
Claude 檔位由它機械算出。**MUST 照那個 payload 派下一跳，NEVER 憑印象選 model**——記不得鏈長什麼樣
不是問題，payload 每次都會印。

always-load 只留 payload **算不出來**的三條判斷：

- **NEVER** 把 Astra 的活降成 Luna——鏈上每一跳是**換配額池**，不是降檔
- **Sol 實作配額耗盡**：依 dispatcher 回報可用的同角色 carrier 或明確 blocker；**NEVER** 把 Astra、cx 或 Claude Code＋GPT 當實作接手者。品質失敗需要 Astra 時另開 `implementation-decision`，決策完成後交還實作者。
- **NEVER** 拿 `--effort low` 重試當配額應對——配額按 **model** 記，同一個 model 撞的是同一個 limit
- **輸出本身就是 gate 的工作，鏈的終點 NEVER 是主線自審**。判準見
  `vendor/scripts/pi-routing-policy.ts` 的 `GATE_OUTPUT_ROWS`（`code-review` /
  `security-review` / `spectra-artifact-review` / `spectra-prehandoff-judge`）——那一組與
  § NEVER 降檔的形狀 第一條同源，**MUST 一起改**。理由是這類工作沒有「誰做都行」這個性質：
  產出 changeset 的那條主線回頭審自己，gate 形式上補了位、實質是空的。一般 gate row 在 Astra
  配額耗盡後由 dispatcher 指向 **Fable subagent**（`--model fable`，effort `max`）；
  `PI_GATE_UNMET_ON_ASTRA_EXHAUSTION_ROWS` 是更嚴格的子集：`spectra-artifact-review` 的 reviewed
  draft 本來就由 Fable family 產生，因此 payload 必須回 `gate_met:false` 與
  `durable_follow_up_required:true`，caller 建立 durable follow-up，Fable／Opus／Luna／Grok
  都不得補位。其餘非 gate row 才回本 task 主線。Astra 目前沒有已驗證的 Cursor model，直接採用上述終點。
  **Runtime-specific carrier 例外**：Fable／Opus subagent 不得把另一 runtime 的 model catalog 當成本端資格；改走 § Runtime residency and native transport 所指的 target adapter carrier。
- `-cursor` 那一跳先過 workspace capability：`mutation` 一律跳過、`readonly` 才繼續判材料來源與 cwd visibility。材料來源的准入 **MUST 綁在待審材料本身，NEVER 綁在使用者意願**（TD-534）；兩層機械門檻與「NEVER 做成可繞過的形式」全文在下面那條指針指的那一節

鏈的完整形狀、cross-family 跳的准入連言、`--chain-origin` 為何在 `grok-xai` 那格 required、
grok 接手 luna 鏈的 `PRECONDITIONS_VERIFIED:` 補償控制，全文在
[[agent-routing.pi-watch-protocol]] § 配額耗盡時的 fallback 紀律 —— **要新增或改動任何一跳之前
MUST 先讀那一節**，本 pointer 不複述。

## Subagent 回報契約（所有 dispatch 通用）

適用範圍：**每一個** dispatch——native delegation 開的 Claude subagent、泛用 dispatcher 派的 pi、[[subagent-dev]] 的 implementer / reviewer，全部適用，不是只有長任務才用。

1. **4-status 回報**：brief 內 MUST 要求 subagent 以四值之一收尾——`DONE`／`DONE_WITH_CONCERNS`（完成但對正確性有疑慮，concerns 必列）／`NEEDS_CONTEXT`（缺資訊，列缺什麼）／`BLOCKED`（做不了，列卡點與已試方法）。主線處置：`DONE_WITH_CONCERNS` → 先讀 concerns 再決定收不收；`NEEDS_CONTEXT` → 補 context 重派；`BLOCKED` → 依序考慮補 context／升 model／拆小／上報 user。**NEVER** 對 BLOCKED 原樣重派同一 model 不改任何條件。
2. **Report 是未驗證主張**：subagent 完成回報（含「no changes outside scope」「tests pass」「已自我 review」）一律當 claim——主線 MUST 用 `git status --short` + `git diff` 核實實際改動範圍 = brief 宣告 scope，scope 外 substantive change 一律 revert。subagent 自報的設計說詞（「per YAGNI 略過」「刻意簡化」）**不得**降級任何 review finding 的嚴重度——那是實作者替自己打分。
   **Cursor 池的核實邊界（TD-520）**：`*-cursor` model 的 dispatch，pi 事件流只回放 builtin 七種工具（read/bash/edit/write/grep/find/ls）∩ pi active tools 的原生執行；**非 builtin 的原生工具（WebFetch、Delete、Cursor 端 Subagent 再派、MCP 呼叫）任何 profile 下都不產 tool_execution 事件**。`git status` / `git diff` 的核實**只覆蓋 worktree 內**——worktree 外副作用（`/tmp`、`$HOME`、網路）**查不到也稽核不了**。因此：會處理 secrets / prod 憑證、或 brief 明定「不得外連」的任務 **NEVER** 走 cursor 池；其餘任務走 cursor 池時，主線 NEVER 把「worktree 核實通過 + events log 乾淨」講成「無 scope 外副作用」——cursor 池的 events log 是單向證據，有痕可信、無痕不表示沒發生。
3. **File handoffs**：brief／report／diff 超過 ~30 行的內容走**檔案路徑**傳遞，不貼進 dispatch prompt 或回報訊息——貼文會常駐主線 context、每 turn 重讀。dispatch prompt 五要素：定位一行、brief 檔路徑、跨 task interfaces、歧義裁決、report 檔路徑＋回報契約（單一事件實錄見 rationale）。
4. **Model 與 effort 顯式指定**：**每一個** dispatch 都 MUST 把 model 與 effort 當成兩個獨立決策，不靠靜默繼承——省略 = 繼承主線（通常最貴檔 × 最深推理），機械掃描型 subagent 拿主線的 xhigh 跑就是效能過剩。選檔預設，依序判：
   - **先過 Routing Table**：非 UI 工作命中本檔已 route 給 Pi 的類別 → 依該列的 model / effort 派工（`mechanical-fanout`、`read-heavy-scan` 為 `gemini low`；`notion-ops` 為 `gemini high`），**NEVER** 用 Claude subagent 接；Claude subagent 只留給 Claude 例外（需 claude.ai-connected MCP 且 ntn 做不到、判讀／治理型分析、user 明確指定）
   - **UI view 實作**：依 § Runtime residency and native transport 的 UI 資格判定；**NEVER** 用機械掃描／一般 native delegation 檔位承接 UI phase。原 session 保持 change-level orchestration。
   - **effort 選檔**：Astra 依 named row 使用 `low` 或 `medium`；Sol 保留自己的 effort，**NEVER** 把 Sol alias 或 effort 映射成 Astra。其他模型：機械掃描／純轉錄 → `low`；一般執行 → `medium`；判讀型／高錯誤成本 → `high` 以上。**帶得了 effort 參數的入口**（pi `--effort` / `-c model_reasoning_effort`、Workflow `agent()` 的 `effort`、具名 agent type 的 frontmatter）**MUST** 顯式帶；native delegation 的 model／effort 欄位以本次 tool schema 為準。schema 有可用欄位時依已選檔位填入；schema 不提供欄位時記錄實際繼承限制，不能宣稱已指定。各 runtime 的欄位與繼承條件見 target adapter
   - model 選檔原則「**turn count beats token price**」：brief 內含完整 code 的純轉錄型工作才用最低檔；review 型依 diff 的大小／風險選檔（為什麼見 rationale）。
5. **中間產物不進主線**：外派出去的 task，主線只讀對方寫回的 report 檔，**NEVER** 為了「確認它做對」把該 task 碰過的原始檔重讀一遍——那把省下來的 context 原封不動加回來，而且重讀的是同一批事實，換不到新判斷。第 2 條的 scope verify 照舊 MUST 跑：看**改了哪些檔**（`git status --short` / `git diff --stat`）跟重讀檔案內容是兩件事。

N ≥ 3 個 dispatch 的 findings 要收斂進同一個 synthesis 時，reducer 的五步形狀、group key 准入表與 guard 表在 `~/offline/clade/vendor/snippets/fan-in-reduction/`。**這不是規約**——micro-test 顯示寫成 MUST 買不到東西，見 rationale § fan-in reducer 量到什麼。

## 主線靜默上限（所有 dispatch 通用）

> **Iron Law：主線靜默 55 分鐘是上限，不是預算。違反字面就是違反精神——「等通知就好」「醒來也做不了什麼」都不算遵守。**

**Invariant**：session 內只要存在**任何**未收尾的 async work，主線相鄰兩個 assistant turn 的間隔 **NEVER** 超過 55 分鐘。

**適用範圍窮舉**（明寫，不靠外推）：**每一種** async 派工都適用，不是只有長任務——native delegation subagent（含 `/wt` **Form 1–4 全部**）、background process launcher、pi dispatch、`runner.sh`、Monitor、Workflow。

### 派出當下的自查（MUST）

派出 async job 的**同一則訊息**內問一句「這預計超過 55 分鐘嗎？**答不出來 = 會**」，再依下表動作：

| 可觀察 predicate | MUST |
| --- | --- |
| 該路徑**已有**間隔 ≤3300s 的既有 wakeup（pi 的 1500s 安全網、work-loop 的 (d) heartbeat） | 不另外排。但收到完成通知前 **MUST** 持續重排既有那個 |
| 該路徑有 async job 在跑，但沒有既有 wakeup | 立刻排 3300s keepalive；`prompt` **MUST** 使用下方 canonical inert control message，**NEVER** 放原任務輸入或虛構 id |
| 派完主線手上**還有**不依賴該結果的獨立工作 | 先做那些工作（本來就不會靜默）。做完仍在等 → 回上面兩列排 keepalive |
| session 內**沒有**任何未收尾 async job | 不排。keepalive 的觸發條件是「有東西在跑而主線不出聲」，不是「idle」 |

3300s = 55 分，留 5 分餘裕給 1 小時 TTL，落在 runtime 的 `[60, 3600]` clamp 內。

### 模板逐字與 deadline 取值在 [[agent-routing.keepalive-wake]]（具名時機 MUST-Read）

**填 canonical keepalive prompt 的 `task` / `owner` / `deadline` 三個欄位之前，MUST 先讀
[[agent-routing.keepalive-wake]] § 派出當下的模板與 deadline**——沒讀到就沒有 inert control
message 的逐字形狀（虛構 task id 是實測最常見的失敗）、沒有 deadline 一律往晚取的三列取值表、
也沒有 `/loop` dynamic 這唯一的 prompt-preserving 例外。

**收到 keepalive wakeup 的那個 turn、以及 permission classifier 要求具名 shared-action consent 的
那一刻**，同一份檔的 § Generic keepalive 醒來只做控制面動作 與 § Shared-action specific consent UX
是那兩個時刻的 MUST-Read，**此處不複述**。

### Red Flags（發現自己在想這些 = 停下來排 keepalive）

「等通知就好」／「醒來也做不了什麼」／「輪詢沒意義所以不用醒」／「這次應該很快」／「先結束這回合，有消息再說」。

## 為什麼集中寫在這

見 rationale 同名 §（含 consumer 投影 `🔒 LOCKED`／**禁止**本地 override）。

## 必禁事項

> **入表判準**（往本節加行之前先讀）：見 rationale § 必禁事項的入表判準。

### Dispatch 入口

| NEVER | 說明 |
| --- | --- |
| **NEVER** 印「請開啟Codex CLI」「Stop here」「請貼prompt」這類純文字handoff訊息要使用者手動切 | 主線必須自己以背景dispatcher派Pi模型 |
| **已 route 給 Pi 的工作，NEVER** 直接執行 `codex` binary（含 `codex exec`／`codex review`／`codex exec resume`）代替 dispatcher，或把它當 Pi 故障 fallback | 該工作沿用 `vendor/scripts/pi-dispatch.ts` 或專用 Pi wrapper 的 admission、receipt 與 fallback。原生 Codex session、已授權 native subagent 與明確要求的 Codex 產品驗證，由 target adapter 依各自 scope 和本次 tool schema 執行；模型名字本身不決定 transport。 |
| **NEVER** 嘗試`codex:rescue`／`codex:setup`plugin路線 | 已驗證無法使用、已全清（含`/assign`） |
| **NEVER** 把 UI view phase 派給未具該項視覺品質資格的 executor，或以 Pi 機械列／一般 native delegation 代替 qualified bounded phase | UI 的 residency 與資格判定見 § Runtime residency and native transport；非 view phase 的 dispatch prompt 仍 MUST 含「禁止改 view 層檔案」硬指令，缺這條 runtime 容易順手改到 .vue / .tsx |
| **NEVER** 讓 Claude subagent 當 pi 的**薄中介**——派出 pi 卻不自跑 Pi Watch Protocol，把死活判定留給上一層 | 判準是**誰持有 pi 的生命週期**，不是「有沒有經過 subagent」。薄中介的兩個已驗證失敗模式見 rationale（同 §）。完整持有生命週期的形狀見下一列 |
| **NEVER** 在 exploration / research 型 session 自己逐檔 Read + scan 多個 source（openspec / HANDOFF / git log / docs）超過 3 個 source file | 先依 `read-heavy-scan`／`exploration-prescan` 具名列派 Pi pre-scan 拿 structured summary，再由主線消費 summary 做判斷。例外：user 明確問特定檔案 / 需要 claude.ai-connected MCP |
| **NEVER** 把 target-native subtask catalog 的 `model` 當成跨 runtime model qualification | Runtime residency 與 target adapter 的 native transport fragment 共同決定合法 carrier。其他 model 只走已驗證的跨 runtime carrier；缺 carrier 就 blocked。 |

**派 pi 寫 code、派 spectra-apply phase、或收 `verify:ui` evidence 之前，MUST 先讀 [[agent-routing.pi-watch-protocol]] § Dispatch 入口禁令（下推四列）**——Commit Authorization 段、Plan-first 硬指令、`verify:ui` 唯一入口與它的機械 backstop、以及「pi MUST 由該層編排者自己派」那條的准入與範圍界線，都在那裡，**此處不複述**。

### Watch 行為的禁令表在 [[agent-routing.pi-watch-protocol]]（具名時機 MUST-Read）

**派出 pi 之後、進入監看期之前，MUST 先讀 [[agent-routing.pi-watch-protocol]] § Watch 行為禁令**
——八條逐字禁令（沉默等使用者問進度／不啟動 Watch Protocol／偵測到 `fetch failed` 仍續排 wakeup／
watch loop 內夾帶無關工作／propose 後跳過 cross-check／完工後跳過 view-layer drift 檢查／
對直接派的 pi 每 3 分鐘強制 poll／現場自組 `pgrep` 當進度探針）都在那裡，**此處不複述**。

### Commit 0-A

commit 0-A 的四條 dispatch 禁令（simplify 與 pi 不並行、不啟用已棄用的 `code-review` Opus subagent、不跑第 3 輪 pi、不用 native delegation 包一層跑 simplify）全文在 commit skill 的 `gates.md` § 0-A —— **跑 0-A 之前 MUST 先讀那一節**。

### Runtime gate

`[DELEGATED-BY-CLAUDE-CODE]` marker 的兩條禁令（Pi 端無 marker 立即 STOP／主線派 spectra apply phase 時 prompt 第一行必須是 marker）全文在 reference § Runtime Gate —— **派 spectra apply phase 之前 MUST 先讀那一節**。

另：**NEVER** 把 routing 例外寫死在個別 skill；要加例外請改本檔的 Routing Table。
