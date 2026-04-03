# 文件索引

本專案所有開發文件的索引。

## 架構（docs/architecture/）

系統架構與設計決策。

| 文件                  | 說明                           |
| --------------------- | ------------------------------ |
| `SYSTEM_OVERVIEW.md`  | 系統架構概覽（技術堆疊、資料流）|
| `NUXT_LAYERS.md`      | Nuxt Layers 多介面架構         |
| `CACHE_STRATEGY.md`   | 雙層快取策略（SWR + Server）   |

## 認證（docs/auth/）

認證與授權相關文件。

| 文件                   | 說明                               |
| ---------------------- | ---------------------------------- |
| `AUTH_INTEGRATION.md`  | nuxt-auth-utils Cookie Session 架構 |
| `OAUTH_SETUP.md`       | OAuth Provider 設定（Google 等）   |
| `USER_ROLES_RBAC.md`   | 角色權限模型 + 白名單機制          |

## 資料庫（docs/database/）

| 文件                       | 說明                                   |
| -------------------------- | -------------------------------------- |
| `MIGRATION_GUIDE.md`       | Migration 工作流（Local-First）        |
| `RLS_POLICY_TEMPLATES.md`  | RLS 政策模板 + TO public 陷阱          |
| `CURSOR_PAGINATION.md`     | Cursor + Offset 雙模式分頁            |

## API（docs/api/）

| 文件                   | 說明                                   |
| ---------------------- | -------------------------------------- |
| `API_DESIGN_GUIDE.md`  | API 設計模式（Zod 驗證、目錄結構）     |
| `ERROR_HANDLING.md`    | 錯誤處理（validateOrThrow、toastError）|
| `LOGGING.md`           | 結構化日誌（useLogger、log.error 規範）|

## 前端（docs/frontend/）

| 文件                     | 說明                           |
| ------------------------ | ------------------------------ |
| `COMPOSABLE_PATTERNS.md` | Vue 3 Composable 設計模式      |
| `MIDDLEWARE.md`           | Server + Client 中間件結構     |

## 踩坑紀錄（docs/gotchas/）

已知的框架/平台陷阱與解法。詳見 `docs/gotchas/README.md`。

| 文件                         | 說明                             |
| ---------------------------- | -------------------------------- |
| `CF_WORKERS_BODY_STREAM.md`  | Request body 只能讀一次          |
| `CF_WORKERS_SUBREQUEST.md`   | 50 subrequest 限制               |
| `PINIA_COLADA_TIMING.md`     | Cache invalidation 時序問題      |
| `USEQUERY_ENABLED_GUARD.md`  | useQuery 必須加 enabled 守衛     |
| `API_RESPONSE_OMISSION.md`   | API 回應欄位遺漏                 |

## 歷史經驗（docs/solutions/）

問題解決經驗知識庫。由 Claude 自動萃取和搜索。詳見 `docs/solutions/README.md`。

## 指南（docs/guide/）

頂層入門與流程指南。

| 文件                       | 說明                           |
| -------------------------- | ------------------------------ |
| `WORKFLOW.md`              | 開發工作流程                   |
| `TEAM_WORKFLOW.md`         | 團隊協作流程                   |
| `NEW_PROJECT_CHECKLIST.md` | 新專案檢查清單                 |
| `FAQ.md`                   | 常見問題                       |
| `TROUBLESHOOTING.md`       | 疑難排解                       |
| `DEPLOYMENT.md`            | 部署指南                       |
| `OPENSPEC.md`              | OpenSpec / Spectra 工作流      |

> Starter 展示文件（QUICK_START, FIRST_CRUD, READING_GUIDE, TECH_STACK, SUPABASE_GUIDE 等）位於 repo root `docs/`。

## 驗證文件（docs/verify/）

記錄**目前狀態**的技術規格，不記錄迭代歷史。使用現在式，不加時間戳。

> 注意：部分 verify/ 檔案已遷移至上方分類目錄，此處保留尚未遷移的檔案。

## 範本（docs/templates/）

專案範本檔案（GitHub workflows 等）。
