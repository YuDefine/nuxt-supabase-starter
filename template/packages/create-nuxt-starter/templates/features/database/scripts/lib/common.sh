#!/bin/bash
# 共用設定 — 所有 database scripts 的基礎
# 遠端模式：設定 DEV_SSH_HOST 和 DEV_PROJECT_DIR 環境變數（或在此檔案中修改）

# 預設為本地模式
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
