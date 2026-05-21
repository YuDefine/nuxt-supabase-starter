---
description: 遠端 Supabase MCP 使用限制
paths: ['supabase/migrations/**/*.sql', 'server/**/*.ts']
---
<!--
🔒 LOCKED — managed by clade
Source: rules/modules/db-runtime/cf-workers/mcp-remote.md
Edit at: /Users/charles/offline/clade
Local edits will be reverted by the next sync.
-->


# MCP Remote Database

- **NEVER** use MCP `apply_migration` to create tables/indexes
- **NEVER** use MCP `execute_sql` for DDL (CREATE/ALTER/DROP)
- MCP uses `supabase_admin` role → creates objects with wrong owner → CI/CD fails
- **ONLY** use remote MCP for: SELECT queries, debugging, checking table owners
- **ALL DDL must go through migration files + CI/CD**

## Production MCP 安全（若有 production MCP）

Studio MCP 每次連線/查詢會觸發 schema introspection → `NOTIFY pgrst` → PostgREST connection pool 重建。
密集查詢（>5 次/對話）會導致 REST API 間歇中斷。

- **NEVER** 用 production MCP 做 bulk data dump 或連續超過 5 次查詢
- **NEVER** 用 Agent/subagent 自動化批量查詢 production MCP
- Production MCP 允許：單次少量查詢（≤5 次/對話）用於確認 schema、檢查特定記錄、緊急除錯
