#!/bin/bash
# 共用設定 — 所有 database scripts 的基礎
#
# 模式切換（在 .env 或環境變數設定）：
#   SUPABASE_MODE=local   （預設）本機 Docker 跑 Supabase
#   SUPABASE_MODE=remote  遠端主機跑 Supabase，透過 SSH 操作
#
# 遠端模式需額外設定：
#   DEV_SSH_HOST=your-host        SSH 主機名（需在 ~/.ssh/config 設定）
#   DEV_PROJECT_DIR=/path/to/dir  遠端 Supabase 專案目錄

# 從 .env 讀取 SUPABASE_MODE（若環境變數未設定）
if [ -z "$SUPABASE_MODE" ] && [ -f "$(dirname "$0")/../../.env" ]; then
  _mode=$(grep '^SUPABASE_MODE=' "$(dirname "$0")/../../.env" 2>/dev/null | cut -d'=' -f2-)
  SUPABASE_MODE="${_mode:-local}"
fi

SUPABASE_MODE="${SUPABASE_MODE:-local}"
DEV_SSH_HOST="${DEV_SSH_HOST:-}"
DEV_PROJECT_DIR="${DEV_PROJECT_DIR:-}"

is_remote() {
  [[ "$SUPABASE_MODE" == "remote" ]]
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
