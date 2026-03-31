---
description: 資料庫存取模式（Supabase client/server 分工）
globs: ['app/**/*.{vue,ts}', 'server/**/*.ts']
---

# Database Access Pattern

- **Client**: READ only via `useSupabaseClient<Database>()` — **僅限 RLS SELECT `TO public` 的表**
- **Server**: ALL writes + RLS `TO authenticated` 表的讀取 via `/api/v1/*` endpoints
- **NEVER** `.insert()/.update()/.delete()/.upsert()` from client
- **NEVER** client 直讀 RLS `TO authenticated` 的表 — `anon` 角色會靜默回傳 0 筆（見 `supabase-rls` skill）

## MCP 存取

- **Dev** 查詢用 `local-supabase` MCP
- **NEVER** 使用 Kong port 8001 — Studio introspection 會觸發 PostgREST pool 重建，導致 REST API 中斷
- **NEVER** 在上班時間 `docker restart` 任何 Supabase 容器

## Production MCP 安全規範

若專案有 production MCP（透過 Studio port 3001），以下規則適用：

### 根因分析（來自 TDMS 2026-03-31 事故）

Production 主機若同時承載 Cloudflare Tunnel（cloudflared）和 Supabase，任何佔用頻寬或資源的操作都會影響 production：

1. **MCP 密集查詢** → Studio schema introspection → `NOTIFY pgrst` → PostgREST pool 重建 → REST API 間歇中斷
2. **SSH 大量傳輸**（pg_dump、SCP）→ Tailscale relay 頻寬飽和 → cloudflared DNS timeout → Tunnel 斷線 → 全站不可用
3. **兩者疊加**時影響最嚴重

### 絕對禁止（任何時段）

- **NEVER** 用 production MCP 做 bulk data dump 或連續超過 5 次查詢
- **NEVER** 用 Agent/subagent 自動化批量查詢 production MCP
- **NEVER** 對 production 主機執行 `pg_dump`、大量 `\COPY`、或任何長時間 SSH 資料傳輸
- **NEVER** 對 production 主機平行 SSH/SCP 連線

### Production MCP 允許

- 單次少量查詢（≤5 次/對話）：確認 schema、檢查特定記錄、緊急除錯

### Seed 資料正確做法

**NEVER** 從 Claude Code 直接 dump production 資料。正確流程：

1. SSH 到遠端主機，dump 到遠端本地檔案（不經過網路傳輸）
2. 在非上班時間 SCP 回本機
3. 手動整理後更新 seed.sql
4. seed.sql 使用 INSERT 格式（非 COPY FROM stdin），加 `SET session_replication_role = replica;` 和 `TRUNCATE CASCADE`
