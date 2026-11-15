<!-- Clade native rule; generated section index of rules/*.md; edit canonical sources -->
行號 1 起算、含端點；Read 用 offset=起、limit=迄-起+1。

agent-self-verification.claim-cross-check.md — MUST 1 / 4 / 10 / 12 / 13 / 14 的全文——派 subagent 收 evidence 前的主線自跑義務、呼叫外部 CLI 前的 contract 驗證、部署宣稱的三方交叉核對與 canonical tuple、帳號可用性的五層逐層驗、改工具定義前從實際生效命令反查 source、外部 daemon 存活判定要對齊自己這條連線。這六條的觸發都綁得到具體檔案（deploy config／auth 路徑／工具定義檔／agent 定義），故 path-scoped；「任何一次下結論就會發作」的那幾條（MUST 11 / 17 / 18 / 19 / 20）留在 [[agent-self-verification]] 常駐層，本檔不複述
18-24 前導 — Agent Self-Verification — 宣稱交叉核對（MUST 1 / 4 / 10 / 12 / 13 / 14）
26-41 MUST（編號沿用 [[agent-self-verification]] § MUST，NEVER 重編）
44-46 Audit signal

agent-self-verification.md — 要宣稱完成、下結論，或跑診斷指令之前
4-6 前導 — Agent Self-Verification
8-16 Runtime adapter boundary
18-20 Browser 載體邊界
22-28 證據鑑別力（先於下方每一條 NEVER / MUST）
30-42 否定命題 MUST 先做陽性對照（先於下方每一條具名處方）
44-63 驗收 gate MUST 收窄到本次觸及的範圍
67-75 Hard rule › NEVER
77-88 Hard rule › NEVER（句型黑名單）
90-184 Hard rule › MUST
186-190 派工前的主線預檢責任在 [[agent-self-verification.screenshot-evidence]]（具名時機 MUST-Read）

agent-self-verification.screenshot-evidence.md — 收 verify:ui / review:ui 視覺 evidence 的操作規約——截圖與驗證同一個 Bash call、(a)–(e) 五層驗證的 canonical pattern、seed fixture 必須進 seed.sql、worktree .env 先驗再宣稱缺、既有 [x] 要自拍佐證、UI 改動後全批重拍、`(deferred:)` failure trail 逐字範例、收尾前 receipt 齊全核對、截圖收集與符合性判定分兩步
5-7 前導 — Agent Self-Verification — 視覺 evidence 收集
9-17 Runtime adapter boundary
19-23 NEVER — 禁止直接 handoff user 的三個 verify-channel 場景
25-35 NEVER（句型黑名單 — verify-channel 那一半）
37-43 MUST 2 — 撞 baseline functional gap 走四層 fallback chain
45-54 派工前的主線預檢責任
56-62 MUST 3 — `(deferred: ...)` annotation 的 failure trail 格式
64-68 MUST 5 — verify:ui / verify:e2e evidence 的 fixture MUST 在 seed.sql
70-74 MUST 6 — Worktree .env 驗證
76-86 MUST 7 — 截圖 + 驗證不可分割（atomic screenshot-then-verify）
88-92 MUST 8 — review:ui 既有 `[x]` 需 agent 自拍 evidence 佐證
95-116 MUST 9 — UI 改動後 MUST 重拍所有受影響的 verify:ui 截圖
118-128 MUST 15 — 收尾前核對 receipt 齊全
130-138 MUST 16 — 驗收對象需要登入態時，MUST 用真瀏覽器走到底並斷言登入後狀態
140-160 截圖收集與判定分兩步（MUST；自 `review-gui-surface.md` 移入，該檔已隨 review-gui 退役刪除）
162-166 Browser Worktree Verify Auth（hard rule；自 [[proactive-skills]] 下推）

agent-self-verification.structural-and-exit-evidence.md — MUST 11 的結構查詢與分頁兩種 negative-search 形態（graph／LSP 的 callers・references・in-degree 恆 0 與「真的沒有」同形；has_more 分頁的第一頁不是全集），以及 MUST 20 常駐義務的 exhibit 指針（三組對照見 TD-1059）
5-15 前導 — 結構查詢與 exit-code 證據（MUST 11 的下推全文 ＋ MUST 20 exhibit 指針）
17-19 MUST 11 · 結構查詢
21-23 MUST 11 · 分頁
25-27 exit code／fatal 的原始 receipt

audit-pattern.md — D-pattern audit 規範（DB outbox canonical + evlog derived stream + hash anchor），以及業務寫入觸發的非同步副作用（domain events：寄信、webhook、索引、通知）要怎麼落 DB、派送、重試與 replay
5-14 前導 — Audit Pattern
16-22 三段定義
24-38 MUST
40-46 MUST NOT
48-73 Tamper Resistance（防竄改與保留）
75-93 Handler 標準流程
95-111 拒絕操作
113-121 失敗模式
123-160 Domain events（非同步副作用）
162-172 Review 檢查

checker-contract.md — 新增或修改 mechanical checker、CI gate、contract checker、allowlist 時套用；防止 scope 不透明、依賴缺失誤判綠燈與 canonical check 漂移
5-11 前導 — Checker Contract
13-48 REQUIRED output contract
50-98 Fail-closed Iron Law
100-121 執行載體（檔案存在 ≠ 有東西會執行它）
123-135 上線前看它紅一次（載體接上 ≠ 判定會觸發）
137-150 判準綁事實，不綁命名或結構慣例
152-156 Canonical check entry
158-194 Allowlist ratchet
196-207 違反回報格式

checker-subagent.md — 高擴散半徑改動（跨 consumer 共用 SoT / migration / auth 路徑 / 共用 util）在 publish 或 commit 前要派 fresh-context checker subagent 複核——只讀 diff + spec，產出 PASS/FAIL + finding；gate 全綠是派 checker 的前置條件不是複核項；其餘任務不派
5-10 前導 — Checker Subagent（高擴散半徑改動複核）
12-23 Iron Law — 擴散半徑決定派不派
25-33 何時 REQUIRED
35-39 派 checker 的前置條件（MUST 先滿足）
41-57 Checker brief 模板（REQUIRED 欄位）
59-75 PASS / FAIL 判準
77-82 主線收到 finding 後（MUST）
84-96 終止條件是「最後一輪 0 修改」，不是輪數用盡（MUST）
98-121 同一份 spec 第二次 verify-only FAIL → plan-level review（MUST）
123-125 為什麼

manual-review.backend.md — Manual Review backend 規約——backend-only change 特別規約 + 標準流程（含 verify channel baseline）；動 server / test / e2e / supabase 時 path-scoped 載入
5-7 前導 — Manual Review — Backend Verification Flow
9-17 Runtime adapter boundary
19-21 Backend-only change 的特別規約
25-146 標準流程 › `[verify:*]` flow（`/implement` 收尾的 Verify Channel Pass）
148-152 標準流程 › `[review:ui]` flow（真的需要人）
154-156 標準流程 › `[discuss]` flow

manual-review.data-readiness.md — Manual Review data-readiness 規約——規劃階段（寫 plan package／tasks 時）準備驗收資料的 hard rule、[review:ui] 純功能驗證 step actionability、fixtures 檔契約（自獨立 fixtures 規約併入）、`@no-manual-review-check` marker schema、截圖檔名配對；寫 proposal.md / tasks.md 時 path-scoped 載入
5-7 前導 — Manual Review — Data Readiness & Actionability
9-17 Runtime adapter boundary
19-78 Pre-Review Data Readiness（hard rule）
80-95 Fixtures 檔（hard rule；自獨立 fixtures 規約併入）
97-99 `[review:ui]` 純功能驗證 step actionability（hard rule）
101-114 `[review:ui]` 純功能驗證 step actionability（hard rule） › 通則
116-128 `[review:ui]` 純功能驗證 step actionability（hard rule） › 反例
130-142 `[review:ui]` 純功能驗證 step actionability（hard rule） › URL query param 必須對照 page source（hard rule）
144-163 `[review:ui]` 純功能驗證 step actionability（hard rule） › Modal-based detail 的互動步驟格式（hard rule）
165-196 `[review:ui]` 純功能驗證 step actionability（hard rule） › 要求特定身分的 item MUST 寫可點的 dev-login URL
198-208 `[review:ui]` 純功能驗證 step actionability（hard rule） › 實體裝置 / 規格外輸入的替代路徑
210-227 `[review:ui]` 純功能驗證 step actionability（hard rule） › 範例：kiosk 刷卡
229-260 `@no-manual-review-check` Marker（hard rule）
262-264 截圖檔名與 item id 配對（hard rule）

manual-review.evidence.md — Manual Review evidence 規約——寫 / 審 tasks.md 的
5-11 前導 — Manual Review — Evidence & Authoring Schema
13-23 給 propose / spec 寫作者
25-44 可解析格式（hard rule）
46-73 Kind 分類指引（給 propose / spec 寫作者）
75-104 Kind 分類指引（給 propose / spec 寫作者） › Issue fix 後重拍範圍（hard rule）
106-124 Kind 分類指引（給 propose / spec 寫作者） › 反面範例
126-136 Kind 分類指引（給 propose / spec 寫作者） › `[review:ui]` 收斂原則（hard rule）
138-162 Kind 分類指引（給 propose / spec 寫作者） › `[verify:ui]` 對 sample-key-bound item 的反例（hard rule，2026-05-24 補強）
164-184 Kind 分類指引（給 propose / spec 寫作者） › `[verify:*]` 編輯/狀態變更類動作對 fixture 可編輯性的要求（hard rule）
186-205 `@no-screenshot` Marker（hard rule）
207-222 Evidence 收集與狀態判讀的硬規則
224-233 Parent State Derivation — 真相層責任分工
235-246 Legacy annotation 退役對照
248-250 ADR (2026-05-22) — Default Kind Flip 未採用，勿再提案

manual-review.md — 人工檢查（Manual Review）主檔——核心 invariant、Item Kind Marker、annotation schema、[discuss] walkthrough、Parent State Derivation、Post-Edit Gate；有進行中的 work item（動 tasks/**、specs/plans/**）或在整理 screenshots 時載入
5-7 前導 — 人工檢查（Manual Review）
9-17 Runtime adapter boundary
19-21 這套機制在解什麼問題（先讀，決定你該不該用它）
23-48 核心規則
50-89 人工檢查時機（Hard rule）
91-119 緊急件的分段驗收（Charles 2026-09-28 Q7=A）
121-132 Screenshot Review ≠ Functional Verification（Hard Rule）
134-149 可解析格式（hard rule）
151-209 Item Kind Marker（hard rule）
211-221 補 evidence 路徑（hard rule）
223-234 標準流程（依 kind 分流）
236-268 `[discuss]` walkthrough（交付前收尾）
270-276 混合 kind 的執行順序
278-286 Post-Edit Validation Gate（hard rule）
288-297 Checkbox ownership（誰可勾什麼）
299-308 Annotation 寫入契約（正向 canonical——形狀問題）
310-316 Routing guard（何時走哪條路——條件句）

playwright-webserver.md — Playwright E2E webServer MUST CI-safe — 優先 @nuxt/test-utils golden 或 CI-conditional nuxt preview，NEVER 讓 CI 路徑跑依賴本地 .env / tunnel / 多程序的 dev script
5-10 前導 — Playwright webServer 必 CI-safe
12-20 MUST
22-27 NEVER
29-31 Canonical patterns
33-83 Canonical patterns › A. @nuxt/test-utils golden（推薦，新專案 default）
85-108 Canonical patterns › B. CI-conditional `nuxt preview --port`（合法替代，既有專案）
110-121 Fleet pattern 決策（並存，不強制遷）
123-130 自我檢查（寫 / 改 playwright config 時）
132-138 Audit signal

review-tiers.md — Review tiers 規則——依變更規模與風險決定規格／實作一致性審查與獨立 code review 的最低要求
5-10 前導 — Review Tiers
12-17 Tier 定義
19-26 觸發判斷
28-34 最低要求
36-41 額外規則
43-62 Reviewer 紀律（適用**每一次** review dispatch：subagent reviewer、code-review agent）
64-94 裁決端（主線處置 0-A 以外的 review finding）
96-102 禁止事項

runtime/agent-self-verification.md — Claude native evidence carrier
1-8 全文 — Claude native evidence carrier

runtime/agent-self-verification.screenshot-evidence.md — 收 verify:ui / review:ui 視覺 evidence 的操作規約——截圖與驗證同一個 Bash call、(a)–(e) 五層驗證的 canonical pattern、seed fixture 必須進 seed.sql、worktree .env 先驗再宣稱缺、既有 [x] 要自拍佐證、UI 改動後全批重拍、`(deferred:)` failure trail 逐字範例、收尾前 receipt 齊全核對、截圖收集與符合性判定分兩步
5-12 全文 — Claude screenshot evidence operations

runtime/checker-subagent.md — 高擴散半徑改動（跨 consumer 共用 SoT / migration / auth 路徑 / 共用 util）在 publish 或 commit 前 MUST 派 fresh-context checker subagent 複核——只讀 diff + spec，產出 PASS/FAIL + finding；gate 全綠是派 checker 的前置條件不是複核項；其餘任務不派
5-18 全文 — Claude checker transport

runtime/manual-review.backend.md — Manual Review backend 規約——backend-only change 特別規約 + 標準流程（含 verify channel baseline）；動 server / test / e2e / supabase 時 path-scoped 載入
5-12 全文 — Claude native backend verification operations

runtime/manual-review.data-readiness.md — Manual Review data-readiness 規約——規劃階段（寫 plan package／tasks 時）準備驗收資料的 hard rule、[review:ui] 純功能驗證 step actionability、fixtures 檔契約、`@no-manual-review-check` marker schema、截圖檔名配對；寫 proposal.md / tasks.md 時 path-scoped 載入
5-12 全文 — Claude native data-readiness operations

runtime/manual-review.evidence.md — Manual Review evidence 規約——寫 / 審 tasks.md 的
5-10 全文 — Claude evidence transport

runtime/manual-review.md — 人工檢查（Manual Review）主檔——核心 invariant、Item Kind Marker、annotation schema、[discuss] walkthrough、Parent State Derivation、Post-Edit Gate；有進行中的 work item（動 tasks/**、specs/plans/**）或在整理 screenshots 時載入
5-12 全文 — Claude native manual-review operations

runtime/screenshot-strategy.md — Screenshot strategy 規則——根據互動深度、跨裝置、跨瀏覽器與是否要沉澱成回歸測試，選擇 target adapter carrier 或 reproducible runner CLI
5-12 前導 — Claude native screenshot strategy
14-25 Browser control surface (single standard, every machine)

runtime/verification-lease.spec.md — Runtime adapter fragment for verification-lease.spec.md
5-12 全文 — Runtime adapter: Claude

screenshot-strategy.md — Screenshot strategy 規則——根據互動深度、跨裝置、跨瀏覽器與是否要沉澱成回歸測試，選擇 target adapter carrier 或 reproducible runner CLI
5-7 前導 — Screenshot Strategy
9-17 Runtime adapter boundary
19-25 決策樹（工具選擇）
27-29 Cloud / clean-browser fallback
31-33 給 user 開瀏覽器看頁面
35-72 存放方式
74-76 路徑強制規範（hard rule）
78-100 檔名強制規範（hard rule）
102-121 截圖落檔（target adapter operation）
123-125 平行 session 隔離（target adapter operation）
127-131 歸檔機制（不 rotate）
133-135 沉澱規則
137-139 round-trip-only manual-review item
141-161 Empty Data Handling

test-scripts.md — Vitest multi-project test script 設計規範——禁止寫死 path filter 導致單檔測試靜默跳過
5-12 前導 — Test Scripts
14-17 適用範圍
19-62 MUST
64-85 NEVER
87-95 心智模型
97-110 Advisory：包 clade-gate 收 signal（improvement-loop enabled consumer）
112-128 MUST：重寫已包 clade-gate 的 script 時保留前綴

testing-anti-patterns.md — Testing anti-patterns to avoid — mock 濫用、test-only production methods、不完整 mock、unit test 何時寫（U1–U5）、E2E fixture 寫死絕對日期、測試碼品質低於生產碼、抄本測試（期望值在測試裡重算）、刪除或合併既有測試、孤兒測試（沒被 CI 收進去）、測試結構契約、測試逾時紅（負載假紅、放寬逾時數值）
14-17 前導 — Testing Anti-Patterns
19-21 Overview
23-29 The Iron Laws
31-66 Anti-Pattern 1: Testing Mock Behavior
68-118 Anti-Pattern 2: Test-Only Methods in Production
120-158 Anti-Pattern 3: Mocking Without Understanding
160-184 Anti-Pattern 3: Mocking Without Understanding › Gate Function
186-215 Anti-Pattern 4: Incomplete Mocks
217-219 Anti-Pattern 5: Integration Tests as Afterthought
221-269 Anti-Pattern 6: Boundary Values Not Tested
271-312 Anti-Pattern 6: Boundary Values Not Tested › Gate Function
314-319 Anti-Pattern 6: Boundary Values Not Tested › Red flags
321-329 Anti-Pattern 6: Boundary Values Not Tested › 機械驗證通道（選用；多數模組不需要）
331-375 Anti-Pattern 7: Accumulated Invariant Not Pinned
377-401 Anti-Pattern 8: 測試碼品質低於生產碼
403-428 Anti-Pattern 9: 抄本測試
430-450 Anti-Pattern 9: 抄本測試 › Gate Function
452-464 Anti-Pattern 9: 抄本測試 › Red flags
466-468 When Mocks Become Too Complex
470-479 測試從哪裡來（aixbdd）
481-499 unit test 何時寫（MUST）
501-514 unit test 何時寫（MUST） › 新增 U1／U3 測試：附一次破壞證據，標題的每個條件都要有斷言
516-549 unit test 何時寫（MUST） › 刪除或合併既有測試：先取得刪除證據
551-558 skip 誠實度
560-583 測試結構契約
585-617 E2E 以風險路徑排序，非數量
619-640 E2E fixture 的時間錨點 MUST 相對於執行當下
642-649 跑測試的 workflow，其 paths filter MUST 含測試檔本身
651-680 對設定檔原文的斷言，標的是行為本身
682-694 Bug 診斷紀律：重現先於推理
696-714 測試逾時紅：先跑 main 比對，NEVER 放寬數字

truth-layers.md — Optional truth-layers 規則——適用於有明確 persistence / contract / API / UI 分層的專案，定義每一層的真相來源
5-10 前導 — Truth Layers
12-18 核心概念
20-25 規則
27-32 什麼時候特別有用
34-38 禁止事項

verification-lease.md — 要起 dev server、跑 e2e 或佔用 port 之前
4-19 全文 — Verification Lease

verification-lease.spec.md — verification lease 的機制規格——五元組欄位、lease 檔位置與 schema、claim / release / force-takeover 的行為、holder identity 解析、哪些工具必須讀寫 lease、與 consumer-meta leaseMode 的關係
5-11 前導 — Verification Lease — 機制規格
13-23 Lease 的五元組
25-39 Lease 檔位置
41-88 有界性：agent 租約 vs 人類租約
90-104 Lease 檔 schema
106-142 Operations
144-156 Holder identity
158-174 工具行為契約
176-178 Claim 衝突的標準訊息
180-192 與 Consumer Manifest 的關係
194-196 Audit log retention
198-224 Agent 行為契約

verify-gate-chain.md — 自主迴圈的驗證閘門鏈與停止條件——每個 iterate-until-green 迴圈要跑 gate chain、宣告 max_iterations、定義 escalation action
5-10 前導 — Verify Gate Chain（自主迴圈驗證標準）
12-50 Gate chain 定義
52-94 Iterate-until-green 迴圈語義
