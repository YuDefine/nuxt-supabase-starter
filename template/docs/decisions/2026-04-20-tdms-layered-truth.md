# TDMS Layered Truth for Starter

## Decision

Starter 預設採用「分層真相」而非單一 SSOT：

- **意圖層**：需求、限制、跨功能設計意圖放在 `openspec/project.md`、`openspec/specs/`、`docs/decisions/`
- **持久化層**：schema、constraint、RLS、trigger、function 只放在 `supabase/migrations/`
- **契約層**：request/response schema 與衍生型別以 `shared/schemas/*.ts` 為準；`shared/types/*.ts` 僅保留相容轉發或 view-model 型別
- **服務/API 層**：`server/api/**/*.ts` 先驗證輸入，再使用 `getSupabaseWithContext(event)` 進行 request-scoped 存取，回傳前必須用 response schema `parse()`
- **UI 狀態層**：`app/` 只消費契約，不重新定義業務規則或持久化限制

## Context

Starter 原本已經有 Zod、Supabase migration、Spectra 與 `.claude/rules/`，但幾個真相來源之間並未完全對齊：

- 規則要求 API 用 `getSupabaseWithContext(event)`，範例 handler 卻直接取 service-role client
- 文件同時把 `shared/types/` 與 `shared/schemas/` 都描述成 schema 來源，容易產生雙重維護
- 驗證步驟偏向型別與流程檢查，對 response contract drift 的保護不足

若要讓既有專案從 starter 學習，starter 本身必須先把規則、文件、範例程式收斂到同一模型。

## Alternatives Considered

- **維持隱含的 service-role-first 慣例** — 起步快，但會讓複製出去的專案把 RLS 與 request context 當成次要考量
- **只補文件，不補 runtime contract** — 成本低，但 response drift 仍然只能靠 review 發現
- **全面改成重量級 domain package 架構** — 長期最完整，但對 starter 來說改動過大，學習成本過高

## Reasoning

分層真相最適合 starter 的原因是它能同時服務兩件事：

- 讓新專案有一條清楚的預設路徑，不必自己決定 schema、response、migration、rules 誰說了算
- 讓既有專案可漸進吸收，只要從 response schema、request-scoped DB access、契約共址開始收斂，不必一次重構成完整 ERP 架構

## Trade-offs Accepted

- API handler 會多出 response schema 與 `parse()` 的樣板
- `shared/types/*.ts` 在過渡期仍然存在，增加一小段相容成本
- `getServerSupabaseClient()` 仍然保留給稽核、背景工作、修復腳本等特權情境，並非完全消失

## Supersedes

Supersedes the previous implicit convention that request handlers may default to direct service-role client usage without a request-scoped contract boundary.
