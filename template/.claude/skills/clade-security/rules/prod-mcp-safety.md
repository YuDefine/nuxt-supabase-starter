---
description: 跨 consumer prod MCP 安全 hard rule（prod Supabase MCP 的 client 端封鎖＋server 端 read_only）
---
<!-- Clade native rule; source: rules/core/prod-mcp-safety.md; edit canonical source -->
<!-- clade-targets: claude,codex -->
# Prod MCP Safety

## Prod Supabase MCP Permission

**每一個** consumer、**每一個** agent runtime 指向 production Supabase 的 MCP 連線（`prod-supabase`、`<client-1>-prod-supabase` 等任何命名），都 **MUST** 封鎖 `execute_sql` 與 `apply_migration`，且 URL **MUST** 帶 `read_only=true`——server 端唯讀是加一層，**NEVER** 取代 client 端封鎖。新增、啟用或同步該連線前，核對當前產品入口的原生封鎖設定；缺少可驗證的封鎖機制時，不啟用該連線並回報能力缺口。
**逐端設定表（Claude / Codex 各自的封鎖鍵）、只能 `deny` 的逐字禁令、server 端唯讀的版本條件與驗收、整批交易語義與偵測入口，在 [[prod-mcp-safety.enforcement]]**（path-scoped：碰 `.mcp.json` / `.claude/settings.json` / `.codex/config.toml` 時載入）。
