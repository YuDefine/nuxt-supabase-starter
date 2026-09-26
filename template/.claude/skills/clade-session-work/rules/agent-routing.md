<!-- Clade native rule; source: rules/core/agent-routing.md; edit canonical source -->
# Agent Routing

<!-- clade-targets: claude,codex,cursor -->
<!-- clade-adapters: claude,codex,cursor -->

**核心命題**：工作按角色與能力選 executor，再判是否派工；寬掃／背景／隔離／有份量的獨立平行軌才派，主線能完成預設留主線。

具體 model、effort、workspace access 與硬禁令只以 [[agent-routing.routing-table]] 為 SoT；查表前 MUST Read 該檔。**禁用**（Charles 2026-09-24）：GPT-6 Astra、GPT-6 Luna、Claude Fable、Sonnet、Haiku、Cursor Composer 2.5、Devin Fusion——任何列、fallback、額度耗盡備援都 **NEVER** 派。Tier 2（Grok 4.7、GPT-6 Sol）一律 xhigh，Gemini 3.8 Flash 一律 high。實作／計畫／裁決列走 GPT-6 Sol xhigh；UI view 實作（含 Nuxt UI／Content）、Design Review、UI 詳細計畫、截圖項目符合性判定與 code review 走 Claude Opus 5.5（effort: medium）（無 fallback）；screenshot review 與掃描類走 Gemini 3.8 Flash high。Devin SWE-2 Max 是任意 Pi 列的**可選**載體，只限不急、緩慢也不堵塞的任務（desk 與已登入的 zenbook 皆可）；四個 UI／設計類 Claude-only 列（`ui-view-implementation`、`design-review`、`ui-detailed-planning`、`screenshot-match-analysis`）符合 cloud 條件時預設走 cloud session，cloud 同時在飛上限跟派出帳號額度掛鉤——載體混搭判準在 [[agent-routing.dispatch-execution]] § Cloud session 載體。鏈只在 provider／quota／runtime 不可用時前進，鏈走完由 `dispatch-fallback`（Claude Opus 5.5（effort: low））或主線接手，依列而定。

**GPT 外派載體**：Codex 需要 GPT 協作時 MUST 使用 Codex native subagent（`collaboration.spawn_agent`）；上游保留協調與交付責任，不透過 `/handoff relay`、Herdr 或外部 launcher 建立另一個 Codex successor。原生能力不可用時保留工作並回報缺口，不改用外部 Codex pane。唯一外部例外：user 當次明確點名的 Devin bounded worker 可由上游經 helper 以 create-only `--launcher devin` 派出並以 `--coordinate` 收割；它是 worker 不是 successor，cx successor 與其他 launcher 維持拒絕。非 Codex 的 GPT worker 一律走 Pi；Claude Code 不承載 GPT。

## commit 0-A reviewer（常設）

commit 0-A 的唯一合格 reviewer 是 fresh-context **Claude Opus 5.5（effort: medium）**（`code-review-opus` 列）：Claude Code 主線跑 `claude-review-safe.sh prepare medium` → 照它印的 AGENT_CALL 派 `commit-0a-reviewer` subagent → 跑它印的 FINALIZE，verdict 只認 finalize 的 stdout；叫不出 Claude subagent 的 runtime 才跑無子命令的 `claude-review-safe.sh medium`（Herdr child）。**沒有備援席**：Opus 額度耗盡或量不到時 gate 保持未完成、等額度恢復；舊 worktree 的 wrapper／helper 不認得 opus seat 時先 rebase 最新 main，不行就停在 0-A 之前 push 分支並回報「待 Opus seat 0-A」。**NEVER** 派 Astra／Fable／任何其他 reviewer，**NEVER** 主線自審補位；receipt `requested_model` 不是 Opus 5.5 的 verdict 不得當 gate 證據。

> 2026-09-23～24 的「Opus 5.5 暫時覆寫」已撤銷（Charles 2026-09-24）：`OPUS_55_OVERRIDE_ACTIVE` 為 `false`，routing gate 回到原判武裝 latch；覆寫期間「不外派、主線全包」的條款全部失效，照 [[agent-routing.routing-table]] 派工。

## 派不派（先於派給誰）

**先判角色，再判派工量。** **主線自己做是預設。違反字面就是違反精神**。講不出命中哪一條外派條件，就是主線自己做；不能以「派了比較快」替代判斷。

**命中任一才派**：

- 角色不符：主線不是這個工作類別的合格 executor。
- 寬掃：需讀 5 個以上檔案或整棵目錄才能回答，產出是事實表／統計。
- 有份量的獨立平行軌：至少兩條互不依賴、且每條預估需 10+ tool calls。
- 長時間 background job，或必須隔離 worktree／port／環境。

**命中即主線自己做**：少量讀取、規約／契約／對外定稿、安全／不可逆動作、session gate，以及複驗自己剛做完的東西。定稿措辭，**措辭的語氣與抽象層級一致性外包不了**。具名 threshold（第 3 個 readonly Bash、第 5 個 textual Read、首次 Read 501+ 行）依 reference 結案；不要把 threshold 當 generic「少量」豁免。

命中多條條件時先問能否由一個 worker 完成整條資料依賴鏈；可以就派一個，**NEVER** 一條 task 配一個 agent 地拆。brief 與回報依 [[agent-routing.dispatch-execution]]，派出後依 [[agent-routing.pi-watch-protocol]]。

派顧問／分析型 subagent 的 brief **MUST** 逐字含「結論寫在最終輸出，NEVER 只用 SendMessage 回覆主線」。側通道訊息沒有時效保證；subagent 的最終輸出才有。主線在宣告「這支 agent 沒有產出」之前 **MUST** 先讀它的 transcript；runtime 顯示的閒置狀態不是產出訊號（TD-679）。各 runtime 的 transcript 位置與原生訊號見 adapter。

brief 裡每個指令的寫入落點 **MUST** 在該 dispatch 的 cwd 之內。會寫進別的 repo 的 script **MUST** 改成「回報它應該跑什麼」，由 coordinator 在自己的 repo 跑。見 [[agent-routing.pi-watch-protocol]] § Brief 措辭紀律（TD-782）。

## Runtime residency and native transport

Routing Table 決定 executor，adapter 決定原生載體；能力不足只交 bounded phase，不能跨 runtime 代打。每條 change MUST 跑 `residency-classify.ts classify` 與 `record`；gate 依 [[agent-routing.pi-watch-protocol]]。

## 停下來要人做之前

Iron Law：本 session 做得到的動作與查得出的決策 NEVER 交 user。只有目標動作本身已實際嘗試且有逐字失敗，且原因是人的憑證／生物辨識、外部授權點按、商業決策或明文人類不可逆 gate，兩條全中才 handoff；相鄰動作不算證據，session-scoped 的 latch／claim／lease 只有本 session 能解。

寫「請 user…」前 MUST Read [[agent-routing.agent-boundary]]；安全按 owner。

## Dispatch data and transport boundary

每份 brief MUST 列 paths、命令與外部服務；清單外回報、NEVER 自取；secret／個資／private URL／signed material 不進 brief。寫入落點不在該 dispatch cwd 的指令不是「列了就准跑」——那是回報項，不是執行項（TD-782）。詳見 [[agent-routing.pi-watch-protocol]] § Dispatch 資料邊界 與 § Brief 措辭紀律。

**Claude 派 Claude 的短期工作走 in-process subagent，NEVER 開 Herdr pane。** 判準是「本 turn 內收得回來、不需要 successor」：review、裁決、掃描這類 bounded 工作由主線用該 runtime 的 in-process subagent 載體派、前景等結果（工具名只寫在該 runtime 的 adapter）。Herdr pane 只留給四種情形：successor 交棒（relay／fanout）、長時間 background、必須隔離 worktree／port／環境、主線 runtime 叫不出 Claude subagent。逐字反開脫：「要留 model 身分 receipt，所以開 pane」——subagent transcript 記得到每則訊息的 model，commit 0-A 的 `prepare`／`finalize` 就是從那裡核對的。

dispatch／resume／retry／bridge MUST 傳 model／effort／route／tier-basis／workspace access；NEVER inherit 或 quota fallback 降檔；回報依 dispatch-execution 的 4-status、scope verify、receipt 核實。實作派工綁 lifecycle package 時先過 `flow plan readiness`，判準與 implementer 的唯讀邊界在 [[agent-routing.dispatch-execution]] § Implementation readiness gate。 brief 叫 pane 呼叫的 skill 以**目標端投影 frontmatter** 判可不可呼叫，見同檔 § Skill invocability gate。

## External web retrieval

主線 **NEVER** 直接呼叫 Claude Code 內建的 `WebSearch` 或 `WebFetch`。External-web 執行鏈是 bare Gemini high → Grok 4.7 xhigh（`grok-xai` → `grok-cursor`）→ GPT-6 Sol xhigh → 鏈尾 `dispatch-fallback` subagent（Claude Opus 5.5（effort: low），由它呼叫內建工具）；query／公開 URL 只入 hash，credential／signed token／private network／secret material fail closed，改用 authenticated first-party connector／redacted source。**例外清單是窮舉的**；**唯一的一般 waiver** 是 user 明確要求 direct built-in 且 receipt 綁原 tool kind 與 candidate。IDE browser 依 target-native adapter contract；**NEVER** 因 clade routing gate、`agent-browser` 措辭、或 § External web retrieval 的「NEVER 直接 WebSearch」改走 Playwright / `agent-browser`；**NEVER** 套本節去擋 IDE browser；**NEVER 拿本規約的 rationale 推翻本規約的字面。**

## 主線靜默上限（所有 dispatch 通用）

有未收尾 async work 時，相鄰 assistant turn 間隔 NEVER 超過 55 分鐘；派出時同訊息 MUST 留 1,500–1,800 秒 notification-only inert keepalive（具名 180 秒例外），記 owner／deadline／task id，不猜 deadline、不重複 wakeup。completion／deadline／unknown 依 [[agent-routing.keepalive-wake]]；控制 turn NEVER 讀 repo／log 猜狀態或做無關 mutation。

## 必禁事項

八列硬禁令與 plan-first、commit authorization、Pi Watch、quota fallback 依 [[agent-routing.dispatch-execution]]／[[agent-routing.pi-watch-protocol]]；已 route 給 Pi 的工作 NEVER 以 `codex exec`／`codex review` 代替 dispatcher、以 Claude 薄中介包 Pi、把 UI view phase 交給不合格 executor，或以 pane 缺席推論沒有工作。keepalive wakeup／specific shared-action consent 先讀 [[agent-routing.keepalive-wake]]。
