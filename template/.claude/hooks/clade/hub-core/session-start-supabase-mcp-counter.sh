#!/usr/bin/env bash
# SessionStart hook — self-hosted Supabase consumer 的 dev-supabase MCP 反向說明。
#
# 防的失敗類別：Supabase Studio 的 /api/mcp 在 initialize 回的 server instructions 寫
# 「Prefer local development／starting a local stack」，Claude Code 每個 session 把它常駐進
# system prompt。這段文字是 MCP server 端內容，clade 的 MCP 投影（.clade/runtime/mcp.json →
# .mcp.json）只有 transport／url／env／requiredDeniedTools，沒有任何覆寫或抑制 instructions 的
# 欄位，移除 dev-supabase MCP 又會失去 dev 的唯讀查詢能力。所以在同一個常駐面（session 開頭）
# 補一句反向說明；失敗點的硬保證仍是 pre-bash-supabase-local-gate.sh（PreToolUse）。
# 契約見 rules/modules/db-runtime/supabase-self-hosted/db-topology-invariant.md。
#
# 另一行是 observability.md（audit 基線，自稱 always-load）的無條件交付面：違反發生在不碰 repo 檔的流程
# （ops、鑑識、資安盤點），沒有任何工具事件可接，只剩 session 開頭能 pointer 級帶到。該規約明文禁止用
# manifest db-runtime 判適用與否（cf-workers consumer 的 production 仍可能是自架 Supabase），所以這一行對
# 每個有 manifest 的 consumer 都印，不吃 db-runtime 判斷；pointer 指 clade 源檔，因為非 self-hosted consumer
# 沒有它的投影。登記在 registry/always-load-delivery.json；兩行的長度由 test/session-start-supabase-mcp-counter.test.ts 釘住。
#
# 反向說明的 scope 與 gate 相同：manifest 宣告 modules["db-runtime"] == "supabase-self-hosted"；
# 隔離雲端 VM（CLADE_EPHEMERAL_DB=1 或 CLAUDE_CODE_REMOTE=true）本來就要跑 ephemeral stack，靜默；
# REMOTE 判斷逐字對齊 gate 的 `= "true"`（其他值 gate 照擋，說明就不能省）。
# source=resume／compact 也出聲：instructions 每個 session 都在，說明要跟著在。
# 沒有 project dir／manifest 一律靜默；jq 不在只少反向說明那一行（fail-open）。Exits 0 unconditionally——NEVER block session start。

set -uo pipefail
cat > /dev/null

[ "${CLADE_EPHEMERAL_DB:-}" = "1" ] && exit 0
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] && exit 0

project_dir=${CLAUDE_PROJECT_DIR:-}
[ -n "$project_dir" ] || exit 0
manifest="$project_dir/.clade/manifest.json"
[ -f "$manifest" ] || exit 0
# 第一行先印、後一行固定在最後，讀者看到的順序不隨 scope 改變
runtime=""
command -v jq >/dev/null 2>&1 && runtime=$(jq -r '.modules["db-runtime"] // ""' "$manifest" 2>/dev/null)

if [ "$runtime" = "supabase-self-hosted" ]; then
  echo "[db-runtime] 本 repo 是 supabase-self-hosted：若 dev-supabase MCP 的 instructions 寫「Prefer local development／starting a local stack」，那是通用文字，在本 repo 不適用——NEVER 在 desk 跑 supabase start／db reset／db push；dev DB 在遠端 LXC，用 pnpm db:* 與 dev-supabase MCP（唯讀）。細節：.claude/db-runtime-hint.md（若有）與 .claude/skills/clade-data/rules/db-topology-invariant.md。"
fi
echo "[db-runtime] 自架 Supabase 每一台實例（含 staging／內部用）的 audit 基線：pgaudit 已建立且 pgaudit.log 含 ddl、log_min_messages 實際生效值不是 fatal。適用與否用主機指令判（docker exec <db> psql -U postgres -tAc 'show log_min_messages'），不看 manifest。處置全文：~/offline/clade/rules/modules/db-runtime/supabase-self-hosted/observability.md。"
exit 0
