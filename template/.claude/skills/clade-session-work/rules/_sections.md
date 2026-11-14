<!-- Clade native rule; generated section index of rules/*.md; edit canonical sources -->
行號 1 起算、含端點；Read 用 offset=起、limit=迄-起+1。

agent-routing.agent-boundary.md — agent 與 user 的 handoff 邊界全文——目標動作失敗證據、session-scoped latch／claim／lease、四步判準與 red flags；常駐 [[agent-routing]] 只留 Iron Law 與本檔 MUST-Read
5-11 前導 — Agent Routing — agent / user boundary
13-18 兩條全中才准交給人
20-22 Session-scoped 動作
24-26 Red flags
28-30 工具印的補救文字
32-34 已有領域出口

agent-routing.dispatch-execution.md — dispatch 執行期的全文——已決定派工之後的 brief 範圍判定（§ 派多少）、plan mode 可派／不可派的逐列名單、配額耗盡時 dispatcher payload 算不出來的三條判斷、檔位永不降檔的形狀列舉（§ NEVER 降檔的形狀）、以及所有 dispatch 通用的 4-status 回報契約與「report 是未驗證主張」核實紀律。派不派／派給誰／主線靜默上限這些**判定入口**留在 [[agent-routing]]（對照表在 [[agent-routing.routing-table]]），本檔只承載執行期條文。**單純「要派工」不會自動載入本檔**：決定把工作交出去、寫出任何一份 brief 之前，MUST 依 [[agent-routing]] § 必禁事項 的強制指針主動 Read；改 pi dispatcher／routing gate 或 agent 定義檔時 path-scoped 載入
13-28 前導 — Agent Routing — dispatch 執行期（brief 範圍・plan mode・配額鏈・回報契約）
30-51 派多少（決定派之後的第二題）
53-69 Plan mode 期間的派工邊界
71-104 配額邊界（決策層）
106-113 NEVER 降檔的形狀
115-129 Subagent 回報契約（所有 dispatch 通用）
131-242 Cloud session 載體（Claude Code 主線）
244-256 Cloud session 載體（Claude Code 主線） › Claude Code Projects（beta）
258-268 Cloud session 載體（Claude Code 主線） › Claude Code Auto-fix（`/autofix-pr`）
270-274 Implementation readiness gate（實作派工前）
276-286 Skill invocability gate（brief 指名 skill 前）
288-298 必禁事項 — Dispatch 入口（原在 `agent-routing.md` § 必禁事項）

agent-routing.keepalive-wake.md — keepalive wakeup **醒來那個 turn** 的 allowlist 與 claim 狀態機、以及 permission classifier 要求 specific shared-action consent 時的 structured user-input surface 形狀；兩者都是 reaction-time 契約，不參與「派不派 / 派給誰 / deadline 填多少」的派出決策。本檔**不會**在派工當下自動載入——收到 keepalive wakeup、或 classifier 要求具名 consent 的那一刻，要依 [[agent-routing]] § 主線靜默上限 的強制指針主動 Read
5-30 前導 — Agent Routing — keepalive 醒來與 shared-action consent（reaction-time 契約）
32-72 派出當下的模板與 deadline（MUST）

agent-routing.md — 選 executor／model／effort、派工，或跑 commit 0-A 之前
4-14 前導 — Agent Routing
16-18 commit 0-A reviewer（常設）
20-44 派不派（先於派給誰）
46-48 Runtime residency and native transport
50-54 停下來要人做之前
56-71 Dispatch data and transport boundary
73-82 External web retrieval
84-86 主線靜默上限（所有 dispatch 通用）
88-90 必禁事項

agent-routing.pi-input-intercept.md — Pi 模型經 Pi machine dispatch 提出問題時的攔截、評估、代答或升級 protocol；觸及工作計畫 / screenshot 情境時 path-scoped 載入
5-9 前導 — Agent Routing — Pi Input Intercept Protocol
11-15 核心命題
17-30 Prompt附加段（每一個寫code派工 MUST加）
32-42 問題偵測（每一次terminal收割 MUST執行）
44-63 能否代答
65-82 重派契約
84-86 升級給user
88-106 Q&A Log
108-114 例外

agent-routing.pi-watch-protocol.md — Pi dispatch、bounded phase、截圖取證與符合性判定的載體、brief、監看、receipt 與配額契約；派工前依 agent-routing 指針載入
5-11 前導 — Agent Routing — Pi / screenshot-review Dispatch & Watch Protocol
13-58 Pi 派工的標準流程（所有 routing 共用）
60-76 Pi 派工的標準流程（所有 routing 共用） › 版本化結果契約的受控執行
78-88 Pi 派工的標準流程（所有 routing 共用） › Code review 唯一入口
90-104 Pi 派工的標準流程（所有 routing 共用） › Plan-first（寫 code 的派工必加）
106-114 Pi 派工的標準流程（所有 routing 共用） › Brief 措辭紀律（4.8-aware，寫 code 派工必加）
116-159 Pi 派工的標準流程（所有 routing 共用） › Git baseline declaration（dirty working tree 派工必加）
161-217 Pi 派工的標準流程（所有 routing 共用） › Commit Authorization（pi 派工 hard rule）
219-235 泛用 Dispatcher（pi-dispatch.ts）
237-354 泛用 Dispatcher（pi-dispatch.ts） › Routing threshold 與 native delegation dispatch gate
356-358 Pi Watch Protocol（防止主線乾等與卡住盲區）
360-383 Pi Watch Protocol（防止主線乾等與卡住盲區） › 跨 sandbox 可見度約束 v2
385-400 Pi Watch Protocol（防止主線乾等與卡住盲區） › 監看排程（notification-only）
402-406 Pi Watch Protocol（防止主線乾等與卡住盲區） › 安全網 control turn（hard boundary）
408-412 Pi Watch Protocol（防止主線乾等與卡住盲區） › 介入觸發
414-427 Pi Watch Protocol（防止主線乾等與卡住盲區） › `native wakeup scheduler` 用法守則
429-436 Pi Watch Protocol（防止主線乾等與卡住盲區） › 與「不要把工作往後放」禁令的關係
438-442 Pi Watch Protocol（防止主線乾等與卡住盲區） › 監看期間的紀律
444-450 Orchestration Residency — 機械 Enforcement（residency-classify）
452-467 截圖 routing
469-473 需求建立 handoff
475-481 plan package work execution dispatch（具體做法）
483-487 screenshot-review Verify Mode Dispatch & Watch Protocol
489-502 screenshot-review Verify Mode Dispatch & Watch Protocol › 派工 Brief 必含項（hard rule）
504-515 screenshot-review Verify Mode Dispatch & Watch Protocol › Watch Protocol
517-525 screenshot-review Verify Mode Dispatch & Watch Protocol › 健康判斷（每次 Read progress.json 必跑）
527-534 screenshot-review Verify Mode Dispatch & Watch Protocol › 與 Pi Watch Protocol 的差別
536-542 screenshot-review Verify Mode Dispatch & Watch Protocol › 必禁事項
544-550 screenshot-review Verify Mode Dispatch & Watch Protocol › Dispatcher provenance 機械 backstop（2026-08-11 起）
552-587 配額耗盡時的 fallback 紀律（全文）
589-617 Dispatch 資料邊界（全文）
619-631 Watch 行為禁令（全文）
633-641 Dispatch 入口禁令（下推三列）
643-653 配額與 residency 的下推
655-667 GPT worker transport
670-676 Herdr transport 邊界
679-681 串行鏈的既有實例

agent-routing.routing-table.md — Routing Table 的對照資料層——工作類別 × 由誰執行（model・effort）× 為什麼的逐列表，以及 effort 檔位對照表。跨列的硬禁令與判準也在本檔（§ Pi 派工的 workspace capability、§ Routing 硬禁令）。**單純「要派工」不會自動載入本檔**：查表決定 model／effort 的那一刻，MUST 依 [[agent-routing]] 檔頭的強制指針主動 Read；改本表任一列或動 pi-routing-*.ts / pi-dispatch.ts 時 path-scoped 載入
12-25 前導 — Agent Routing — Routing Table（對照資料層）
27-45 禁用（Charles 2026-09-24；GPT 全面退場 2026-09-29；Gemini 退場、Haiku 5.5 開放 2026-10-08；xAI 退場 2026-10-21）
47-65 effort 與執行載體
67-69 判不進任一列時
71-91 主線 residency（誰當主線；Charles 2026-09-29）
93-106 Workflow 的 Sonnet `agent()`（2026-09-29）
108-121 Haiku 5.5 的席位（Charles 2026-10-08；2026-10-29 加 `haiku-scanner`、`haiku-implementer`）
123-139 E2E 綠準入（便宜／快席位承接的前提；Charles 2026-11-08）
141-145 delegate-sub（原判 sonnet／haiku 等級的委派工作）
147-155 Devin SWE-2 Max（任意 Pi 列可選）
157-163 Claude 帳號池（2026-10-04）
165-167 變更後的規約對照組重跑
169-183 槓桿優先序與規約可實驗（Charles 2026-11-08）
185-244 工作類別對照
246-277 Pi 派工的 workspace capability

consumer-meta.md — 每個 consumer 自宣告 .claude/consumer-meta.json，描述 dev port / auth / database / deploy / verification 等 runtime 事實；clade 聚合成 registry/consumers-meta.json snapshot 供規則 / skill / audit 使用
5-14 前導 — Consumer Meta（per-consumer 自宣告 + clade 聚合 snapshot）
16-23 設計原則
25-29 Aggregator 行為
31-37 何時跑 aggregator
39-44 Schema 演進
46-59 規則 / Skill 怎麼讀 manifest
61-76 與 registry/consumers.json 的關係
78-91 `deployTrigger` 是發版分流的唯一依據
93-130 Deployment type（`deploymentType`）
132-143 遠端主機（`deploy.hosts[]`）
145-171 Adoption 順序
173-191 Adoption gap detection

flow-work-dates.md — 要對 Charles 或客戶給日期、寫 `flow work eta`，或複核自報 ETA 時
5-22 前導 — 交期日期（Iron Law）
24-35 對外前的 gate
37-44 Rationalization table
46-57 Red Flags

flow-work-tracking.md — flow spine 的 work 生命週期契約——一件 work 何時誕生、誰鑄名、`work.done` 的憑證強度、驗收由誰按；動到 vendor/scripts/flow/** 或 .clade/flow/** 時 path-scoped 載入
7-12 前導 — flow work 生命週期契約
14-34 一件 work 是什麼
36-75 R1 `work.done` 憑證條款（fail-closed）
77-92 R2 入口鑄名索引（informational — 不觸發任何東西）
94-102 R3 orphan 佔比訊號
104-122 origin 與 carrier 是同一套 scheme，方向相反
124-159 可重驗的驗收：`flow work done --verify-cmd`
161-169 驗收權歸實際擁有它的人
171-184 待拍板題的前提消失：過時掃描
186-197 spine 可信的是「發生過」，MUST 實跑的是「現在是」
199-223 治理軌跡：`session_summary`

follow-up-register.md — Follow-up Register 規則——work 不做完就不能結案的殘工併回同一份 plan，能先結案的後續項各開獨立 plan、標級、交 watch 派工；舊 TD 結構僅給未遷移 consumer；主動消化節奏
5-12 前導 — Follow-up Register
14-44 直接登記（強制）
46-79 Register 結構（未遷移 consumer）
81-95 登記時機（強制）
97-112 主動消化
114-127 重驗結論交決策檔（未遷移 consumer）
129-139 Session-start Surfacing
141-147 盤點入口

handoff.md — Handoff 規則——當 session 尚有未完成的 work item、blocker 或跨 agent 交接時，必須留下可執行的交接文件
5-13 前導 — Handoff
15-25 Lifecycle repo（repo root 有 `specs/truth/work-lifecycle.md`）
27-35 什麼時候建立或更新 `HANDOFF.md`
37-59 建議格式
61-68 生命週期
70-81 接手流程
83-96 與長期知識的分工
98-135 歷史段路由（`next` 2B.1 Health Gate 用）
137-163 Outstanding writing hygiene
165-195 Outstanding actionability hygiene
197-205 Drift detection
207-215 禁止事項

proactive-skills.design-checkpoint.md — UI 工作的 impeccable 修改閉環（找問題 → 專科修 → 沉澱）、P0–P3 問題族 × 專科指令對照、Design Review tasks 模板、design-review.md 證據與 Design Gate、非 UI exception；動 UI 檔或寫 design artifact 時 path-scoped 載入
5-11 前導 — Proactive Skills — Design Checkpoint（impeccable 修改閉環）
13-15 觸發條件
17-27 入口：不知道下一步就跑無參數 `impeccable`
29-62 閉環三階段
64-86 Design Review Task Template
88-125 design-review.md（Design Gate 證據）
127-136 Design → 規格回饋迴路
138-153 Design Gate（交付人工檢查前的硬門檻）
155-157 跨工作的整體性
159-172 條件式查詢：Modern Web Guidance
174-176 純後端工作的例外

proactive-skills.dev-server-spawn.md — Dev Server Auto-Spawn 規約——agent 自起 dev server 的持久層、lease、port 分流、tunnel 規範
5-9 前導 — Dev Server Auto-Spawn（agent 自起，不要叫 user cd）
11-51 多工器唯一標準：herdr
53-69 In-process tunnel consumer：review 未 merge 的 worktree change（hard rule）
73-77 Dev-port 池滿與 backing service 缺席

proactive-skills.disabled-skill-guidance.md — 禁用 skill 清單的「不引導」那一半——任何 skill / rule / snippet / script 輸出 NEVER 出現叫人去跑禁用清單上那支 skill 的句子，含合法與違規的語境分界表與 audit 訊號。觸發是「正在寫或改 skill／rule／snippet／script 的輸出文案」，綁得到檔案故 path-scoped；禁用清單摘要（哪幾支 NEVER 主動觸發）留在 [[proactive-skills]]，逐支名單表（audit 解析源）在本檔
14-63 全文 — 禁用 skill 的「不引導」義務

proactive-skills.manual-review-entry.md — 進入 tasks.md `## 人工檢查` 階段的入口規約——auto-triage 三類 pending item 的推進路徑、`flow gates` 的 exit code 判讀、`[review:ui]` item 敘述的 URL 階梯、`[discuss]` item 的歸屬
5-11 前導 — Proactive Skills — 人工檢查入口
13-32 Auto-triage + `flow gates`
34-48 `[review:ui]` item 敘述內文的 URL
50-52 `[discuss]` items 不在人眼驗收主流程
54-58 人工檢查推進的三條契約

proactive-skills.md — 收到新任務、判斷要不要主動叫 skill 或進 SDD 入口，或要寫會引導人去跑某支 skill 的文字時
4-14 前導 — Proactive Skill Orchestra
16-63 SDD 入口自主觸發
65-69 Scope Discipline
71-79 Manual Review
81-87 Review Tiers / Screenshot Strategy
89-91 Knowledge And Decisions

runtime/agent-routing.keepalive-wake.md — keepalive wakeup **醒來那個 turn** 的 allowlist 與 claim 狀態機、以及 permission classifier 要求 specific shared-action consent 時的 structured user-input surface 形狀；兩者都是 reaction-time 契約，不參與「派不派 / 派給誰 / deadline 填多少」的派出決策。本檔**不會**在派工當下自動載入——收到 keepalive wakeup、或 classifier 要求具名 consent 的那一刻，MUST 依 [[agent-routing]] § 主線靜默上限 的強制指針主動 Read
5-13 全文 — Claude native keepalive controls

runtime/agent-routing.md — Claude native routing transport
1-8 前導 — Claude native routing transport
10-38 Claude 委派的 model 檔位（決定層）
40-42 Claude residency carrier
44-46 Claude 載體

runtime/agent-routing.pi-input-intercept.md — Codex 模型經 Pi machine dispatch 提出問題時的攔截、評估、代答或升級 protocol；觸及工作計畫 / screenshot 情境時 path-scoped 載入
5-11 全文 — Claude native question escalation

runtime/agent-routing.pi-watch-protocol.md — claude native dispatch and watch controls；具名模型與 UI 角色由共通 routing table 決定
5-11 前導 — Claude native dispatch and watch controls
13-41 Claude 委派的 model 檔位（決定層）
43-54 Claude bounded phases

runtime/agent-routing.routing-table.md — Routing Table 的對照資料層——工作類別 × 由誰執行（model・effort）× 為什麼的逐列表，以及 effort 檔位對照表。跨列的硬禁令與判準也在本檔（§ Pi 派工的 workspace capability 與路徑可見性、§ Routing 硬禁令）。**單純「要派工」不會自動載入本檔**：查表決定 model／effort 的那一刻，MUST 依 [[agent-routing]] 檔頭的強制指針主動 Read；改本表任一列或動 pi-routing-*.ts / pi-dispatch.ts 時 path-scoped 載入
12-18 全文 — Claude native table transport

runtime/flow-work-tracking.md — flow spine 的 work 生命週期契約——一件 work 何時誕生、誰鑄名、`work.done` 的憑證強度、驗收由誰按；動到 vendor/scripts/flow/** 或 .clade/flow/** 時 path-scoped 載入
7-15 全文 — Claude native flow telemetry

runtime/handoff.md — Runtime adapter fragment for handoff.md
5-12 全文 — Runtime adapter: Claude

runtime/proactive-skills.design-checkpoint.md — UI 工作的 impeccable 修改閉環（找問題 → 專科修 → 沉澱）、P0–P3 問題族 × 專科指令對照、Design Review tasks 模板、design-review.md 證據與 Design Gate、非 UI exception；動 UI 檔或寫 design artifact 時 path-scoped 載入
5-10 全文 — Claude design checkpoint transport

runtime/proactive-skills.dev-server-spawn.md — Dev Server Auto-Spawn 規約——agent 自起 dev server 的持久層、lease、port 分流、tunnel 規範
5-10 全文 — Claude dev-server transport

runtime/proactive-skills.manual-review-entry.md — 進入 tasks.md `## 人工檢查` 階段的入口規約——auto-triage 三類 pending item 的推進路徑、`flow gates` 的 exit code 判讀、`[review:ui]` item 敘述的 URL 階梯、`[discuss]` item 的歸屬
5-10 全文 — Claude manual-review entry transport

runtime/proactive-skills.md — Claude native orchestration and browser carrier
1-8 全文 — Claude native orchestration and browser carrier

runtime/session-claims.md — 多 session 並行下「哪些路徑屬於別 session 還活著的工作」的判定規格——claim 檔 schema、寫 / refresh / drop 時機、誰讀、stale 處理、claim-helper CLI，以及 ownership provenance journal 的寫入時證據與 other-live / orphan / unknown 三分類
5-10 全文 — Claude claim event adapter

runtime/session-tasks.md — ad-hoc 工作開工前 MUST 先建 per-session task 檔——觸發條件、檔名格式、共享單檔禁令、session context 預算門檻
4-9 前導 — Claude task UI and carrier adapter
11-15 Claude launcher context 預算（MUST）
17-74 Claude launcher context 預算（MUST） › 主判準是可觀察 predicate，token 數字是兜底（MUST）
76-101 Claude launcher context 預算（MUST） › 身分豁免：三種身分不受本線約束（Charles 2026-09-02 拍板）
103-126 Claude writer forensics

runtime/session-tasks.operations.md — Session tasks 的操作細節——何時用 / 不用、模板、升級路徑、與其他真相層的分工、lessons.md 邊界；另含**收工正文**（收工三步 / 收工訊息契約 / Herdr session transport / 派幾個 pane / successor 收割），由 [[session-tasks]] 的具名時機指針與 session-context-budget-warn hook 叫醒
5-37 全文 — Claude close-out and handoff carrier

runtime/skill-management.md — 新增、安裝或同步 skill 時，辨認 canonical source、runtime projection、版控與 ownership 邊界
5-12 全文 — Claude skill delivery

scope-discipline.md — Scope discipline 規則——不擴散、必登記、不擅改他人成果，避免 AI 工作流吞掉 WIP 或把範圍外問題靜默遺失
5-8 前導 — Scope Discipline
10-18 正確的 scope discipline
20-32 意外發現的登記路徑（強制）
34-54 未知變更的處理方式
56-63 Rule 衝突解法（preserve > revert）
65-97 Rule 衝突解法（preserve > revert） › 歸屬探測前置（MUST，先於使用者決策）
99-119 Rule 衝突解法（preserve > revert） › 具體分支模板：當前 flow 規約要求「必修」撞別 session WIP
121-167 破壞性指令的 guardrails
169-188 話術關鍵詞 = 立即停手訊號
190-206 Subagent brief 最低要求
208-212 已決 scope 不可重開
214-221 交付物形式
223-229 開放式策略問題不過早路由到 SDD 流程
231-236 禁止事項

session-claims.md — 多 session 並行下「哪些路徑屬於別 session 還活著的工作」的判定規格——claim 檔 schema、寫 / refresh / drop 時機、誰讀、stale 處理、claim-helper CLI，以及 ownership provenance journal 的寫入時證據與 other-live / orphan / unknown 三分類
5-11 前導 — Session Claims
13-38 1. 什麼是 claim
40-71 2. Claim 寫 / refresh / drop 時機
73-85 3. 誰讀 claim
87-107 3. 誰讀 claim › 3.1 `other` 的三分類（寫入時證據）
109-121 3. 誰讀 claim › 3.3 `expected_paths` 由 journal 導出
123-152 3. 誰讀 claim › 3.2 Provenance journal
154-176 3. 誰讀 claim › 3.4 動筆之前的消費端
178-193 3.5 接手別人留下的工作之前 MUST 先 claim
195-199 4. 儲存與 gitignore
201-205 5. Stale claim 處理
207-209 6. Agent-agnostic
211-213 7. 失敗模式（fail-open）
215-233 8. CLI

session-cloud-unattended.md — cloud session（claude.ai／routine／cloud-dispatch 開的 Claude Code on the web）一律無人值守：要決定的事寫成 GitHub 上的 BLOCKED 回報，不停下來等人；registry repo 的 issue 只准兩種用途，BLOCKED issue 解掉就關、逾期 3 天升級
12-17 前導 — Cloud session 無人值守
19-21 為什麼
23-43 卡住時的動作
45-53 主持者那一端
55-76 Issue 用途（封閉清單，全 registry repo）
78-81 判別與唯一逃生口

session-tasks.concurrent-writers.md — Session task 與 merge／publish 遇到其他 writer 時的四層 contention probe，以及多 session 同寫 HANDOFF／ROADMAP／未遷移 consumer tech-debt 這類共享單檔的寫入紀律；常駐 [[session-tasks]] 只留 fail-closed 摘要
5-10 前導 — Session Tasks — concurrent writers
12-19 四層 probe（順序不可調換）
21-56 分類後直接行動
58-114 共享單檔的寫入紀律

session-tasks.md — 開始非瑣碎的 ad-hoc 工作（第一個 tool call 前）、交棒、收工，或 context 預算提示出現時
5-22 前導 — Session Tasks
24-70 Session context 預算
72-74 並行爭用
76-78 真相層與回報

session-tasks.operations.md — Session tasks 的操作細節——何時用 / 不用、模板、升級路徑、與其他真相層的分工、lessons.md 邊界；另含**收工正文**（收工三步 / 收工訊息契約 / Herdr session transport / 派幾個 pane / successor 收割），由 [[session-tasks]] 的具名時機指針與 session-context-budget-warn hook 叫醒
5-15 前導 — Session Tasks — 操作細節
17-32 何時用 `tasks/`，何時不用
34-86 檔案結構
88-151 寫入規約補充
153-184 模板
186-206 升級路徑（session 結束時必跑）
208-221 與其他真相層的分工
223-230 與其他規則的關係
232-238 必禁事項
240-275 與 `tasks/lessons.md` 的關係
277-291 違反時的回報方式
293-295 收工（session close-out）
297-348 收工（session close-out） › 收工三步（交棒 profile 越過該 launcher 的 hard tier MUST，順序不可調換）
350-354 收工（session close-out） › 成本模型與交接成本
356-432 收工（session close-out） › 收工訊息契約（MUST，每一次收工都適用）
434-499 收工（session close-out） › Herdr session transport（每一個符合的 handoff 都 MUST）
501-518 收工（session close-out） › Runtime × mode matrix（canonical；helper 現況，TD-827）
520-594 收工（session close-out） › 派幾個 pane —— 先判這一題
596-622 收工（session close-out） › successor 怎麼收割它繼承的 worker
624-734 收工（session close-out） › 收割的機械兜底：Stop gate（不是提醒，是擋）

skill-management.md — 新增、安裝或同步 skill 時，辨認 canonical source、runtime projection、版控與 ownership 邊界
5-9 前導 — Skill 管理
11-19 三層各自的版控形態
21-25 三條 MUST
27-56 第三方 skill 安裝契約
58-64 User level 不歸 clade 管
66-89 Skill 撰寫形式
91-95 來源與安裝邊界
97-109 投放範圍宣告（clade-visibility）
111-125 驗證入口與覆蓋邊界

wip-orphan-recovery.md — 接手 interrupted session 或收到 dirty worktree 與失效 claim 訊號時使用；區分 ownership 未明與已確認無主的 WIP
5-10 前導 — WIP Orphan Recovery
12-22 什麼是 orphan WIP
24-31 兩個偵測入口
33-46 接手 SOP（碰到 orphan WIP 時逐步跑）
48-55 禁止事項
57-64 反射性 gitignore 禁令（stop hook 攔 orphan WIP 時）
