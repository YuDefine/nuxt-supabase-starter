---
description: 同步更新 docs/verify/ 文件，確保文件反映當前系統狀態
---
<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/commands/doc-sync.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->


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

各 consumer 的 `docs/verify/` 結構不同，執行此 command 前**先讀** consumer 自己的 `docs/verify/README.md` 取得當前清單，再依使用者描述的變更類型對照需要更新的檔案。**禁止**根據此 command 內嵌假設的清單去更新；該清單會隨 consumer 演化而漂移。
