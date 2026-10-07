---
description: dispatch 執行期的全文——已決定派工之後的 brief 範圍判定（§ 派多少）、plan mode 可派／不可派的逐列名單、配額耗盡時 dispatcher payload 算不出來的三條判斷、檔位永不降檔的形狀列舉（§ NEVER 降檔的形狀）、以及所有 dispatch 通用的 4-status 回報契約與「report 是未驗證主張」核實紀律。派不派／派給誰／主線靜默上限這些**判定入口**留在 [[agent-routing]]（對照表在 [[agent-routing.routing-table]]），本檔只承載執行期條文。**單純「要派工」不會自動載入本檔**：決定把工作交出去、寫出任何一份 brief 之前，MUST 依 [[agent-routing]] § 必禁事項 的強制指針主動 Read；改 pi dispatcher／routing gate 或 agent 定義檔時 path-scoped 載入
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

<!-- clade-targets: claude,codex -->

# Agent Routing — dispatch 執行期（brief 範圍・plan mode・配額鏈・回報契約）

> 本檔是 [[agent-routing]] 下推的**執行期全文**。判定入口（§ 派不派、§ 主線靜默上限、
> § 停下來要人做之前）留在主檔，對照表在 [[agent-routing.routing-table]]，本檔 **NEVER** 複述它們。
>
> **本檔的觸發是具名時機，不是編輯檔案順帶載入**：`paths:` 只綁 pi dispatcher／routing gate 的 script
> 與 agent 定義檔。2026-09-09 實測本檔 glob 的 session 命中率為 clade 6.4%（126/1965）／
> <consumer-1> 2.9%（8/273）／<consumer-2> 11.4%（78/683）——**靠 auto-load 會讀不到**，主檔
> § 必禁事項 的強制指針才是主要入口。重跑法：把本檔的 `paths:` 陣列寫成一份 probe sidecar 的
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

- **Plan mode 期間可派的 Routing Table 列**：`code-locate`、`read-heavy-scan`、`mechanical-fanout`（read-only profile）、`screenshot-match-analysis`、`notion-ops`（read-only：scan／query）——這些列的工作不寫 working tree。
- **Plan mode 期間不可派的列**：`ui-implementation`、`nuxt-core-implementation`、`ui-view-implementation`、`commit-0c-fix-verify`（含 escalate）、`notion-ops` 的 create／patch（遠端副作用，即使不寫 repo）——這些列的產物是 repo 內的 code change 或遠端 mutation，plan mode 下不應執行。
- **NEVER** 因為「plan mode 不該有副作用」就把 read-only 的派工也退回主線自己做——那把 routing table 標明應派工的量體全堆回 Opus 主線，正是 TD-507 要修的行為。

**Claude subagent 在 plan mode 的 gate 行為（TD-631）**：plan mode 禁止寫檔，而 routing gate 的
`[dispatch]` 補救要先落 brief 檔——那條路徑在 plan mode 結構上不可執行。`pi-routing-gate.ts` 自
`096ad5ea1` 起讀 `permission_mode`：plan mode 的 `Plan` dispatch 直接放行不 mint decision，其餘
`subagent_type` 照常 arm，block 訊息指名唯一可跑的 `[waive] --reason plan-mode-readonly`。放行**不**
解除既有 latch。`Explore` 自 2026-09-28 起不再放行（任何 mode）：gate 自己把 `prompt` 落成 brief
（`~/.claude/clade-routing-gate/briefs/`，homedir，理由同上方 Pi ledger），所以 `code-locate` 的
`[dispatch]` 在 plan mode 也可逐字照跑。**NEVER** 為了走 `[dispatch]`
而在 plan mode 寫 brief 檔繞過 harness，**也 NEVER** 把該 latch 回報成 deadlock。

## 配額邊界（決策層）

Pi 的 GPT tier（`openai-codex`）已退場（2026-09-29）；舊`~/.codex/sessions/**/rate_limits`只代表legacy Codex CLI歷史，**NEVER**拿它阻擋或宣稱Pi現況。

- Pi runtime回usage／rate-limit／quota error → dispatcher exit 4，payload帶`detected:'runtime'`與可解析到的`resets_at_human`。
- 沒有reset資訊時不得捏造window長度或時間；直接走 § 配額耗盡時的 fallback 紀律。
- 有明確reset時間且工作確實綁該外部signal時，可回報該時間；這不改變當下先判斷fallback能否完成工作的責任。
- `--no-quota-check`只改回報為`skipped:true`，不會繞過provider runtime quota。

**拿到 codex-primary verdict、要判「這件事小到不必真的 dispatch 嗎」之前，MUST 先讀 [[agent-routing.pi-watch-protocol]] § 配額與 residency 的下推**——最小 dispatch 門檻的三條連言與 `trivial-threshold` reason 值都在那裡。

### 配額耗盡時的 fallback 紀律

**執行 SoT 是 dispatcher 自己的 exit 4 payload**：`pi-dispatch.ts` 撞 provider／quota／runtime 不可用時回
`next_tier` / `next_step`，逐跳鏈（`ROW_CHAINS`／`DELEGATE_SUB_CHAIN`）與鏈尾
（`chainTerminal()`：`dispatch-fallback` subagent 或主線）由它機械算出。**MUST 照那個 payload 派下一跳，
NEVER 憑印象選 model**——記不得鏈長什麼樣不是問題，payload 每次都會印。`--chain-origin` 已是 inert：
每列都有完整的鏈，下一跳是查表不是依 origin 走圖。

本檔只留 payload **算不出來**的判斷：

- **NEVER** 派禁用 model 接手（所有 GPT（含 Astra）、Claude Fable／Haiku、Sonnet 5 以下、Composer 2.5、Devin Fusion；Sonnet 5.5 只坐表列它的位置）——鏈上每一跳都在 [[agent-routing.routing-table]] 裡，表外沒有「再試一個」
- **Sonnet 列與 decision／planning 列的鏈尾是主線**：該 Claude 席位不可用時主線（Claude Opus 5.5（effort: medium））自己做；**NEVER** 把 cx 或任何 GPT 當接手者。品質失敗不前進鏈：delegate-sub 的 Grok 產出不合格升一次 `sonnet-implementer`（Sonnet 5.5（effort: high）），仍不合格回主線；Sonnet 列的品質失敗照 [[agent-routing.routing-table]] § Sonnet 列品質失敗 處置。
- **NEVER** 拿 `--effort low` 重試當配額應對——配額按 **model** 記，同一個 model 撞的是同一個 limit
- **輸出本身就是 gate 的工作，鏈的終點 NEVER 是主線自審**。判準見
  `vendor/scripts/pi-routing-policy.ts` 的 `GATE_OUTPUT_ROWS`（`code-review-opus`）——那一組與本檔 § NEVER 降檔的形狀 第一條同源，**MUST 一起改**
  ——「下游機械消費」是同節的**另一**條（結構化輸出不構成降檔理由），不是 `GATE_OUTPUT_ROWS` 建模的那條。
  產出 changeset 的主線不能回頭自審；review 席只有 Claude Opus 5.5（effort: medium），額度耗盡時 gate 維持未達成。
  其餘非 gate row 才按各列鏈尾處置。
  **Runtime-specific carrier 例外**：Opus subagent 不得把另一 runtime 的 model catalog 當成本端資格；改走 [[agent-routing]] § Runtime residency and native transport 所指的 target adapter carrier。

鏈的完整形狀、cross-family 跳的准入連言、grok 跳的 `PRECONDITIONS_VERIFIED:` 補償控制，全文在
[[agent-routing.pi-watch-protocol]] § 配額耗盡時的 fallback 紀律 —— **要新增或改動任何一跳之前
MUST 先讀那一節**，本 pointer 不複述。

## NEVER 降檔的形狀

- 輸出**本身**就是品質或安全 gate（review / 裁決 / 安全判定）
- 需要跨檔調解矛盾證據，或需要判斷「哪些 evidence 相關」
- 產出是**規約措辭**（理由見 `docs/rule-rationale/agent-routing.md` § 措辭為什麼外包不了）
- 輸出格式結構化**不構成**降檔理由：判準是下游有沒有語意 gate。同一條界線在
  [[agent-routing.routing-table]] § Routing 硬禁令 已寫成 NEVER 行，本節適用同一條，
  **NEVER** 在這裡另立一套寬鬆版

## Subagent 回報契約（所有 dispatch 通用）

適用範圍：**每一個** dispatch——native delegation 開的 Claude subagent、泛用 dispatcher 派的 pi、`/implement` executor reference（`capabilities/core/references/implement-executor/subagent-dev/`）的 implementer / reviewer，全部適用，不是只有長任務才用。

1. **4-status 回報**：brief 內 MUST 要求 subagent 以四值之一收尾——`DONE`／`DONE_WITH_CONCERNS`（完成但對正確性有疑慮，concerns 必列）／`NEEDS_CONTEXT`（缺資訊，列缺什麼）／`BLOCKED`（做不了，列卡點與已試方法）。主線處置：`DONE_WITH_CONCERNS` → 先讀 concerns 再決定收不收；`NEEDS_CONTEXT` → 補 context 重派；`BLOCKED` → 依序考慮補 context／升 model／拆小／上報 user。**NEVER** 對 BLOCKED 原樣重派同一 model 不改任何條件。
2. **Report 是未驗證主張**：subagent 完成回報（含「no changes outside scope」「tests pass」「已自我 review」）一律當 claim——主線 MUST 用 `git status --short` + `git diff` 核實實際改動範圍 = brief 宣告 scope，scope 外 substantive change 一律 revert。subagent 自報的設計說詞（「per YAGNI 略過」「刻意簡化」）**不得**降級任何 review finding 的嚴重度——那是實作者替自己打分。
3. **File handoffs**：brief／report／diff 超過 ~30 行的內容走**檔案路徑**傳遞，不貼進 dispatch prompt 或回報訊息——貼文會常駐主線 context、每 turn 重讀。dispatch prompt 五要素：定位一行、brief 檔路徑、跨 task interfaces、歧義裁決、report 檔路徑＋回報契約（單一事件實錄見 rationale）。
4. **Model 與 effort 顯式指定**：**每一個** dispatch 都 MUST 把 model 與 effort 當成兩個獨立決策，不靠靜默繼承——省略 = 繼承主線（通常最貴檔 × 最深推理），機械掃描型 subagent 拿主線的 xhigh 跑就是效能過剩。選檔預設，依序判：
   - **先過 Routing Table**：非 UI 工作命中 [[agent-routing.routing-table]] § 工作類別對照 已 route 給 Pi 的類別 → 依該列的 model / effort 派工（`mechanical-fanout`、`read-heavy-scan`、`notion-ops` 首跳 `gemini high`），**NEVER** 用 Claude subagent 接 Pi 列（Routing Table 本身列明 native Claude 的列——Sonnet 四列走 `sonnet-implementer`、decision／planning 走 Opus——不在此限）。唯讀**定位**搜尋（找檔／找符號／回 `file:line` ＋結論，不回檔案原文）走 `code-locate` 列，**NEVER** 派 `Explore` subagent——gate 在任何 model、任何 mode 都攔它，並印出可照跑的 `--table-row code-locate` 指令。其餘 Claude subagent 只留給 Claude 例外（需 claude.ai-connected 的非 Notion MCP——Notion 一律 `ntn api`，NEVER 走此例外——、判讀／治理型分析、user 明確指定）。Devin SWE-2 Max（effort: max）是任意 Pi 列與 Sonnet／decision／planning 六列的可選載體（不預設；Sonnet 四列預設 Claude Sonnet 5.5（effort: high）），只限不急、緩慢也不堵塞的任務；各載體怎麼混搭見本檔 § Cloud session 載體
   - **UI 實作**：Nuxt 本體用 Claude Sonnet 5.5（effort: high），UI view（含 Nuxt UI／Content）用 Opus 5.5（effort: medium），依 [[agent-routing]] § Runtime residency and native transport 的角色與工具判定；**NEVER** 用機械掃描／一般 native delegation 檔位承接 UI phase。原 session 保持 change-level orchestration。
   - **effort 選檔**：effort 跟著 model 走（`TIER_EFFORT`）——Grok 4.7 一律 `xhigh`，Gemini 3.8 Flash 一律 `high`，Claude Sonnet 5.5 一律 `high`，Claude Opus 5.5 預設 `medium`（鏈尾 `dispatch-fallback` 為 `low`，由 frontmatter 固定）；同一問題已在 `medium` 失敗一次或修法只修到一層、且有可跑的檢查時，才可 `--tier-basis stall-escalation --retry-of <label>` 開 `high`（只限 Claude launcher，見 [[agent-routing.routing-table]]），`max` 永不開；dispatcher 對不符的 effort exit 1。**帶得了 effort 參數的入口**（pi `--effort` / `-c model_reasoning_effort`、Workflow `agent()` 的 `effort`、具名 agent type 的 frontmatter）**MUST** 顯式帶；native delegation 的 model／effort 欄位以本次 tool schema 為準。schema 有可用欄位時依已選檔位填入；schema 不提供欄位時記錄實際繼承限制，不能宣稱已指定。各 runtime 的欄位與繼承條件見 target adapter
   - model 選檔原則「**turn count beats token price**」：brief 內含完整 code 的純轉錄型工作才用最低檔；review 型依 diff 的大小／風險選檔（為什麼見 rationale）。
5. **中間產物不進主線**：外派出去的 task，主線只讀對方寫回的 report 檔，**NEVER** 為了「確認它做對」把該 task 碰過的原始檔重讀一遍——那把省下來的 context 原封不動加回來，而且重讀的是同一批事實，換不到新判斷。第 2 條的 scope verify 照舊 MUST 跑：看**改了哪些檔**（`git status --short` / `git diff --stat`）跟重讀檔案內容是兩件事。

N ≥ 3 個 dispatch 的 findings 要收斂進同一個 synthesis 時，reducer 的五步形狀、group key 准入表與 guard 表在 `~/offline/clade/vendor/snippets/fan-in-reduction/`。**這不是規約**——micro-test 顯示寫成 MUST 買不到東西，見 rationale § fan-in reducer 量到什麼。

## Cloud session 載體（Claude Code 主線）

Claude Code 的 cloud session（`claude --cloud`）是**載體**，不是派工理由：先依 [[agent-routing]] § 派不派 判定「要開新 session」（覆寫期間只剩長時間 background 或必須隔離），**之後**才選載體。三種載體卸掉的東西不同，選載體就是在分配這些資源：

| 載體 | 省什麼 | 負載落在哪 |
| --- | --- | --- |
| cloud session | 開發機 CPU（唯一真正卸掉本機負載的載體） | Anthropic VM；先扣派出帳號（cc1／cc2／cc3）的 cloud credit，扣完改扣該帳號的訂閱 `seven_day`／`five_hour` 窗（Charles 2026-10-06） |
| Devin `swe-2-max` | Claude 額度（免費） | 派出的那台開發機：工具指令在本機跑 |
| Pi（Grok 4.7、Gemini Flash） | 不省 | 派出的那台開發機 |

**每輪就緒工作一次平行混搭派完**，逐件照下表由上往下判（第一列先攔下短任務），不排「先 A 用完才輪 B」的序：

| 可觀察 predicate（先查 [[agent-routing.routing-table]] 列定 model 家族） | 載體 |
| --- | --- |
| 本 turn 收得回來的 bounded 工作——review、裁決、定位搜尋，也含短的實作／改檔（Claude-only 列，含 `dotclaude-authoring`；Pi 列照下方 Pi 列判） | in-process subagent（判準見 [[agent-routing]] § Dispatch data and transport boundary）；**NEVER** 為它開 cloud 或 Herdr pane |
| 任何 Claude 列（Sonnet 四列、UI／設計類四列 `ui-view-implementation`／`design-review`／`ui-detailed-planning`／`screenshot-match-analysis`、`dotclaude-authoring`、`implementation-decision`／`detailed-planning`），內容符合下方「適合 cloud」且 cloud admission 放行 | **cloud**（預設；急件與非急件同一個判準）。走不走 cloud 看**內容**適不適合在 cloud 做完，**不看**該列用哪個 model（Charles 2026-10-06）；model／effort 照該列，由 `cloud-dispatch.ts` 逐件帶 `--model`／`--effort`（Sonnet 列 `claude-sonnet-5-5 high`、其餘 `claude-opus-5-5 medium`） |
| 上一列的件不符合「適合 cloud」、或 cloud 派不出，且屬 handoff 級／長時間／需隔離環境 | 載體偏好 cloud（卸 CPU）＞ Devin ＞ 本機 pane：Devin 適用列的非急件先補 Devin `swe-2-max`（desk，或已 `devin auth status` 登入的 zenbook），其餘走本機 `cc` Herdr pane（Sonnet 列 `--model claude-sonnet-5-5 --effort high`，其餘 Claude Opus 5.5（effort: medium）） |
| `--tier-basis delegate-sub` | 經 `pi-dispatch.ts` admission，Grok 4.7 xhigh（照 [[agent-routing.routing-table]] § delegate-sub） |
| Routing Table 首跳是 Gemini／Grok 的任何 Pi 列 | 經 `pi-dispatch.ts` admission，照原列的 model、effort、pool 與 fallback 鏈派送；不得改派 Devin 或其他 pane 跳過首跳 |
| Sonnet 四列（`non-ui-implementation`／`nuxt-core-implementation`／`commit-0c-fix-verify`／`version-upgrade-first-pass`）本 turn 收得回的件 | in-process `sonnet-implementer`（Claude Sonnet 5.5，effort: high）；handoff 級／長時間的照上方 cloud ＞ Devin ＞ 本機 pane |
| PR 0-A 修補（`pr-0a-fix`）、rebase 與其他要推回既有 PR branch 的修補，該 PR 是某筆 `cloud-dispatch.ts` record 的 branch 開的，且 `followup` 沒拒送 | 交回**原** cloud session：`cloud-dispatch.ts followup <cloud_id> --pr <N> --reason pr-0a-fix --message-file <findings>`。`idle`、VM 已回收的 session 都推得回同一個 PR，rebase 後 `--force-with-lease` 推自己的 branch 也成立（2026-10-07 實測，證據在 cookbook）。`followup` 拒送（session 已 archive、已收割、已 handover、claude.ai 查無、`--pr` 不是這筆 record 的 PR）、送出 45 分鐘（`FOLLOWUP_STALE_MINUTES`）PR 仍沒有新 commit、或同一張 PR 已送滿 2 輪（`FOLLOWUP_MAX_PER_PR`）→ 先 `cloud-dispatch.ts handover <cloud_id> --pr <N> --reason …` 再退本機 pane：handover 確認 session 不在 running 才寫入，exit 2 就不退（cloud session 准 `--force-with-lease`，兩邊會在同一個 branch 競推），寫入後 `followup` 一律拒送。主持者自動加派以載體 `cloud-followup` 照這列走 |
| 其他要推回既有 PR branch 的修補（本機 pane 開的 PR、別筆 record 的 PR、上一列退下來的） | **NEVER** 新開 cloud session：它的 credential 只推得了自己的 working branch；走本機 pane |
| commit 0-A | **NEVER** cloud：0-A 只認 `claude-review-safe.sh` 的 subagent carrier |

**適合 cloud** 要硬條件全中、工作形狀也對：

- **硬條件**（缺一就不能派，`cloud-dispatch.ts` 會擋其中幾條）：工作在**單一 GitHub repo** 內做得完；base 已 push 到 origin；派出帳號的 `--ref` preflight 判 GitHub App 已安裝（網頁看得到 repo、org 端裝了 App 都不算；判定方式見 cookbook）。repo **不必**釘 model：launch 的 `--model`／`--effort` 蓋過 repo 的 `.claude/settings.json`（2026-10-06 實測），只有沒帶列也沒帶旗標的派出才要求 repo 釘 routing table 的 Claude model（Opus 5.5 ≤ `medium` 或 `claude-sonnet-5-5`／`high`，與旗標同一份白名單）。
- **工作形狀**：自足（brief 讀完就做得完）、驗收全在 PR＋CI 看得到。本機驗證越重（大測試矩陣、build、e2e）越划算——那些負載整包留在 VM。急件與非急件用同一條：緊急度只影響排序與 patrol 輪詢（急件的 record 每輪先查），代價是中途無法對話，所以只放行 brief 自足的急件。
- **不適合**：跨 repo、要本機狀態（dev server、DB lease、未 push 的 commit、secret、Herdr／pi seat、systemd、實體硬體）、要推回既有 PR branch 的修補（含 `pr-0a-fix`；原 cloud session 自己開的 PR 走上表 `followup` 列，不新開 session）、commit 0-A、要來回問答（cloud 回不了訊）。命中任一 → 本機 pane（或主線自己做）。clade 標準層（`rules/**`、`vendor/**` 等會散播的源檔）**不再整層排除**：散播只走 `clade-publish`，cloud 只產 draft PR，落地前照樣過 0-A 與 publish gate（Charles 2026-10-06）；clade 端「要本機狀態」的具體例子是要 live Herdr／coordinator 快取（`~/.cache/clade/**`）驗證的、要 ssh peer 的、要動 consumer 投影或跑 propagate 的、要 systemd／timer 的。
- 自動派工（`coordinator-ready.ts` `cloudShapeProblem`）只看得到件的標題與寫入路徑，以字樣比對判「要本機狀態」：命中留本機，沒命中才排 cloud；誤判由上面的硬條件、pane 退路與 PR 驗收兜底。

**cloud 先扣派出帳號的 cloud credit，扣完改扣該帳號的訂閱 weekly 窗**（Charles 2026-10-06，取代 09-28「與訂閱窗口無關」）。不設併發上限、不設總量預算、不設 weekly 保留百分比（Charles：「R7 不應該設上限」「用光沒關係 用光我 upgrade」）。admission 只擋兩件：帳號不可判定（要 cc1|cc2|cc3），以及下面的 0-A reviewer 席位守門。

**0-A reviewer 席位守門（唯一的硬門）**：commit 0-A reviewer 固定是 Claude Opus 5.5（effort: medium）、只能跑在本機 Claude 帳號上，cloud **NEVER** 讓它沒有任何可用帳號。

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | 池內（cc1／cc2／cc3）沒有任何帳號讀得到且 `five_hour`、`seven_day` 皆 > 0 → 拒派該件。全數用盡與「有帳號讀不到或額度快照過期」都算：讀不到視為未知，保守停派。只要有一個帳號確認有額度就放行，不留百分比 |
| 消費端 | `cloud-dispatch.ts dispatch` 的 admission（`reviewerSeatGuard`，讀值來自 `readDispatchQuota`，新鮮度門檻同 `claude-account-preflight.ts` `MAX_QUOTA_AGE_MS`）；`coordinator-ready.ts` 選 cloud 載體前以快照的池讀值判同一條，停派後照載體偏好往 Devin／本機 pane 退 |
| 觸發點 | 失敗輸出：`dispatch` 拒派訊息，以及 `cloud-dispatch.ts patrol`／`herdr-patrol.ts --stalled` 的 `reviewer-seat-hold` 待處置列（列出各帳號窗口與被停派的件）。處置：請 Charles upgrade 或等窗口重置，額度恢復後重派即自動解除；**NEVER** 繞過守門派出 |

機械閘在 `vendor/scripts/cloud-dispatch.ts dispatch`：在飛數（該帳號尚未 `harvest` 的 record；未帶帳號的 adopted record 計入每個帳號）與 credit 用盡標記只回報、不拒派（標記是啟動失敗訊息顯示 credit／billing 耗盡時留下的通知，`credit-reset --account <帳號>` 清除）。launch 因帳號 `five_hour`／`seven_day`（或 credit）用盡而失敗時，自動輪替池內下一個帳號（有額度者先）；每個帳號都失敗才停派並列 `reviewer-seat-hold` 待處置。`--ref` 被拒也輪替（Claude GitHub App 逐帳號安裝）：記住該帳號 × repo 6 小時、期間不再排它，池內帳號全部被拒才失敗，之後的 dry-run 直接拒派、改走本機 pane。**NEVER** 用任何方式繞過它拒派的結果。派出帳號在 cc1／cc2／cc3 之間選有額度且在飛較少的那個，以 `dispatch --account cc1|cc2|cc3` 明確指定；`adopt` 也帶 `--account` 讓 record 歸屬到帳號。不指定時只接受能從 `CLAUDE_CONFIG_DIR` 辨認出的池帳號。

每輪有 handoff 級的 Claude 原生列就緒件時，主持者先跑 cloud dry-run admission 選帳號；若不派 cloud，在載體分佈旁記錄具體拒派條件（例如工作要本機狀態、`--ref` 被拒、0-A reviewer 席位守門）。

**Devin 續接**：Devin session 不能 `--continue`，要續做一律開新 session 帶 durable brief。

**MUST** 經 `vendor/scripts/cloud-dispatch.ts dispatch` 派出（或對已在跑的 cloud session 跑 `adopt`）：它逐件帶 `--model`／`--effort`（拒絕禁用 model、Opus 超過 `medium`、Sonnet 不是 `high`）、把交付契約（固定 `cloud/` branch、draft PR、`Work:` 行）寫進 brief 開頭，並留下 record 與 `substrate: cloud` 的 flow span。**NEVER** 裸跑 `claude --cloud` 派工作——沒有 record 的 cloud session 沒有任何本機巡檢面看得到，派它的 session 一結束它就成了孤兒。裸跑還有第二個代價：不帶 `--ref` 時，只要 checkout 有未 commit 改動，CLI 就改成上傳本機 working tree 起 session——VM 沒有 origin、推不回成果，而且同一棵樹上別的 session 未 commit 的內容也一起送上雲。`dispatch` 一律帶 `--ref <base>`（拿不到 GitHub clone 就直接失敗、不上傳），並拒絕 base 領先 origin 的派出。收割看 GitHub（`herdr-patrol.ts --stalled` 的 CLOUD DISPATCHES 區塊與 `cloud-dispatch.ts patrol`），落地後 `cloud-dispatch.ts harvest` 關 span。brief 的資料邊界同 [[agent-routing.pi-watch-protocol]] § Dispatch 資料邊界：cloud 是另一個 runtime，secret 的值 **NEVER** 進 brief。指令、限制與收割形狀全文在 `vendor/snippets/cloud-dispatch/README.md`。

### Claude Code Projects（beta）

Projects（claude.ai/code、桌面 app 的 Code 分頁、手機 app；CLI 沒有）是 Anthropic 端的 coordinator 加上一批 cloud thread。它**不是** `cloud-dispatch.ts` 這個載體，也**不**取代主持者：thread 不進 record、patrol 或 flow spine；用量吃訂閱的 `five_hour`／`seven_day` 窗（官方文件：「same plan limits as your other Claude Code sessions and uses them faster」），不是上面那筆 cloud credit；新 project 的 thread 預設 Opus（effort: high）。

| 可觀察 predicate | 判定 |
| --- | --- |
| Context 放了 2 個以上 repo | **NEVER**：多 repo 時任何 repo 的 `.claude/settings.json`（hooks、permission rules、`env`）都不套用，thread 只靠 auto mode 跑 |
| Context 含 clade，或工作會動任何 repo 的 `.claude/**`、`CLAUDE.md`、`AGENTS.md` 等 clade 投影檔 | **NEVER**（Projects 的 thread 不進 record／patrol；上方 cloud 載體對 clade 標準層的放行不適用於 Projects） |
| 要本機狀態、跨 repo、commit 0-A | 不用 Projects，照上方載體表 |
| 單一 consumer repo、工作形狀符合上方「適合 cloud」（自足、驗收全看 PR＋CI）、該 repo 已裝 Claude GitHub App | 可用。照 cookbook § Claude Code Projects 開，Thread effort 改成 ≤ `medium`。開 project 或交新工作之前先跑 `probe-quota` 看該帳號兩窗的 `remainingPercent`：任一窗 < 30 不開新 thread（並 pause project），< 50 同時最多 1 條，兩窗都 ≥ 50 最多 3 條（沿用 Charles 2026-09-26 定的 cloud 門檻） |
| thread 開出的 PR | 同 cloud 派工的 PR：0-A 在 desk 跑、merge 走 desk 的 merge 佇列；thread **NEVER** merge |

開法、project instructions 範本與待驗清單在 `vendor/snippets/cloud-dispatch/README.md` § Claude Code Projects。

### Claude Code Auto-fix（`/autofix-pr`）

**不列入派工流程**（Charles 2026-10-07）。cloud dispatch 開的 PR，CI 修補照上方載體表的 `followup` 列交回原 session：主持者從巡檢就送得出去，有 record 與 span。Auto-fix 只能從互動 session 或 claude.ai/code 的 CI bar 開（`-p` 回 `isn't available in this environment`），agent 開不了，每張 PR 都要 Charles 親手開。它推修正到 PR 自己的 head branch，commit 作者是開啟者本人、model 是 Sonnet 5.5，範圍只能靠 prompt 限縮（2026-10-07 實測，證據在 cookbook）。**NEVER** 在 brief、派工或巡檢裡把「開 Auto-fix」當成一個步驟，也不要叫 Charles 去開。

Charles 自己開了 Auto-fix 的 PR，agent 照下表接手：

| 可觀察 predicate | 動作 |
| --- | --- |
| Charles 說他在某張 PR 開了 Auto-fix（PR 上出現來源不明的 commit 時先問 Charles；commit 作者與 `Claude-Session` trailer 分不出 Auto-fix 和本機 session） | 從 Auto-fix 推的那個 commit 的 `Claude-Session` trailer 取 session id，跑 `cloud-dispatch.ts adopt <session_id> --label 'Auto-fix #<PR>' --branch <PR branch> --repo <owner/name> --account <開啟帳號>`。沒有 record 的 Auto-fix session，巡檢面看不到 |
| 要跑 commit 0-A | 先 `cloud-dispatch.ts followup <cloud_id> --message "Stop auto-fix …" --reason '0-A 前關閉'`，再開 0-A。它在 0-A 之後推的 commit 會讓 merge 佇列改判 `merge-ready-no-0a`，每推一次就要重跑一次 0-A |
| 0-A findings、review comment、merge conflict | 不交給 Auto-fix：0-A 打回照載體表走 `followup` 或本機 pane；conflict 不會送進 Auto-fix，照舊走本機 |

## Implementation readiness gate（實作派工前）

派出去的是**實作**（brief 宣告 `stage: implement`，或 dispatcher 帶 `--implementation`）且 `CLADE_WORK_ID` 綁到一個 lifecycle package 時，dispatcher **MUST** 先跑 `node vendor/scripts/flow/flow.ts plan readiness <work-id>`；`ready=false` 就拒絕建 pane，findings 逐條指名缺的契約（`spec.md`、acceptance feature、`acceptance_command`、stale `truth_baseline`、undefined／ambiguous step）。缺的東西回到對應 spec owner，**NEVER** 交給 implementer 順手補——implementer 只能改被指派的實作與配套單元測試，acceptance feature、DSL、`spec.md` 在它手上是唯讀；主線收工時跑 `flow plan spec-integrity <work-id> --since <dispatch sha>`，那三類有改動就拒收，**即使它回報的測試全綠**。

**便宜模型的資格是量出來的，不是寫死的。** readiness 通過只代表 package 完整到可以被獨立 context 接手，它**不是**改走更便宜 model 的授權：model 仍照 [[agent-routing.routing-table]] § 工作類別對照 與本檔 § 4 選檔。要宣稱某類 task 可交給低成本模型，MUST 有該 task class 的獨立試驗證據（fresh context、無場外指導、獨立 verifier 跑未改動的 acceptance、記 model／effort／attempts／rework／總成本）；試驗失敗回到契約或 routing，**NEVER** 把殘餘交給強模型補完再標成功而不記那次介入。

## Skill invocability gate（brief 指名 skill 前）

brief 叫 pane 呼叫的 skill，可不可呼叫由**目標端投影 SKILL.md 的 frontmatter** 決定（`disable-model-invocation: true` = 叫不動），**NEVER** 由寫 brief 那台看得到、或源檔長什麼樣推論。Herdr dispatch（新建、relay、`--continue`）在建 pane 前對 Claude child 自動判定，命中回 `skill_not_invocable`；不經 Herdr 的 brief 跑 `node vendor/scripts/brief-skill-check.ts --cwd <target> <brief>`（exit 1 = 紅）。指名看**形式**不看語意：`/<skill>` 或 `Skill(<skill>)` 一律算指名，周圍寫了 NEVER／由 Charles 也一樣；只是**提到**就寫裸名（`version-upgrade`，不加斜線）。**NEVER** 為了讓禁止句過關加散文豁免——2026-09-23 0-A 七輪每輪都找到新的 fail-open 句型。已知限制：裸名寫成的指令（「invoke the dep-upgrade skill」）不在攔截範圍，由寫 brief 的人負責；判定只掃 `<target>/.claude/skills` 與 launcher 的 user-level skills，不掃 plugin skills。readonly gate-review 列（`--table-row` 屬 code-review 類）不判：它的 prompt 內嵌被審 diff，是引用不是指令。

被擋的工作只有人做得了：把「哪一台、跑哪個範圍」用 `flow ask` 開成拍板題、執行寫成 `--step`，**NEVER** 改寫成「請 user 執行」再派同一個 pane、**NEVER** 叫 pane 讀 skill 內文自己照跑（拒絕訊息逐字寫 `Do not replicate this skill workflow by other means`）。

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | brief 以指名形式叫 Claude child 呼叫目標端 `disable-model-invocation: true` 的 skill → Herdr dispatch exit 15 `skill_not_invocable`，零 pane、零 record；CLI exit 1 |
| 消費端 | 正在派工的主線（拒絕訊息附 `flow ask` 範本）；`\my` 承接改開的拍板題 |
| 觸發點 | 本節（決定派工、寫 brief 前 MUST Read 本檔）；判定式在 `vendor/scripts/lib/brief-skill-invocability.ts` |

## 必禁事項 — Dispatch 入口（原在 `agent-routing.md` § 必禁事項）

| NEVER | 說明 |
| --- | --- |
| **NEVER** 印「請開啟Codex CLI」「Stop here」「請貼prompt」這類純文字handoff訊息要使用者手動切 | 主線必須自己以背景dispatcher派Pi模型 |
| **已 route 給 Pi 的工作，NEVER** 直接執行 `codex` binary（含 `codex exec`／`codex review`／`codex exec resume`）代替 dispatcher，或把它當 Pi 故障 fallback | 該工作沿用 `vendor/scripts/pi-dispatch.ts` 或專用 Pi wrapper 的 admission、receipt 與 fallback。原生 Codex session、已授權 native subagent 與明確要求的 Codex 產品驗證，由 target adapter 依各自 scope 和本次 tool schema 執行；模型名字本身不決定 transport。 |
| **NEVER** 嘗試`codex:rescue`／`codex:setup`plugin路線 | 已驗證無法使用、已全清（含`/assign`） |
| **NEVER** 把 UI view phase 派給未具該項視覺品質資格的 executor，或以 Pi 機械列／一般 native delegation 代替 qualified bounded phase | UI 的 residency 與資格判定見 § Runtime residency and native transport；非 view phase 的 dispatch prompt 仍 MUST 含「禁止改 view 層檔案」硬指令，缺這條 runtime 容易順手改到 .vue / .tsx |
| **NEVER** 讓 Claude subagent 當 pi 的**薄中介**——派出 pi 卻不自跑 Pi Watch Protocol，把死活判定留給上一層 | 判準是**誰持有 pi 的生命週期**，不是「有沒有經過 subagent」。薄中介的兩個已驗證失敗模式見 rationale（同 §）。完整持有生命週期的形狀（該層編排者自派自 watch）見 [[agent-routing.pi-watch-protocol]] § Dispatch 入口禁令（下推三列） 的編排者列 |
| **NEVER** 在 exploration / research 型 session 自己逐檔 Read + scan 多個 source（specs / HANDOFF / git log / docs）超過 3 個 source file | 先依 `read-heavy-scan` 具名列派 Pi pre-scan 拿 structured summary，再由主線消費 summary 做判斷。例外：user 明確問特定檔案 / 需要 claude.ai-connected MCP |
| **NEVER** 把 target-native subtask catalog 的 `model` 當成跨 runtime model qualification | Runtime residency 與 target adapter 的 native transport fragment 共同決定合法 carrier。其他 model 只走已驗證的跨 runtime carrier；缺 carrier 就 blocked。 |
