# 文件導讀指南

這份指南面向 GitHub 訪客與新加入的開發者。預設閱讀策略是 **Clean-first**：先建立乾淨開發起點，Demo 僅作選配體驗。

---

## 文件分層

### Root docs（對外入口，先讀）

| 層級        | 目的           | 文件                                                                                                                                                                          | 何時閱讀                 |
| ----------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| **L1 入門** | 快速上手       | [README.md](../README.md), [QUICK_START.md](QUICK_START.md), [FIRST_CRUD.md](FIRST_CRUD.md), [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md), [VISUAL_GUIDE.md](VISUAL_GUIDE.md) | 第一次接觸此 repository |
| **L2 補充** | 開發與工具設定 | [SUPABASE_GUIDE.md](SUPABASE_GUIDE.md), [CLAUDE_CODE_GUIDE.md](CLAUDE_CODE_GUIDE.md), [CLI_SCAFFOLD.md](CLI_SCAFFOLD.md), [TECH_STACK.md](TECH_STACK.md)                    | 已能啟動專案後           |

### template/docs（實作細節，按需深入）

| 類型            | 文件                                                                                                                                                                                                 | 用途                   |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 開發流程        | [WORKFLOW.md](../template/docs/WORKFLOW.md), [DEBUGGING.md](../template/docs/DEBUGGING.md), [TEAM_WORKFLOW.md](../template/docs/TEAM_WORKFLOW.md)                                                 | TDD、除錯、團隊流程     |
| API 與部署      | [API_PATTERNS.md](../template/docs/API_PATTERNS.md), [DEPLOYMENT.md](../template/docs/DEPLOYMENT.md), [TROUBLESHOOTING.md](../template/docs/TROUBLESHOOTING.md)                                   | API 模式、上線與疑難排解 |
| 系統狀態（SSOT） | [template/docs/verify/README.md](../template/docs/verify/README.md)                                                                                                                                 | 查核目前狀態與規範基線 |
| Spec 流程       | [OPENSPEC.md](../template/docs/OPENSPEC.md), [README.md](../template/docs/README.md)                                                                                                                | Spectra 與文件總覽      |

### AI 配置（給會用 Claude 的開發者）

| 類型     | 用途                                        | 位置                        |
| -------- | ------------------------------------------- | --------------------------- |
| 總規範   | 開發規則                                    | [CLAUDE.md](../CLAUDE.md)   |
| Commands | 可執行命令（`/commit`, `/db-migration` 等） | `.claude/commands/*.md`     |
| Agents   | 自動化流程（check-runner 等）               | `.claude/agents/*.md`       |
| Skills   | 專業知識（43 個）                           | `.claude/skills/*/SKILL.md` |

---

## 推薦閱讀路徑

### 新專案（推薦：Clean-first）

```
README.md（5 分鐘）
    ↓ 了解專案定位與技術棧
QUICK_START.md（15 分鐘）
    ↓ 完成安裝、設定、首次啟動
執行 create-clean（5 分鐘）
    ↓ 移除 demo，保留可持續開發骨架
FIRST_CRUD.md（15 分鐘）
    ↓ 建立第一個完整功能（DB → API → UI → Test）
WORKFLOW.md（10 分鐘）
    ↓ 對齊 TDD 與開發節奏
```

### 新專案（選配：先看 Demo）

```
VISUAL_GUIDE.md（5 分鐘）
    ↓ 先看整體頁面與流程
QUICK_START.md（15 分鐘）
    ↓ 完成環境設定
create-clean（建議在正式開發前執行）
```

### 現有專案整合

```
INTEGRATION_GUIDE.md（20 分鐘）
    ↓ 注入 Claude / Supabase 能力
CLAUDE_CODE_GUIDE.md（按需）
    ↓ 微調 Commands、Hooks、Skills
```

---

## 進階主題（按需閱讀）

| 主題           | 文件                                                                                                                    |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 認證系統       | [AUTH_INTEGRATION.md](../template/docs/verify/AUTH_INTEGRATION.md)                                                    |
| Migration 操作 | [SUPABASE_MIGRATION_GUIDE.md](../template/docs/verify/SUPABASE_MIGRATION_GUIDE.md)                                    |
| RLS 設計       | [RLS_BEST_PRACTICES.md](../template/docs/verify/RLS_BEST_PRACTICES.md)                                                |
| Pinia 架構     | [PINIA_ARCHITECTURE.md](../template/docs/verify/PINIA_ARCHITECTURE.md)                                                |
| 資料庫效能     | [DATABASE_OPTIMIZATION.md](../template/docs/verify/DATABASE_OPTIMIZATION.md)                                          |
| 部署上線       | [DEPLOYMENT.md](../template/docs/DEPLOYMENT.md)                                                                        |
| 疑難排解       | [TROUBLESHOOTING.md](../template/docs/TROUBLESHOOTING.md)                                                              |

---

## 快速查詢

| 問題                     | 答案在                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| 專案用了哪些技術？       | [README.md](../README.md)                                                                                          |
| 怎麼開始開發？           | [QUICK_START.md](QUICK_START.md)（新專案）或 [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md)（現有專案）            |
| TDD 流程是什麼？         | [WORKFLOW.md](../template/docs/WORKFLOW.md)                                                                        |
| 認證怎麼做？             | [AUTH_INTEGRATION.md](../template/docs/verify/AUTH_INTEGRATION.md)                                                |
| Migration 怎麼建立？     | [SUPABASE_MIGRATION_GUIDE.md](../template/docs/verify/SUPABASE_MIGRATION_GUIDE.md)                                |
| Client/Server 怎麼分工？ | [CLAUDE.md](../CLAUDE.md)                                                                                          |
| Spectra 怎麼用？         | [OPENSPEC.md](../template/docs/OPENSPEC.md)                                                                        |
| 常見問題？               | [FAQ.md](../template/docs/FAQ.md)                                                                                  |

---

## 下一步

1. **新手**：先讀 [QUICK_START.md](QUICK_START.md)，再做 [FIRST_CRUD.md](FIRST_CRUD.md)。
2. **要對齊開發流程**：讀 [WORKFLOW.md](../template/docs/WORKFLOW.md)。
3. **準備部署**：讀 [DEPLOYMENT.md](../template/docs/DEPLOYMENT.md)。
4. **遇到問題**：看 [FAQ.md](../template/docs/FAQ.md) 或 [TROUBLESHOOTING.md](../template/docs/TROUBLESHOOTING.md)。
