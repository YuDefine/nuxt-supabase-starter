---
description: dispatch 執行期的全文——已決定派工之後的 brief 範圍判定（§ 派多少）、plan mode 可派／不可派的逐列名單、配額耗盡時 dispatcher payload 算不出來的三條判斷、以及所有 dispatch 通用的 4-status 回報契約與「report 是未驗證主張」核實紀律。派不派／派給誰／Routing Table／主線靜默上限這些**判定入口**留在 [[agent-routing]]，本檔只承載執行期條文。**單純「要派工」不會自動載入本檔**：決定把工作交出去、寫出任何一份 brief 之前，MUST 依 [[agent-routing]] § 派工執行期 的強制指針主動 Read；改 pi dispatcher／routing gate 或 agent 定義檔時 path-scoped 載入
paths:
  [
    'rules/core/agent-routing.md',
    '.claude/rules/agent-routing.md',
    'vendor/scripts/pi-dispatch.ts',
    'vendor/scripts/pi-routing-policy.ts',
    'vendor/scripts/pi-routing-gate.ts',
    '.claude/agents/**',
  ]
---
<!-- Clade native rule; source: rules/core/agent-routing.dispatch-execution.md; edit canonical source -->

<!-- clade-targets: claude,codex,cursor -->

# Agent Routing — dispatch 執行期（brief 範圍・plan mode・配額鏈・回報契約）

> 本檔是 [[agent-routing]] 下推的**執行期全文**。判定入口（§ 派不派、§ Routing Table、§ 主線靜默上限、
> § 停下來要人做之前）留在主檔，本檔 **NEVER** 複述它們。
>
> **本檔的觸發是具名時機，不是編輯檔案順帶載入**：`paths:` 只綁 pi dispatcher／routing gate 的 script
> 與 agent 定義檔。2026-09-09 實測本檔 glob 的 session 命中率為 clade 6.4%（126/1965）／
> <consumer-i> 2.9%（8/273）／<consumer-b> 11.4%（78/683）——**靠 auto-load 會讀不到**，主檔
> § 派工執行期 的強制指針才是主要入口。重跑法：把本檔的 `paths:` 陣列寫成一份 probe sidecar 的
> `{"probes":{"agent-routing.md":{"path":[…]}}}`，再跑
> `node scripts/audit-rule-paths.ts --self --json --probes <sidecar>` 讀 `always-load` 列的
> `hitSessions / observedSessions`（consumer 側改 `--repo <path>`）。

## 派多少（決定派之後的第二題）

[[agent-routing]] § 派不派 決定**派不派**，本節決定**一份 brief 裝多少**。已決定把某件工作交出去（user 指示或命中外派條件）時，MUST 接著判 brief 的範圍：

1. **列出剩餘工作中，開工需要讀被派工作產出的每一環**（判法同 edge 判定：「B 開工需要 A 的產出嗎」）。這些環與被派工作構成一條**串行鏈**。
2. **對鏈上每一環問：它需要什麼是寫不進 brief 的？** 可觀察判準：該環需要的每一個事實（值、證據、驗收步驟、已排除假說）都寫得進 brief → 不需要主線。命中 [[agent-routing]] § 派不派 的「不外派」清單（定稿措辭 / 主線已符合具名 UI 列資格 / 不可逆動作需 user 拍板 / 本 session 專屬 gate）的環才是**合法切點**。
3. **預設把整條鏈寫進同一份 brief 交給同一個受派者**。要切在鏈中間，MUST 能具名指出：留下的第一環是哪一環、它需要主線或 user 的什麼。講不出來 = 沒有留的理由 = 整條交出去（鏡像 [[agent-routing]] § 派不派 的 Iron Law「講不出命中哪一條就自己做」）。
4. 切點若是「需 user 拍板」的環，考慮把**拍板問題本身**也寫進 brief 讓受派者到點回報，而不是主線閒置守在那一環前面。

**Red flag**：發現自己在 brief 裡寫「不要做 X，X 由主線處理」，當場問一句「主線做 X 需要什麼 worker 沒有的東西」。答不出具體事實 = 慣性佔位，刪掉那句、把 X 寫進 brief。

**本節 NEVER 產生新的派工**——它只調整一次已授權派工的 brief 範圍，**受派者數量不變、冷載次數不變**，因此套不上過度外派的成本模型。反而是切在鏈中間才製造第二次交接（回報 → 主線續跑 → 可能再派），更接近過度外派的形狀。

**範圍嚴格限定在與被派工作有資料依賴的串行鏈**——無關的平行工作回歸 [[agent-routing]] § 派不派 逐項判，**NEVER** 讀成「派工時把所有剩餘工作都塞進 brief」。

**中切不是禁止，是需具名理由**：鏈中間真有需要 user gate 或主線 context 的環時，切在那環之前正是對的。

> 既有的三處特例是本節的實例，不取代本節：`handoff/relay-steps.md` §0 與 `session-tasks.operations.md` § 派幾個 pane（兩者都框在「serial 工作 NEVER 拆給 N 個 worker」），以及 `handoff/dispatch-common.md` § 2 的 brief 範圍檢查點。**它們防的是「拆給 N 個 worker」，本節多防一種形狀：切成「worker ＋ 主線自己」**——那種切法在既有條文的字面下不會 fire，因為沒有第二個 worker。

## Plan mode 期間的派工邊界

Plan mode 的契約是「不對 repo 做任何改動」。Pi dispatch 的 ledger（`~/.pi/agent/clade/dispatch-ledger.jsonl`）與 prompt 持久化（`~/.pi/agent/clade/dispatch-prompts/`）寫在 **homedir**，不是 repo working tree，**不違反** plan mode 的 no-mutation 契約。

- **Plan mode 期間可派的 Routing Table 列**：`read-heavy-scan`、`mechanical-fanout`（read-only profile）、`screenshot-match-analysis`、`notion-ops`（read-only：scan／query）——這些列的工作不寫 working tree。
- **Plan mode 期間不可派的列**：`ui-implementation`、`nuxt-core-implementation`、`ui-view-implementation`、`commit-0c-fix-verify`（含 escalate）、`notion-ops` 的 create／patch（遠端副作用，即使不寫 repo）——這些列的產物是 repo 內的 code change 或遠端 mutation，plan mode 下不應執行。
- **NEVER** 因為「plan mode 不該有副作用」就把 read-only 的派工也退回主線自己做——那把 routing table 標明應派工的量體全堆回 Opus 主線，正是 TD-507 要修的行為。

**Claude subagent 在 plan mode 的 gate 行為（TD-631）**：plan mode 禁止寫檔，而 routing gate 的
`[dispatch]` 補救要先落 brief 檔——那條路徑在 plan mode 結構上不可執行。`pi-routing-gate.ts` 自
`096ad5ea1` 起讀 `permission_mode`：plan mode 的 `Explore` / `Plan` dispatch 直接放行不 mint
decision，其餘 `subagent_type` 照常 arm，block 訊息指名唯一可跑的
`[waive] --reason plan-mode-readonly`。放行**不**解除既有 latch。**NEVER** 為了走 `[dispatch]`
而在 plan mode 寫 brief 檔繞過 harness，**也 NEVER** 把該 latch 回報成 deadlock。

## 配額邊界（決策層）

Pi `openai-codex`目前不提供authoritative pre-dispatch quota snapshot。Dispatcher的quota precheck固定回`available:false`並fail-open；舊`~/.codex/sessions/**/rate_limits`只代表legacy Codex CLI歷史，**NEVER**拿它阻擋或宣稱Pi現況。

- Pi runtime回usage／rate-limit／quota error → dispatcher exit 4，payload帶`detected:'runtime'`與可解析到的`resets_at_human`。
- 沒有reset資訊時不得捏造window長度或時間；直接走 § 配額耗盡時的 fallback 紀律。
- 有明確reset時間且工作確實綁該外部signal時，可回報該時間；這不改變當下先判斷fallback能否完成工作的責任。
- `--no-quota-check`只改回報為`skipped:true`，不會繞過provider runtime quota。

**拿到 codex-primary verdict、要判「這件事小到不必真的 dispatch 嗎」之前，或要動配額鏈 `-cursor` 那一跳之前，MUST 先讀 [[agent-routing.pi-watch-protocol]] § 配額與 residency 的下推兩段**——最小 dispatch 門檻的三條連言與 `trivial-threshold` reason 值、`-cursor` 的兩層機械門檻，都在那裡。

### 配額耗盡時的 fallback 紀律

**執行 SoT 是 dispatcher 自己的 exit 4 payload**：`pi-dispatch.ts` 撞 provider／quota／runtime 不可用時回
`next_tier` / `next_step` / `skipped_tiers`，逐跳鏈（`ROW_CHAINS`／`DELEGATE_SUB_CHAIN`）與鏈尾
（`chainTerminal()`：`dispatch-fallback` subagent 或主線）由它機械算出。**MUST 照那個 payload 派下一跳，
NEVER 憑印象選 model**——記不得鏈長什麼樣不是問題，payload 每次都會印。`--chain-origin` 已是 inert：
每列都有完整的鏈，下一跳是查表不是依 origin 走圖。

本檔只留 payload **算不出來**的判斷：

- **NEVER** 派禁用 model 接手（GPT-6 Astra／Luna、Claude Fable／Sonnet／Haiku、Composer 2.5、Devin Fusion）——鏈上每一跳都在 [[agent-routing.routing-table]] 裡，表外沒有「再試一個」
- **Sol 列的鏈尾是主線**：GPT-6 Sol 不可用時主線（Claude Opus 5.5（effort: medium））自己做；**NEVER** 把 cx 或 Claude Code＋GPT 當實作接手者。品質失敗不前進鏈：delegate-sub 的 Grok 產出不合格升一次 Sol xhigh，Sol 不合格回主線。
- **NEVER** 拿 `--effort low` 重試當配額應對——配額按 **model** 記，同一個 model 撞的是同一個 limit
- **輸出本身就是 gate 的工作，鏈的終點 NEVER 是主線自審**。判準見
  `vendor/scripts/pi-routing-policy.ts` 的 `GATE_OUTPUT_ROWS`（`code-review-opus`）——那一組與 [[agent-routing]]（Claude fragment）§ NEVER 降檔的形狀 第一條同源，**MUST 一起改**
  ——「下游機械消費」是同節的**另一**條（結構化輸出不構成降檔理由），不是 `GATE_OUTPUT_ROWS` 建模的那條。
  產出 changeset 的主線不能回頭自審；review 席只有 Claude Opus 5.5（effort: medium），額度耗盡時 gate 維持未達成。
  其餘非 gate row 才按各列鏈尾處置。
  **Runtime-specific carrier 例外**：Opus subagent 不得把另一 runtime 的 model catalog 當成本端資格；改走 [[agent-routing]] § Runtime residency and native transport 所指的 target adapter carrier。
- `-cursor` 那一跳先過 workspace capability：`mutation` 一律跳過、`readonly` 才繼續判材料來源與 cwd visibility。材料來源的准入 **MUST 綁在待審材料本身，NEVER 綁在使用者意願**（TD-534）；兩層機械門檻與「NEVER 做成可繞過的形式」全文在下面那條指針指的那一節

鏈的完整形狀、cross-family 跳的准入連言、grok 跳的 `PRECONDITIONS_VERIFIED:` 補償控制，全文在
[[agent-routing.pi-watch-protocol]] § 配額耗盡時的 fallback 紀律 —— **要新增或改動任何一跳之前
MUST 先讀那一節**，本 pointer 不複述。

## Subagent 回報契約（所有 dispatch 通用）

適用範圍：**每一個** dispatch——native delegation 開的 Claude subagent、泛用 dispatcher 派的 pi、`/implement` executor reference（`capabilities/core/references/implement-executor/subagent-dev/`）的 implementer / reviewer，全部適用，不是只有長任務才用。

1. **4-status 回報**：brief 內 MUST 要求 subagent 以四值之一收尾——`DONE`／`DONE_WITH_CONCERNS`（完成但對正確性有疑慮，concerns 必列）／`NEEDS_CONTEXT`（缺資訊，列缺什麼）／`BLOCKED`（做不了，列卡點與已試方法）。主線處置：`DONE_WITH_CONCERNS` → 先讀 concerns 再決定收不收；`NEEDS_CONTEXT` → 補 context 重派；`BLOCKED` → 依序考慮補 context／升 model／拆小／上報 user。**NEVER** 對 BLOCKED 原樣重派同一 model 不改任何條件。
2. **Report 是未驗證主張**：subagent 完成回報（含「no changes outside scope」「tests pass」「已自我 review」）一律當 claim——主線 MUST 用 `git status --short` + `git diff` 核實實際改動範圍 = brief 宣告 scope，scope 外 substantive change 一律 revert。subagent 自報的設計說詞（「per YAGNI 略過」「刻意簡化」）**不得**降級任何 review finding 的嚴重度——那是實作者替自己打分。
   **Cursor 池的核實邊界（TD-520）**：`*-cursor` model 的 dispatch，pi 事件流只回放 builtin 七種工具（read/bash/edit/write/grep/find/ls）∩ pi active tools 的原生執行；**非 builtin 的原生工具（WebFetch、Delete、Cursor 端 Subagent 再派、MCP 呼叫）任何 profile 下都不產 tool_execution 事件**。`git status` / `git diff` 的核實**只覆蓋 worktree 內**——worktree 外副作用（`/tmp`、`$HOME`、網路）**查不到也稽核不了**。因此：會處理 secrets / prod 憑證、或 brief 明定「不得外連」的任務 **NEVER** 走 cursor 池；其餘任務走 cursor 池時，主線 NEVER 把「worktree 核實通過 + events log 乾淨」講成「無 scope 外副作用」——cursor 池的 events log 是單向證據，有痕可信、無痕不表示沒發生。
3. **File handoffs**：brief／report／diff 超過 ~30 行的內容走**檔案路徑**傳遞，不貼進 dispatch prompt 或回報訊息——貼文會常駐主線 context、每 turn 重讀。dispatch prompt 五要素：定位一行、brief 檔路徑、跨 task interfaces、歧義裁決、report 檔路徑＋回報契約（單一事件實錄見 rationale）。
4. **Model 與 effort 顯式指定**：**每一個** dispatch 都 MUST 把 model 與 effort 當成兩個獨立決策，不靠靜默繼承——省略 = 繼承主線（通常最貴檔 × 最深推理），機械掃描型 subagent 拿主線的 xhigh 跑就是效能過剩。選檔預設，依序判：
   - **先過 Routing Table**：非 UI 工作命中 [[agent-routing]] § Routing Table 已 route 給 Pi 的類別 → 依該列的 model / effort 派工（`mechanical-fanout`、`read-heavy-scan`、`notion-ops` 首跳 `gemini high`），**NEVER** 用 Claude subagent 接。唯一不過表的 Claude 載體是 in-process 唯讀**定位**搜尋（找檔／找符號／回結論，不回檔案原文）交 `Explore` subagent：顯式帶 `model: opus`，effort 意圖為 `low`——gate 只驗 model 直接放行，`low` 沒有機械強制，Agent tool 無 effort 欄位時照下方「記錄實際繼承限制」；命中 `mechanical-fanout`／`read-heavy-scan` 的掃描矩陣與固定欄位抽取不因換成 Explore 就免過表。其餘 Claude subagent 只留給 Claude 例外（需 claude.ai-connected 的非 Notion MCP——Notion 一律 `ntn api`，NEVER 走此例外——、判讀／治理型分析、user 明確指定）。Devin SWE-2 Max（effort: max）是任意 Pi 列的可選載體，只限不急、緩慢也不堵塞的任務
   - **UI 實作**：Nuxt 本體用 GPT-6 Sol xhigh，UI view（含 Nuxt UI／Content）用 Opus 5.5（effort: medium），依 [[agent-routing]] § Runtime residency and native transport 的角色與工具判定；**NEVER** 用機械掃描／一般 native delegation 檔位承接 UI phase。原 session 保持 change-level orchestration。
   - **effort 選檔**：effort 跟著 model 走（`TIER_EFFORT`）——GPT-6 Sol 與 Grok 4.7 一律 `xhigh`，Gemini 3.8 Flash 一律 `high`，Claude Opus 5.5 一律 `medium`（鏈尾 `dispatch-fallback` 為 `low`，由 frontmatter 固定）；dispatcher 對不符的 effort exit 1。**帶得了 effort 參數的入口**（pi `--effort` / `-c model_reasoning_effort`、Workflow `agent()` 的 `effort`、具名 agent type 的 frontmatter）**MUST** 顯式帶；native delegation 的 model／effort 欄位以本次 tool schema 為準。schema 有可用欄位時依已選檔位填入；schema 不提供欄位時記錄實際繼承限制，不能宣稱已指定。各 runtime 的欄位與繼承條件見 target adapter
   - model 選檔原則「**turn count beats token price**」：brief 內含完整 code 的純轉錄型工作才用最低檔；review 型依 diff 的大小／風險選檔（為什麼見 rationale）。
5. **中間產物不進主線**：外派出去的 task，主線只讀對方寫回的 report 檔，**NEVER** 為了「確認它做對」把該 task 碰過的原始檔重讀一遍——那把省下來的 context 原封不動加回來，而且重讀的是同一批事實，換不到新判斷。第 2 條的 scope verify 照舊 MUST 跑：看**改了哪些檔**（`git status --short` / `git diff --stat`）跟重讀檔案內容是兩件事。

N ≥ 3 個 dispatch 的 findings 要收斂進同一個 synthesis 時，reducer 的五步形狀、group key 准入表與 guard 表在 `~/offline/clade/vendor/snippets/fan-in-reduction/`。**這不是規約**——micro-test 顯示寫成 MUST 買不到東西，見 rationale § fan-in reducer 量到什麼。

## Cloud session 載體（Claude Code 主線）

Claude Code 的 cloud session（`claude --cloud`）是**載體**，不是派工理由：先依 [[agent-routing]] § 派不派 判定「要開新 session」（覆寫期間只剩長時間 background 或必須隔離），**之後**才選載體。cloud 吃的是與 Opus 急件**同一份** Claude 額度，沒有官方的 cloud 餘額查詢，所以它排在最後：非急件先用 Devin `swe-2-max`（免費、只在 desk，見 [[agent-routing.routing-table]] § Devin SWE-2 Max），cloud 只接 desk 負載已滿、又不急的件。

| 可觀察 predicate | 載體 |
| --- | --- |
| 工作在**單一 GitHub repo** 內做得完、驗收看 PR＋CI、不需要本機 secret／Herdr／pi seat／其他 `~/offline` repo／systemd／實體硬體，該 repo 已 push 的 `.claude/settings.json` 把 `model` 釘在 Opus、`effortLevel` 釘在 ≤ `medium`，而且派出帳號的 `--ref` preflight 判 GitHub App 已安裝（網頁看得到 repo 不算；判定方式見 cookbook） | **cloud 可選**，但只在 desk 負載已滿（load 持續高於核數）而且不急時才選；不急而 desk 還有餘裕 → Devin `swe-2-max`，急件 → Herdr pane |
| 需要跨 repo、本機狀態（dev server、DB lease、未 push 的 commit）、Herdr／pi 派工、或要人即時回答 | Herdr pane（或主線自己做） |
| review、裁決、掃描這類本 turn 收得回來的 bounded 工作 | in-process subagent（上一節不變）；**NEVER** 為它開 cloud |
| commit 0-A | **NEVER** cloud：0-A 只認 `claude-review-safe.sh` 的 subagent carrier |

派出帳號在 cc 與 ccw 之間**選額度寬裕的那個**（讀 `~/.cache/claude-quota/{cc,ccw}.json`，快照過期先 `node scripts/dev-node.ts probe-quota <cc|ccw>`），並以 `dispatch --account cc|ccw` 明確指定；不指定就繼承呼叫端的 `CLAUDE_CONFIG_DIR`。一次最多 1 件在飛。

**MUST** 經 `vendor/scripts/cloud-dispatch.ts dispatch` 派出（或對已在跑的 cloud session 跑 `adopt`）：它拒絕 model 未釘的 repo、把交付契約（固定 `cloud/` branch、draft PR、`Work:` 行）寫進 brief 開頭，並留下 record 與 `substrate: cloud` 的 flow span。**NEVER** 裸跑 `claude --cloud` 派工作——沒有 record 的 cloud session 沒有任何本機巡檢面看得到，派它的 session 一結束它就成了孤兒。裸跑還有第二個代價：不帶 `--ref` 時，只要 checkout 有未 commit 改動，CLI 就改成上傳本機 working tree 起 session——VM 沒有 origin、推不回成果，而且同一棵樹上別的 session 未 commit 的內容也一起送上雲。`dispatch` 一律帶 `--ref <base>`（拿不到 GitHub clone 就直接失敗、不上傳），並拒絕 base 領先 origin 的派出。收割看 GitHub（`herdr-patrol.ts --stalled` 的 CLOUD DISPATCHES 區塊與 `cloud-dispatch.ts patrol`），落地後 `cloud-dispatch.ts harvest` 關 span。brief 的資料邊界同 [[agent-routing.pi-watch-protocol]] § Dispatch 資料邊界：cloud 是另一個 runtime，secret 的值 **NEVER** 進 brief。指令、限制與收割形狀全文在 `vendor/snippets/cloud-dispatch/README.md`。

## Implementation readiness gate（實作派工前）

派出去的是**實作**（brief 宣告 `stage: implement`，或 dispatcher 帶 `--implementation`）且 `CLADE_WORK_ID` 綁到一個 lifecycle package 時，dispatcher **MUST** 先跑 `node vendor/scripts/flow/flow.ts plan readiness <work-id>`；`ready=false` 就拒絕建 pane，findings 逐條指名缺的契約（`spec.md`、acceptance feature、`acceptance_command`、stale `truth_baseline`、undefined／ambiguous step）。缺的東西回到對應 spec owner，**NEVER** 交給 implementer 順手補——implementer 只能改被指派的實作與配套單元測試，acceptance feature、DSL、`spec.md` 在它手上是唯讀；主線收工時跑 `flow plan spec-integrity <work-id> --since <dispatch sha>`，那三類有改動就拒收，**即使它回報的測試全綠**。

**便宜模型的資格是量出來的，不是寫死的。** readiness 通過只代表 package 完整到可以被獨立 context 接手，它**不是**改走更便宜 model 的授權：model 仍照 [[agent-routing]] § Routing Table 與本檔 § 4 選檔。要宣稱某類 task 可交給低成本模型，MUST 有該 task class 的獨立試驗證據（fresh context、無場外指導、獨立 verifier 跑未改動的 acceptance、記 model／effort／attempts／rework／總成本）；試驗失敗回到契約或 routing，**NEVER** 把殘餘交給強模型補完再標成功而不記那次介入。

## Skill invocability gate（brief 指名 skill 前）

brief 叫 pane 呼叫的 skill，可不可呼叫由**目標端投影 SKILL.md 的 frontmatter** 決定（`disable-model-invocation: true` = 叫不動），**NEVER** 由寫 brief 那台看得到、或源檔長什麼樣推論。Herdr dispatch（新建、relay、`--continue`）在建 pane 前對 Claude child 自動判定，命中回 `skill_not_invocable`；不經 Herdr 的 brief 跑 `node vendor/scripts/brief-skill-check.ts --cwd <target> <brief>`（exit 1 = 紅）。指名看**形式**不看語意：`/<skill>` 或 `Skill(<skill>)` 一律算指名，周圍寫了 NEVER／由 Charles 也一樣；只是**提到**就寫裸名（`version-upgrade`，不加斜線）。**NEVER** 為了讓禁止句過關加散文豁免——2026-09-23 0-A 七輪每輪都找到新的 fail-open 句型。已知限制：裸名寫成的指令（「invoke the dep-upgrade skill」）不在攔截範圍，由寫 brief 的人負責；判定只掃 `<target>/.claude/skills` 與 launcher 的 user-level skills，不掃 plugin skills。readonly gate-review 列（`--table-row` 屬 code-review 類）不判：它的 prompt 內嵌被審 diff，是引用不是指令。

被擋的工作只有人做得了：把「哪一台、跑哪個範圍」用 `flow ask` 開成拍板題、執行寫成 `--step`，**NEVER** 改寫成「請 user 執行」再派同一個 pane、**NEVER** 叫 pane 讀 skill 內文自己照跑（拒絕訊息逐字寫 `Do not replicate this skill workflow by other means`）。

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | brief 以指名形式叫 Claude child 呼叫目標端 `disable-model-invocation: true` 的 skill → Herdr dispatch exit 15 `skill_not_invocable`，零 pane、零 record；CLI exit 1 |
| 消費端 | 正在派工的主線（拒絕訊息附 `flow ask` 範本）；`\my`／`/decisions` 承接改開的拍板題 |
| 載入路徑 | 本節（決定派工、寫 brief 前 MUST Read 本檔）；判定式在 `vendor/scripts/lib/brief-skill-invocability.ts` |

## 必禁事項 — Dispatch 入口（原在 `agent-routing.md` § 必禁事項）

| NEVER | 說明 |
| --- | --- |
| **NEVER** 印「請開啟Codex CLI」「Stop here」「請貼prompt」這類純文字handoff訊息要使用者手動切 | 主線必須自己以背景dispatcher派Pi模型 |
| **已 route 給 Pi 的工作，NEVER** 直接執行 `codex` binary（含 `codex exec`／`codex review`／`codex exec resume`）代替 dispatcher，或把它當 Pi 故障 fallback | 該工作沿用 `vendor/scripts/pi-dispatch.ts` 或專用 Pi wrapper 的 admission、receipt 與 fallback。原生 Codex session、已授權 native subagent 與明確要求的 Codex 產品驗證，由 target adapter 依各自 scope 和本次 tool schema 執行；模型名字本身不決定 transport。 |
| **NEVER** 嘗試`codex:rescue`／`codex:setup`plugin路線 | 已驗證無法使用、已全清（含`/assign`） |
| **NEVER** 把 UI view phase 派給未具該項視覺品質資格的 executor，或以 Pi 機械列／一般 native delegation 代替 qualified bounded phase | UI 的 residency 與資格判定見 § Runtime residency and native transport；非 view phase 的 dispatch prompt 仍 MUST 含「禁止改 view 層檔案」硬指令，缺這條 runtime 容易順手改到 .vue / .tsx |
| **NEVER** 讓 Claude subagent 當 pi 的**薄中介**——派出 pi 卻不自跑 Pi Watch Protocol，把死活判定留給上一層 | 判準是**誰持有 pi 的生命週期**，不是「有沒有經過 subagent」。薄中介的兩個已驗證失敗模式見 rationale（同 §）。完整持有生命週期的形狀見下一列 |
| **NEVER** 在 exploration / research 型 session 自己逐檔 Read + scan 多個 source（openspec / HANDOFF / git log / docs）超過 3 個 source file | 先依 `read-heavy-scan` 具名列派 Pi pre-scan 拿 structured summary，再由主線消費 summary 做判斷。例外：user 明確問特定檔案 / 需要 claude.ai-connected MCP |
| **NEVER** 把 target-native subtask catalog 的 `model` 當成跨 runtime model qualification | Runtime residency 與 target adapter 的 native transport fragment 共同決定合法 carrier。其他 model 只走已驗證的跨 runtime carrier；缺 carrier 就 blocked。 |
