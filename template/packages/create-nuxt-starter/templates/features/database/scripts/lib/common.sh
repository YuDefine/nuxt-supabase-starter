#!/bin/bash
# 共用設定 — 所有 database scripts 的基礎
#
# SUPABASE_MODE=local    （預設）本機由 `supabase start` 起的 CLI-managed 專案
# SUPABASE_MODE=remote   遠端主機由 `supabase start` 起，透過 SSH 操作
#                        （需 DEV_SSH_HOST / DEV_PROJECT_DIR）
# SUPABASE_MODE=compose  docker-compose 自架，一律走 --db-url
#                        （需 ADMIN_DATABASE_URL，沒設就退回 DATABASE_URL）
#
# **NEVER 對 docker-compose 自架的 Supabase 用 `--local`**（即使 ssh 到那台機器上跑）。
# `--local` 指的是「由 supabase start 建立的 CLI-managed 專案」，不是「本機」。
# 自架 stack 不在那個 project state 裡，容器再健康 CLI 也只會回
# "supabase start is not running"。這就是 compose 模式存在的理由。

SUPABASE_MODE="${SUPABASE_MODE:-local}"

# 遠端 Supabase 設定（僅遠端模式需要）
DEV_SSH_HOST="${DEV_SSH_HOST:-}"
DEV_PROJECT_DIR="${DEV_PROJECT_DIR:-/opt/supabase}"

require_ssh() {
  if [[ "$SUPABASE_MODE" != "remote" ]]; then
    return 0
  fi
  if [[ -z "$DEV_SSH_HOST" ]]; then
    echo "❌ 遠端模式需要設定 DEV_SSH_HOST 環境變數" >&2
    exit 1
  fi
  if ! ssh -o ConnectTimeout=5 -o BatchMode=yes "$DEV_SSH_HOST" true 2>/dev/null; then
    echo "❌ 無法連線到 $DEV_SSH_HOST（檢查 SSH config 和 Tailscale）" >&2
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
  local env_file="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/.env"
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
