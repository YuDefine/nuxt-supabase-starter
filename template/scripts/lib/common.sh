#!/bin/bash
# 共用設定 — 所有 database scripts 的基礎
#
# 模式切換（在 .env 或環境變數設定）：
#   SUPABASE_MODE=local    （預設）本機由 `supabase start` 起的 CLI-managed 專案
#   SUPABASE_MODE=remote   遠端主機由 `supabase start` 起，透過 SSH 操作
#   SUPABASE_MODE=compose  docker-compose 自架（不論本機或遠端），一律走 --db-url
#
# remote 模式需額外設定：
#   DEV_SSH_HOST=your-host        SSH 主機名（需在 ~/.ssh/config 設定）
#   DEV_PROJECT_DIR=/path/to/dir  遠端 Supabase 專案目錄
#
# compose 模式需額外設定：
#   ADMIN_DATABASE_URL=postgres://postgres:<pw>@<host>:5432/postgres
#   （沒設就退回 DATABASE_URL）
#
# **NEVER 對 docker-compose 自架的 Supabase 用 `--local`**（即使 ssh 到那台機器上跑）。
# `--local` 指的是「由 supabase start 建立的 CLI-managed 專案」，不是「本機」。
# 自架 stack 不在那個 project state 裡，容器再健康 CLI 也只會回
# "supabase start is not running"。這就是 compose 模式存在的理由。

# 從 .env 讀取 SUPABASE_MODE（若環境變數未設定）
if [ -z "$SUPABASE_MODE" ] && [ -f "$(dirname "$0")/../../.env" ]; then
  _mode=$(grep '^SUPABASE_MODE=' "$(dirname "$0")/../../.env" 2>/dev/null | cut -d'=' -f2-)
  SUPABASE_MODE="${_mode:-local}"
fi

SUPABASE_MODE="${SUPABASE_MODE:-local}"
DEV_SSH_HOST="${DEV_SSH_HOST:-}"
DEV_PROJECT_DIR="${DEV_PROJECT_DIR:-}"

_COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_PROJECT_ROOT="$(cd "$_COMMON_DIR/../.." && pwd)"

scaffold_answers_existing_server() {
  local answers="$_PROJECT_ROOT/.claude/scaffold-answers.json"
  [ -f "$answers" ] && grep -q '"dbHost"[[:space:]]*:[[:space:]]*"existing-server"' "$answers"
}

refuse_local_db_if_existing_server() {
  if scaffold_answers_existing_server && ! is_remote && ! is_compose; then
    echo "❌ scaffold-answers dbHost=existing-server。NEVER 本機 supabase start / db reset / gen types --local。" >&2
    echo "   跑 docs/playbooks/01-dev-database.md；或設 SUPABASE_MODE=remote + DEV_SSH_HOST" >&2
    echo "   （supabase start 起的），或 SUPABASE_MODE=compose + ADMIN_DATABASE_URL（docker-compose 自架）。" >&2
    exit 1
  fi
}

is_remote() {
  [[ "$SUPABASE_MODE" == "remote" ]]
}

# docker-compose 自架：CLI 沒有 project state 可認，一律 --db-url 直連 Postgres。
is_compose() {
  [[ "$SUPABASE_MODE" == "compose" ]]
}

_load_env_key() {
  local key="$1"
  local env_file="$_PROJECT_ROOT/.env"
  if [ -f "$env_file" ]; then
    grep "^${key}=" "$env_file" 2>/dev/null | cut -d'=' -f2-
  fi
}

# compose 模式下 db-lint / db-types / db-reset / db-advisors 共用的連線字串。
# 兩個不處理就會撞牆的細節：
#   1. 密碼要 percent-encode（CLI 明文要求 "must be percent-encoded"）
#   2. 自架通常沒開 TLS，要 sslmode=disable，否則回
#      "tls error (The server does not support SSL connections)"
# 需 supabase CLI >= 2.81.3。
admin_db_url() {
  local raw
  raw="$(_load_env_key ADMIN_DATABASE_URL)"
  [[ -z "$raw" ]] && raw="${ADMIN_DATABASE_URL:-}"
  [[ -z "$raw" ]] && raw="$(_load_env_key DATABASE_URL)"
  [[ -z "$raw" ]] && raw="${DATABASE_URL:-}"
  if [[ -z "$raw" ]]; then
    echo "❌ SUPABASE_MODE=compose 需要 ADMIN_DATABASE_URL（或 DATABASE_URL）" >&2
    return 1
  fi
  ADMIN_DB_URL_RAW="$raw" python3 - <<'PYEOF'
import os
from urllib.parse import urlsplit, urlunsplit, quote, unquote, parse_qsl, urlencode

p = urlsplit(os.environ["ADMIN_DB_URL_RAW"])
# 密碼可能含 '@'，所以用 rsplit 取最後一個 '@' 當 userinfo/host 分界。
userinfo, host = p.netloc.rsplit("@", 1)
user, pw = userinfo.split(":", 1)
q = dict(parse_qsl(p.query))
q.setdefault("sslmode", "disable")
# unquote 再 quote：raw 與「已 percent-encode」兩種輸入都得到同一結果（冪等），
# 不會把既有的 %40 再編成 %2540。
netloc = user + ":" + quote(unquote(pw), safe="") + "@" + host
print(urlunsplit((p.scheme, netloc, p.path, urlencode(q), p.fragment)))
PYEOF
}

require_remote_config() {
  if [[ -z "$DEV_SSH_HOST" ]]; then
    echo "❌ 遠端模式需要設定 DEV_SSH_HOST 環境變數（或在 .env 中設定）" >&2
    exit 1
  fi
  if [[ -z "$DEV_PROJECT_DIR" ]]; then
    echo "❌ 遠端模式需要設定 DEV_PROJECT_DIR 環境變數（或在 .env 中設定）" >&2
    exit 1
  fi
}

require_ssh() {
  require_remote_config
  if ! ssh -o ConnectTimeout=5 -o BatchMode=yes "$DEV_SSH_HOST" true 2>/dev/null; then
    echo "❌ 無法連線到 $DEV_SSH_HOST" >&2
    echo "   請確認 SSH config 和網路連線" >&2
    exit 1
  fi
}

# 在遠端執行指令
remote_exec() {
  ssh "$DEV_SSH_HOST" "export PATH=\$HOME/.local/bin:\$PATH; $*"
}
