---
name: "clade-verification"
description: "Verification, testing, review, screenshots, and evidence rules. Use when testing, reviewing, debugging, collecting evidence, or claiming completion."
---

# SOP

## Phase 1 -- 用任務挑出要讀的 rule

1. READ 逐條對照接下來要做的事：條件成立才把該 rule 列入候選，NEVER 整批讀。
   - `rules/agent-self-verification.claim-cross-check.md`：MUST 1 / 4 / 10 / 12 / 13 / 14 的全文——派 subagent 收 evidence 前的主線自跑義務、呼叫外部 CLI 前的 contract 驗證、部署宣稱的三方交叉核對與 canonical tuple、帳號可用性的五層逐層驗、改工具定義前從實際生效命令反查 source、外部 daemon 存活判定要對齊自己這條連線。這六條的觸發都綁得到具體檔案（deploy config／auth 路徑／工具定義檔／agent 定義），故 path-scoped；「任何一次下結論就會發作」的那幾條（MUST 11 / 17 / 18 / 19 / 20）留在 [[agent-self-verification]] 常駐層，本檔不複述；且碰 `.claude/agents/**`、`.github/workflows/**`、`void.config.ts` 等 11 處
   - `rules/agent-self-verification.md`：要宣稱完成、下結論，或跑診斷指令之前
   - `rules/agent-self-verification.screenshot-evidence.md`：收 verify:ui / review:ui 視覺 evidence 的操作規約——截圖與驗證同一個 Bash call、(a)–(e) 五層驗證的 canonical pattern、seed fixture 必須進 seed.sql、worktree .env 先驗再宣稱缺、既有 [x] 要自拍佐證、UI 改動後全批重拍、`(deferred:)` failure trail 逐字範例、收尾前 receipt 齊全核對、截圖收集與符合性判定分兩步；且碰 `screenshots/**`、`specs/plans/**/tasks.md`、`app/**/*.vue` 等 13 處
   - `rules/agent-self-verification.structural-and-exit-evidence.md`：MUST 11 的結構查詢與分頁兩種 negative-search 形態（graph／LSP 的 callers・references・in-degree 恆 0 與「真的沒有」同形；has_more 分頁的第一頁不是全集），以及 MUST 20 常駐義務的 exhibit 指針（三組對照見 TD-1059）；且碰 `scripts/audit-reference-query-oracle.ts`、`test/fixtures/reference-oracle/**`、`packages/*/test/fixtures/reference-oracle/**` 等 7 處
   - `rules/audit-pattern.md`：D-pattern audit 規範（DB outbox canonical + evlog derived stream + hash anchor），以及業務寫入觸發的非同步副作用（domain events：寄信、webhook、索引、通知）要怎麼落 DB、派送、重試與 replay；且碰 `server/api/**/*.ts`、`packages/*/server/api/**/*.ts`、`server/utils/audit.ts` 等 5 處
   - `rules/checker-contract.md`：新增或修改 mechanical checker、CI gate、contract checker、allowlist 時套用；防止 scope 不透明、依賴缺失誤判綠燈與 canonical check 漂移；且碰 `scripts/**/*`、`vendor/scripts/**/*`、`.github/workflows/**/*` 等 6 處
   - `rules/checker-subagent.md`：高擴散半徑改動（跨 consumer 共用 SoT / migration / auth 路徑 / 共用 util）在 publish 或 commit 前要派 fresh-context checker subagent 複核——只讀 diff + spec，產出 PASS/FAIL + finding；gate 全綠是派 checker 的前置條件不是複核項；其餘任務不派；且碰 `rules/core/**`、`vendor/scripts/**`、`capabilities/core/**` 等 11 處
   - `rules/manual-review.backend.md`：Manual Review backend 規約——backend-only change 特別規約 + 標準流程（含 verify channel baseline）；動 server / test / e2e / supabase 時 path-scoped 載入；且碰 `server/**/*.ts`、`packages/*/server/**/*.ts`、`test/**/*.ts` 等 7 處
   - `rules/manual-review.data-readiness.md`：Manual Review data-readiness 規約——規劃階段（寫 plan package／tasks 時）準備驗收資料的 hard rule、[review:ui] 純功能驗證 step actionability、fixtures 檔契約（自獨立 fixtures 規約併入）、`@no-manual-review-check` marker schema、截圖檔名配對；寫 proposal.md / tasks.md 時 path-scoped 載入；且碰 `tasks/**`、`specs/plans/**`、`screenshots/**` 等 6 處
   - `rules/manual-review.evidence.md`：Manual Review evidence 規約——寫 / 審 tasks.md 的；且碰 `tasks/**`、`specs/plans/**`
   - `rules/manual-review.md`：人工檢查（Manual Review）主檔——核心 invariant、Item Kind Marker、annotation schema、[discuss] walkthrough、Parent State Derivation、Post-Edit Gate；有進行中的 work item（動 tasks/**、specs/plans/**）或在整理 screenshots 時載入；且碰 `tasks/**`、`specs/plans/**`、`screenshots/**`
   - `rules/playwright-webserver.md`：Playwright E2E webServer MUST CI-safe — 優先 @nuxt/test-utils golden 或 CI-conditional nuxt preview，NEVER 讓 CI 路徑跑依賴本地 .env / tunnel / 多程序的 dev script；且碰 `playwright.config.ts`、`playwright.config.js`、`**/playwright.config.ts`
   - `rules/review-tiers.md`：Review tiers 規則——依變更規模與風險決定規格／實作一致性審查與獨立 code review 的最低要求；且碰 `specs/plans/**`、`specs/truth/**`、`.claude/agents/**` 等 7 處
   - `rules/runtime/agent-self-verification.md`：Claude native evidence carrier
   - `rules/runtime/agent-self-verification.screenshot-evidence.md`：收 verify:ui / review:ui 視覺 evidence 的操作規約——截圖與驗證同一個 Bash call、(a)–(e) 五層驗證的 canonical pattern、seed fixture 必須進 seed.sql、worktree .env 先驗再宣稱缺、既有 [x] 要自拍佐證、UI 改動後全批重拍、`(deferred:)` failure trail 逐字範例、收尾前 receipt 齊全核對、截圖收集與符合性判定分兩步；且碰 `screenshots/**`、`specs/plans/**/tasks.md`、`app/**/*.vue` 等 13 處
   - `rules/runtime/checker-subagent.md`：高擴散半徑改動（跨 consumer 共用 SoT / migration / auth 路徑 / 共用 util）在 publish 或 commit 前 MUST 派 fresh-context checker subagent 複核——只讀 diff + spec，產出 PASS/FAIL + finding；gate 全綠是派 checker 的前置條件不是複核項；其餘任務不派；且碰 `rules/core/**`、`vendor/scripts/**`、`capabilities/core/**` 等 11 處
   - `rules/runtime/manual-review.backend.md`：Manual Review backend 規約——backend-only change 特別規約 + 標準流程（含 verify channel baseline）；動 server / test / e2e / supabase 時 path-scoped 載入；且碰 `server/**/*.ts`、`packages/*/server/**/*.ts`、`test/**/*.ts` 等 7 處
   - `rules/runtime/manual-review.data-readiness.md`：Manual Review data-readiness 規約——規劃階段（寫 plan package／tasks 時）準備驗收資料的 hard rule、[review:ui] 純功能驗證 step actionability、fixtures 檔契約、`@no-manual-review-check` marker schema、截圖檔名配對；寫 proposal.md / tasks.md 時 path-scoped 載入；且碰 `tasks/**`、`specs/plans/**`、`screenshots/**` 等 6 處
   - `rules/runtime/manual-review.evidence.md`：Manual Review evidence 規約——寫 / 審 tasks.md 的；且碰 `tasks/**`、`specs/plans/**`
   - `rules/runtime/manual-review.md`：人工檢查（Manual Review）主檔——核心 invariant、Item Kind Marker、annotation schema、[discuss] walkthrough、Parent State Derivation、Post-Edit Gate；有進行中的 work item（動 tasks/**、specs/plans/**）或在整理 screenshots 時載入；且碰 `tasks/**`、`specs/plans/**`、`screenshots/**`
   - `rules/runtime/screenshot-strategy.md`：Screenshot strategy 規則——根據互動深度、跨裝置、跨瀏覽器與是否要沉澱成回歸測試，選擇 target adapter carrier 或 reproducible runner CLI；且碰 `screenshots/**`、`tests/e2e/**`、`packages/*/tests/e2e/**` 等 4 處
   - `rules/runtime/verification-lease.spec.md`：Runtime adapter fragment for verification-lease.spec.md；且碰 `.claude/consumer-meta.json`、`scripts/dev-session*`、`scripts/dev-singleton*` 等 5 處
   - `rules/screenshot-strategy.md`：Screenshot strategy 規則——根據互動深度、跨裝置、跨瀏覽器與是否要沉澱成回歸測試，選擇 target adapter carrier 或 reproducible runner CLI；且碰 `screenshots/**`、`tests/e2e/**`、`packages/*/tests/e2e/**` 等 4 處
   - `rules/test-scripts.md`：Vitest multi-project test script 設計規範——禁止寫死 path filter 導致單檔測試靜默跳過；且碰 `package.json`、`vitest.config.ts`、`vite.config.ts`
   - `rules/testing-anti-patterns.md`：Testing anti-patterns to avoid — mock 濫用、test-only production methods、不完整 mock、unit test 何時寫（U1–U5）、E2E fixture 寫死絕對日期、測試碼品質低於生產碼、抄本測試（期望值在測試裡重算）、刪除或合併既有測試、孤兒測試（沒被 CI 收進去）、測試結構契約、測試逾時紅（負載假紅、放寬逾時數值）；且碰 `test/**/*.ts`、`**/*.{test,spec}.{ts,tsx,js,mjs,cjs,mts,cts}`、`packages/*/test/**/*.ts` 等 10 處
   - `rules/truth-layers.md`：Optional truth-layers 規則——適用於有明確 persistence / contract / API / UI 分層的專案，定義每一層的真相來源；且碰 `specs/**`、`tasks/**`、`ROADMAP.md` 等 11 處
   - `rules/verification-lease.md`：要起 dev server、跑 e2e 或佔用 port 之前
   - `rules/verification-lease.spec.md`：verification lease 的機制規格——五元組欄位、lease 檔位置與 schema、claim / release / force-takeover 的行為、holder identity 解析、哪些工具必須讀寫 lease、與 consumer-meta leaseMode 的關係；且碰 `.claude/consumer-meta.json`、`scripts/dev-session*`、`scripts/dev-singleton*` 等 5 處
   - `rules/verify-gate-chain.md`：自主迴圈的驗證閘門鏈與停止條件——每個 iterate-until-green 迴圈要跑 gate chain、宣告 max_iterations、定義 escalation action；且碰 `**/*.ts`、`**/*.vue`、`**/*.tsx` 等 9 處

## Phase 2 -- 只讀候選 rule 中與任務相關的段落

1. READ `rules/_sections.md` 中候選 rule 的區塊（首行 `<file> — `、空行結束；用 Grep 加 `-A 40` 取（區塊最長約 38 行，讀到空行為止，其後是下一份 rule 的區塊），NEVER 整份讀索引），只挑與任務相關的段落，用 Read 的 offset／limit 讀該行號區間。
2. READ 標題看不出相關與否的 rule 才整份讀；NEVER 用條件清單或段落索引代替 rule 內文。
