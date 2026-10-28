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
# Scope 與 gate 相同：manifest 宣告 modules["db-runtime"] == "supabase-self-hosted"；
# 隔離雲端 VM（CLADE_EPHEMERAL_DB=1 或 CLAUDE_CODE_REMOTE=true）本來就要跑 ephemeral stack，靜默；
# REMOTE 判斷逐字對齊 gate 的 `= "true"`（其他值 gate 照擋，說明就不能省）。
# source=resume／compact 也出聲：instructions 每個 session 都在，說明要跟著在。
# 設定缺失或依賴不在一律靜默（fail-open）；Exits 0 unconditionally——NEVER block session start。

set -uo pipefail
cat > /dev/null

[ "${CLADE_EPHEMERAL_DB:-}" = "1" ] && exit 0
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] && exit 0

project_dir=${CLAUDE_PROJECT_DIR:-}
[ -n "$project_dir" ] || exit 0
manifest="$project_dir/.clade/manifest.json"
[ -f "$manifest" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0

runtime=$(jq -r '.modules["db-runtime"] // ""' "$manifest" 2>/dev/null) || exit 0
[ "$runtime" = "supabase-self-hosted" ] || exit 0

echo "[db-runtime] 本 repo 是 supabase-self-hosted：若 dev-supabase MCP 的 instructions 寫「Prefer local development／starting a local stack」，那是通用文字，在本 repo 不適用——NEVER 在 desk 跑 supabase start／db reset／db push；dev DB 在遠端 LXC，用 pnpm db:* 與 dev-supabase MCP（唯讀）。細節：.claude/db-runtime-hint.md（若有）與 db-topology-invariant。"
exit 0
