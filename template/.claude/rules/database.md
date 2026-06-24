---
description: 跨 consumer database 安全 hard rule（prod MCP tool permission 等）
---
<!--
🔒 LOCKED — managed by clade
Source: rules/core/database.md
Edit at: <clade-central-repo>
Local edits will be reverted by the next sync.
-->


# Database Safety

## Prod Supabase MCP Permission

**MUST**：`mcp__prod-supabase__execute_sql` 和 `mcp__prod-supabase__apply_migration` 在 Claude Code settings（`.claude/settings.json` / `.claude/settings.local.json`）**只能**放 `deny`。

**NEVER** 放 `allow` 或 `ask` — `allow` = Claude 不經確認即可對 prod DB 執行任意 SQL；`ask` = 一次 approve 後同 session 不再問。

違反後果：<consumer-d> prod DB 被建立孤兒表 `public.sutekh`（2026-06-22）。

偵測：`scripts/audit-tooling-drift.mjs` `prodMcpPermission` signal。
