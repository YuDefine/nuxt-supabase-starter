---
description: 同步更新 docs/verify/ 文件，確保文件反映當前系統狀態
---

## User Input

```text
$ARGUMENTS
```

## Outline

更新 `docs/verify/` 目錄下的文件，確保反映系統的當前狀態。

### Step 1: 識別需要更新的文件

根據最近的變更，判斷哪些文件需要更新：

| 變更類型      | 對應文件                                            |
| ------------- | --------------------------------------------------- |
| 環境變數      | ENVIRONMENT_VARIABLES.md                            |
| 認證流程      | AUTH_INTEGRATION.md, OAUTH_SETUP.md                 |
| 資料庫 schema | SUPABASE_MIGRATION_GUIDE.md, MONITORING_TABLES.md   |
| RLS 政策      | RLS_PERFORMANCE_OPTIMIZATION.md                     |
| 使用者角色    | USER_ROLES_AUTH.md                                  |
| Pinia store   | PINIA_ARCHITECTURE.md                               |
| 部署流程      | REMOTE_DEPLOYMENT.md, CLOUDFLARE_WORKERS_GOTCHAS.md |

### Step 2: 讀取現有文件

讀取需要更新的文件，了解目前內容。

### Step 3: 更新文件

遵循 docs/verify/ 的寫作原則：

#### ✅ 正確寫法

- 使用**現在式**：描述「系統目前是什麼」
- **移除時間標記**：不要寫「2025-01-13 更新」
- **專注於狀態**：記錄配置、設定、架構
- **直接覆寫**：狀態改變時直接覆寫舊描述

#### ❌ 錯誤寫法

- ~~本次更新：修正了 X 問題~~
- ~~2025-01-13 更新~~
- ~~原本是 A，現在改成 B~~

### Step 4: 驗證文件

確認更新後的文件：

1. 格式正確（Markdown）
2. 連結有效
3. 程式碼範例可執行
4. 與實際程式碼一致

### Step 5: 更新 README

如果新增了文件或變更了結構，更新 `docs/verify/README.md` 的目錄。

### Step 6: 完成報告

```text
✅ 文件同步完成！

## 已更新文件

| 文件 | 變更摘要 |
|------|----------|
| XXX.md | 更新了 YYY 章節 |
| ZZZ.md | 新增了 AAA 說明 |

## 變更預覽

[顯示 git diff 摘要]

建議：執行 `pnpm docs:dev` 預覽文件網站。
```

## 文件清單

目前 docs/verify/ 包含：

- README.md - 開發手冊（主文件）
- QUICK_START.md - 快速開始
- AUTH_INTEGRATION.md - 認證整合
- CLOUDFLARE_WORKERS_GOTCHAS.md - CF Workers 注意事項
- DATABASE_PERFORMANCE_OPTIMIZATION.md - 資料庫效能
- EMAIL_WHITELIST.md - Email 白名單
- ENVIRONMENT_VARIABLES.md - 環境變數
- MONITORING_TABLES.md - 監控表結構
- OAUTH_SETUP.md - OAuth 設定
- PINIA_ARCHITECTURE.md - Pinia 架構
- REMOTE_DEPLOYMENT.md - 遠端部署
- RLS_PERFORMANCE_OPTIMIZATION.md - RLS 效能
- SENTRY_CONFIGURATION.md - Sentry 設定
- SUPABASE_ARCH_GUIDELINES.md - Supabase 架構
- SUPABASE_BACKUP_RESTORE.md - 備份還原
- SUPABASE_MIGRATION_GUIDE.md - Migration 指南
- SUPABASE_STUDIO_WORKFLOW.md - Studio 工作流程
- TEST_DRIVEN_DEVELOPMENT.md - TDD 指南
- USER_PREFERENCES.md - 使用者偏好
- USER_ROLES_AUTH.md - 使用者角色
