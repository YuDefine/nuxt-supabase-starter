---
description: 跨 consumer prod MCP 安全 hard rule（prod Supabase MCP 的 client 端封鎖＋server 端 read_only）
---
<!-- Clade native rule; source: rules/core/prod-mcp-safety.md; edit canonical source -->
<!-- clade-targets: claude,agents -->
# Prod MCP Safety

## Prod Supabase MCP Permission

**每一個** consumer、**每一個** agent runtime 指向 production Supabase 的 MCP 連線（`prod-supabase`、`<client-1>-prod-supabase` 等任何命名），都 **MUST** 封鎖 `execute_sql` 與 `apply_migration`，且 URL **MUST** 帶 `read_only=true`——server 端唯讀是加一層，**NEVER** 取代 client 端封鎖。新增、啟用或同步該連線前，核對當前產品入口的原生封鎖設定；缺少可驗證的封鎖機制時，不啟用該連線並回報能力缺口。
**逐端設定表（Claude 的封鎖鍵）、只能 `deny` 的逐字禁令、server 端唯讀的版本條件與驗收、整批交易語義與偵測入口，在 [[prod-mcp-safety.enforcement]]**（path-scoped：碰 `.mcp.json` / `.claude/settings.json` 時載入）。

需要 prod 資料或要修 prod 資料時，**NEVER** 去解開上面的封鎖，也 **NEVER** 改走 ssh／psql 直連：讀用 `node scripts/prod-sql.ts read`（專用唯讀角色，免提示），寫用 `prod-sql plan` → `apply`（誰要同意照 [[prod-access]] § 誰要同意）。開始前 **MUST** 讀 [[prod-access]]：`apply` 的適用範圍與當下限制只寫在那裡。
