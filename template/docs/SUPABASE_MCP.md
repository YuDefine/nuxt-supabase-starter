# Supabase MCP 整合指南

> 讓 Claude 直接操作 Supabase 資料庫

## 什麼是 Supabase MCP？

[MCP (Model Context Protocol)](https://modelcontextprotocol.io/) 是一個讓 AI 模型連接外部服務的協議。Supabase MCP 讓 Claude 可以：

- 列出資料表結構
- 執行 SQL 查詢
- 搜尋 Supabase 文件
- 取得資料庫建議（advisors）
- 查看 migration 歷史

這是 AI 輔助開發的關鍵組件——Claude 不再需要猜測你的資料庫結構，而是可以直接查看。

---

## 配置檔案

### .mcp.json（根目錄）

```json
{
  "mcpServers": {
    "local-supabase": {
      "type": "http",
      "url": "http://localhost:54321/mcp"
    }
  }
}
```

### .vscode/mcp.json（VS Code 整合）

```json
{
  "servers": {
    "local-supabase": {
      "url": "http://localhost:54321/mcp"
    }
  }
}
```

### .claude/settings.json（Claude Code 權限）

```json
{
  "permissions": {
    "allow": [
      "mcp__local-supabase__list_tables",
      "mcp__local-supabase__list_migrations",
      "mcp__local-supabase__execute_sql",
      "mcp__local-supabase__search_docs",
      "mcp__local-supabase__get_advisors"
    ]
  },
  "enabledMcpjsonServers": ["local-supabase"]
}
```

---

## 本地開發 vs 遠端

### Local Supabase（開發環境）

```json
{
  "local-supabase": {
    "url": "http://localhost:54321/mcp"
  }
}
```

**用途**：

- 日常開發
- 測試 migration
- 探索資料庫結構

**前提**：需要先執行 `supabase start`（本地模式；遠端模式請用 SSH）

### Remote Supabase Cloud（生產環境）

```json
{
  "remote-supabase": {
    "type": "http",
    "url": "https://mcp.supabase.com/mcp?project_ref=<your-project-ref>"
  }
}
```

**用途**：

- 查看生產資料庫結構
- 比對本地與遠端差異
- 除錯生產問題

**設定方式**：

1. 在 [Supabase Dashboard](https://supabase.com/dashboard) 取得 Project Ref
2. 替換 `<your-project-ref>`

### Self-hosted Supabase

```json
{
  "remote-supabase": {
    "type": "http",
    "url": "https://supabase-api.example.com/mcp"
  }
}
```

**用途**：

- 連接 Self-hosted Supabase 實例
- 查看 Self-hosted 資料庫結構
- 執行 SQL 查詢

**設定方式**：

1. 確認 Kong Gateway 有啟用 MCP 路由（Self-hosted 預設包含）
2. 設定 Cloudflare Tunnel 或 Nginx 將 `/mcp` 路由到 Kong
3. 替換 `example.com` 為實際 domain

**注意事項**：

- Self-hosted MCP 不需要 `project_ref` 參數
- 確保 MCP 端點有適當的存取控制
- 如需連接內網，建議使用 ZeroTier 或 Tailscale 等 VPN 方案直連 `http://<internal-ip>:<port>/mcp`

> 📖 完整 Self-hosted 設定請參考 [verify/SELF_HOSTED_SUPABASE.md](./verify/SELF_HOSTED_SUPABASE.md)

---

## Claude 可以做什麼？

### 1. 列出資料表

```
Claude：讓我看看資料庫有哪些表...
[使用 mcp__local-supabase__list_tables]

找到以下資料表：
- core.users (id, email, name, created_at)
- app.todos (id, user_id, title, completed)
- ...
```

### 2. 執行 SQL 查詢

```
Claude：讓我查詢一下 todos 表的結構...
[使用 mcp__local-supabase__execute_sql]

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'todos';
```

### 3. 查看 Migration 歷史

```
Claude：讓我看看已套用的 migrations...
[使用 mcp__local-supabase__list_migrations]

20250101000000_create_users.sql ✓
20250102000000_create_todos.sql ✓
```

### 4. 搜尋文件

```
Claude：RLS 政策要怎麼寫？
[使用 mcp__local-supabase__search_docs]

根據 Supabase 文件，RLS 政策的寫法是...
```

### 5. 取得建議

```
Claude：讓我檢查資料庫有沒有問題...
[使用 mcp__local-supabase__get_advisors]

建議：
- 表 todos 缺少 updated_at 欄位的索引
- RLS 政策建議使用 (SELECT ...) 包裝以提升效能
```

---

## 重要限制

### 禁止使用 apply_migration

```json
// ❌ 不要加入這個權限
"mcp__remote-supabase__apply_migration"
```

**原因**：

- 所有 migration 必須在本地建立、測試
- 使用 `supabase migration new` 建立
- 使用 `supabase db push` 推送到遠端

**正確流程**：

```bash
# 1. 本地建立 migration
supabase migration new create_todos_table

# 2. 編輯 SQL 檔案

# 3. 本地測試
pnpm db:reset
pnpm db:lint

# 4. 推送到遠端
supabase db push
```

> 📖 詳見 [MIGRATION_GUIDE.md](./database/MIGRATION_GUIDE.md)

---

## 設定步驟

### 1. 確認 Supabase 已啟動

```bash
supabase start
```

確認看到 MCP 端點：

```
         API URL: http://127.0.0.1:54321
             ...
```

### 2. 設定 Claude Code 權限

設定已包含在 `.claude/settings.json` 中，不需要額外複製。

### 3. 驗證連線

啟動 Claude Code，嘗試：

```
> 列出資料庫的所有表
```

如果成功，Claude 會使用 `mcp__local-supabase__list_tables` 列出表格。

---

## 進階：遠端 Supabase 設定

如果你需要連接生產資料庫：

### 1. 更新 .mcp.json

```json
{
  "mcpServers": {
    "local-supabase": {
      "type": "http",
      "url": "http://localhost:54321/mcp"
    },
    "remote-supabase": {
      "type": "http",
      "url": "https://mcp.supabase.com/mcp?project_ref=<your-project-ref>"
    }
  }
}
```

### 2. 更新 Claude Code 權限

在 `.claude/settings.json` 加入：

```json
{
  "permissions": {
    "allow": [
      // ... 現有權限 ...
      "mcp__remote-supabase__list_tables",
      "mcp__remote-supabase__list_migrations",
      "mcp__remote-supabase__execute_sql",
      "mcp__remote-supabase__get_advisors"
    ]
  },
  "enabledMcpjsonServers": ["local-supabase", "remote-supabase"]
}
```

### 3. 登入 Supabase

遠端 MCP 需要登入認證：

```bash
supabase login
```

---

## 常見問題

### Q: Claude 無法連接 MCP？

1. 確認 Supabase 已啟動：`supabase status`（本地模式）
2. 確認 `.mcp.json` 存在且格式正確
3. 確認 `.claude/settings.json` 有啟用 MCP

### Q: 權限錯誤？

確認 `enabledMcpjsonServers` 陣列包含你要使用的 server：

```json
"enabledMcpjsonServers": ["local-supabase"]
```

### Q: 遠端 MCP 無法連線？

1. 確認已執行 `supabase login`
2. 確認 project_ref 正確
3. 確認網路連線正常

---

## 相關文件

| 文件                                                                 | 說明                   |
| -------------------------------------------------------------------- | ---------------------- |
| [MIGRATION_GUIDE.md](./database/MIGRATION_GUIDE.md)                  | Migration 工作流       |
| [MCP 官方文件](https://modelcontextprotocol.io/)                     | Model Context Protocol |
| [Supabase MCP](https://supabase.com/docs/guides/getting-started/mcp) | Supabase MCP 文件      |
