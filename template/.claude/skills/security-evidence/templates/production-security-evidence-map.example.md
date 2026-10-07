<!-- 改寫來源：Codex Security Bridge Kit Prompt 2（Production Blind-Spot Mapper）；改寫前的逐字版在 `git show bf08778b5c:capabilities/core/skills/security-evidence/references/production-blind-spot-mapper.md`，對照上游新版時從那份 diff -->
<!-- 虛構範例：一個 Nuxt＋Supabase＋Stripe＋AI 摘要功能的 SaaS，掃描回 No findings 後問能不能上線 -->

## Production 安全證據地圖

### Verdict 與範圍

- Verdict：BLOCKED
- 審查範圍：web app、`/api/**`、背景 worker；不含行銷站與內部後台
- 日期與 repo 狀態：2026-10-05，main@a1b2c3d
- 理由：AI 摘要 worker 呼叫 provider 沒有花費上限與停止機制（P0 未解）；production RLS 啟用狀態未確認
- 這個 verdict 不能證明什麼：scan 回 No findings 只涵蓋 `src/server/**`；即使 P0 解掉，也只代表上述範圍內的 P0／P1 有證據，不代表整個產品安全

### 各層 Coverage

#### Repository

- 已審查：scan Coverage（`src/server/**`）、`test/orders-owner.test.ts`、`src/workers/summarize.ts`
- 已確認：訂單 API 擁有者檢查有測試；Stripe webhook 有呼叫 `constructEvent`
- 排除或未知：`src/workers/**` 不在 scan 範圍；上傳檔驗證沒有測試

#### Staging

- 已完成的測試：無
- 還需要的測試：跨帳號讀訂單、webhook 重送、簽章錯誤的 webhook
- 與 production 的差異（哪些結論不能搬過去）：staging 的 Supabase 未啟用 RLS，跨帳號結果不能代表 production

#### Production

- 已確認的控制：無
- 還需要的檢查：`orders`／`profiles` RLS policy 清單；storage bucket 是否 private

#### Third Party 與 Operations

- 已審查的系統：Stripe（endpoint 清單）、AI provider（無）
- 還需要的檢查：AI provider 花費上限；告警與備份還原演練紀錄

### 依優先序的證據清單

#### P0 Blockers

- 安全規則或風險：AI 摘要 worker 的付費呼叫必須有上限
  - 層：Third Party
  - 預期控制：provider 後台設月度花費上限，worker 有每使用者每日次數限制
  - 通過條件：後台顯示上限金額；worker 超過次數回 429
  - 目前證據：`src/workers/summarize.ts` 無任何次數限制（Repository）
  - 狀態：Unknown
  - Proof Gap：provider 後台是否已設上限
  - 安全蒐證方式：請 owner 截圖 provider billing limit 頁（不含 API key）
  - Owner：Owner Missing
  - 期限：上線前

#### P1 Before Launch

- 安全規則或風險：使用者只能讀自己的訂單（production 層）
  - 層：Production
  - 預期控制：`orders_owner_select` policy 啟用
  - 通過條件：policy 清單中該 policy 存在且 enabled
  - 目前證據：repo 層有測試；production 未看
  - 狀態：Needs Production Check
  - Proof Gap：production 是否已套用該 migration
  - 安全蒐證方式：有 DB dashboard 權限者截 policy 清單（名稱與 USING 條件）
  - Owner：王小明（使用者指定）
  - 期限：2026-10-08

#### P2 Hardening

- 安全規則或風險：備份還原演練
  - 層：Operations
  - 預期控制：每季一次還原到臨時專案並核對筆數
  - 通過條件：最近 90 天內有演練紀錄
  - 目前證據：無
  - 狀態：Unknown
  - Proof Gap：是否曾演練
  - 安全蒐證方式：詢問 owner 並取得演練紀錄連結
  - Owner：Owner Missing
  - 期限：上線後 30 天

### 外部副作用與 agent 控制

- 外部動作：AI 摘要 worker 呼叫付費 provider
  - 權限邊界：worker 持有全域 API key
  - 核准條件：無
  - 花費或速率上限：未知
  - 停止機制：無（只能撤 key）
  - 證據狀態：Unknown

### 最先做的三件事

1. 確認 AI provider 花費上限
   - 為什麼先做：唯一的 P0，截一張圖就能下定論
   - 會產出的證據：billing limit 截圖
2. 截 production `orders`／`profiles` RLS policy 清單
3. 在 staging 補跑簽章錯誤的 webhook 測試

### 殘餘風險

- 已知且接受的風險：無
- 由誰接受：—
- 複審日期：—
