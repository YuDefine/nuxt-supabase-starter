---
description: 遠端 Supabase MCP 使用限制
globs: ['supabase/migrations/**/*.sql', 'server/**/*.ts']
---

# MCP Remote Database

- **NEVER** use `mcp__remote-supabase__apply_migration` to create tables/indexes
- **NEVER** use `mcp__remote-supabase__execute_sql` for DDL (CREATE/ALTER/DROP)
- MCP uses `supabase_admin` role → creates objects with wrong owner → CI/CD fails
- **ONLY** use remote MCP for: SELECT queries, debugging, checking table owners
- **ALL DDL must go through migration files + CI/CD**
