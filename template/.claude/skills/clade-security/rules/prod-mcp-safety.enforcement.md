---
description: prod Supabase MCP 封鎖的逐端設定表（Claude `permissions.deny` / Codex `disabled_tools`）、只能 deny NEVER allow-or-ask 的逐字禁令、server 端 `read_only=true` 的版本條件與 `tools/list` 驗收、整批交易語義（任一端封鎖未證實則全部零寫入）、違反後果實證與偵測入口。觸發是「正在新增／啟用／同步 prod MCP 連線」，綁得到設定檔故 path-scoped
paths:
  [
    '.mcp.json',
    '.claude/settings.json',
    '.claude/settings.local.json',
    '.codex/config.toml',
  ]
---
<!-- Clade native rule; source: rules/core/prod-mcp-safety.enforcement.md; edit canonical source -->

<!-- clade-targets: claude,codex -->

# Prod MCP 封鎖的逐端設定與交易語義

> 本檔是 [[prod-mcp-safety]] 的 path-scoped sibling。那條 MUST（每一個 consumer、每一個 runtime 的
> production Supabase MCP 都 MUST 封鎖 `execute_sql` 與 `apply_migration`、URL MUST 帶 `read_only=true`）留在常駐層，
> **NEVER** 因為本檔沒載入就當作可以先啟用再說。

下表以 `prod-supabase` 為例；consumer 加前綴的命名（如 `<client-1>-prod-supabase`）把鍵裡的 server 名換掉，規則相同。

| 產品入口 | 封鎖設定 |
| --- | --- |
| Claude Code | `.claude/settings.json` 的 `permissions.deny`：`mcp__prod-supabase__execute_sql`、`mcp__prod-supabase__apply_migration`；同時檢查 `.claude/settings.local.json` |
| Codex | `.codex/config.toml` 的 `[mcp_servers.prod-supabase]`：`disabled_tools = ["execute_sql", "apply_migration"]`；保留其他既有封鎖項 |
| 其他入口 | 保持連線未啟用，先取得該入口的原生封鎖證據 |

Claude settings 中這兩個工具 **只能**放 `deny`，**NEVER** 放 `allow` 或 `ask`。`allow` 允許執行；`ask` 仍可經批准執行，都不等於封鎖。其他 runtime 同樣 **NEVER** 以 approval prompt 或一次人工同意代替工具封鎖。

## Server 端唯讀（`read_only=true`）

client 端封鎖只擋得住**載入了該設定**的 agent session；能連到 MCP endpoint 的其他行程不受它管。所以 prod 連線同時 **MUST** 讓 server 自己拒絕寫入：

- **設定**：`.mcp.json`（與其他 runtime 的同一條連線）的 URL 帶 `read_only=true` 查詢參數，例 `http://<host>:<port>/api/mcp?read_only=true`；URL 已有其他參數時用 `&` 接上
- **版本條件**：self-hosted Studio 低於 `2026.08.17` 會**忽略**這個參數（實測 MCP 0.5.x 的兩台 prod Studio 帶參數後仍列出 `apply_migration`／`execute_sql`）。URL 照樣要帶（無害、升版後立即生效），但此時**只有 client 端封鎖這一層**；把「prod Studio 待升到 ≥ `2026.08.17`」回報給該 consumer 的主機 owner，**NEVER** 把帶了參數讀成 server 已唯讀
- **驗收**：只送 `tools/list`（不呼叫任何 tool），結果**沒有** `apply_migration` 才算 server 端唯讀生效；仍列出 `apply_migration` → server 端唯讀未生效，照上一條回報

```bash
curl -s -X POST '<prod MCP URL，含 read_only=true>' -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | grep -oE '"name":"[a-z_]+"'
```

量法與 fleet 實測見 clade 中央倉 `vendor/snippets/supabase-select-2026/README.md` § 6。

## 跨端同步的交易語義、違反後果與偵測

中立 MCP 來源用 server 的 `requiredDeniedTools` 聲明必須封鎖的工具。來源聲明、投影成功與產品實際封鎖是三層證據。每次同步以**全部選定端**為一個交易：任何一端無法表示必要封鎖，**所有選定端的設定與 ownership receipt 均保持原狀，整批零寫入**。例如同批選 Claude Code 與另一個封鎖未證實的入口，Claude Code 也不寫入；要變更選定範圍，先明確重定範圍再另建完整計畫。**NEVER** 為了通過投影而刪掉必要封鎖，也不改寫 consumer 自有權限來消除 conflict。

違反後果：agent 可直接對 prod DB 執行 SQL（已實際發生過在 prod 建出孤兒表）。

偵測：`scripts/audit-tooling-drift.ts` 的 `prodMcpPermission` 靜態檢查兩件事——Claude `allow`／`ask` 有沒有放行寫入工具（`prod-mcp-unsafe`），以及 `.mcp.json` 的 prod URL 有沒有帶 `read_only=true`（`prod-mcp-not-read-only`）。它不是兩端封鎖有效性的驗收，也量不到 server 版本；server 端生效與否只認上方的 `tools/list` 驗收。原生 MCP 的作者操作與支援範圍見 clade 中央倉的 `docs/runtime-mcp.md`。

| REQUIRED 欄位 | 內容 |
| --- | --- |
| 觸發條件 | 具名 production 來源缺必要聲明，或選定端無法完整封鎖 → 原生 MCP planner 拒絕，整批不寫入 |
| 消費端 | 啟用／同步 MCP 的 agent 與原生 MCP CLI；依 diagnostic 修正來源或回報該產品的能力缺口 |
| 觸發點 | 本共同規約，經選用 runtime 的原生 rules 交付；設定轉換不取代入口的封鎖驗證 |
