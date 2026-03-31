---
description: 遠端 Supabase MCP 使用限制
globs: ['supabase/migrations/**/*.sql', 'server/**/*.ts']
---

# MCP Remote Database

- **NEVER** use MCP `apply_migration` to create tables/indexes
- **NEVER** use MCP `execute_sql` for DDL (CREATE/ALTER/DROP)
- MCP uses `supabase_admin` role → creates objects with wrong owner → CI/CD fails
- **ONLY** use remote MCP for: SELECT queries, debugging, checking table owners
- **ALL DDL must go through migration files + CI/CD**

## Production MCP 安全（透過 Studio port 3001 的 MCP）

Studio MCP 每次連線/查詢會觸發 schema introspection → `NOTIFY pgrst` → PostgREST connection pool 重建。
密集查詢（>5 次/對話）會導致 REST API 間歇中斷。

| 場景               | 禁止                                   | 正確做法                          |
| ------------------ | -------------------------------------- | --------------------------------- |
| Dump seed 資料     | MCP 批量 SELECT / SSH pg_dump 直接串流 | 遠端 dump 到檔案 → 非上班時間 SCP |
| 查 production 資料 | MCP 連續查詢                           | SSH → psql 單次短查詢（≤10 秒）   |
| Schema 確認        | MCP list_tables                        | SSH → `psql -c "\dt schema.*"`    |
| 監控/健康檢查      | MCP                                    | SSH → `docker ps` / `docker logs` |
| 緊急除錯           | -                                      | MCP ≤5 次查詢，或 SSH psql        |
