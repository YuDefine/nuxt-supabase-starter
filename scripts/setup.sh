#!/bin/bash
set -e

# 確保從專案根目錄執行
cd "$(dirname "$0")/.."

echo ""
echo "🚀 Nuxt Supabase Starter — 環境初始化"
echo "========================================"
echo ""

# --------------------------------------------------
# 1. 檢查前置需求
# --------------------------------------------------

# Node.js 18+（建議 24 LTS）
if ! command -v node &> /dev/null; then
  echo "❌ 找不到 Node.js，請先安裝 Node.js 18 以上版本（建議 24 LTS）"
  echo "   https://nodejs.org/"
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "❌ Node.js 版本過低：$(node -v)（需要 v18 以上，建議 v24 LTS）"
  echo "   請升級 Node.js：https://nodejs.org/"
  exit 1
fi
echo "✅ Node.js $(node -v)"

# pnpm
if ! command -v pnpm &> /dev/null; then
  echo "❌ 找不到 pnpm，請先安裝："
  echo "   corepack enable && corepack prepare pnpm@latest --activate"
  exit 1
fi
echo "✅ pnpm $(pnpm -v)"

# Docker（已安裝）
if ! command -v docker &> /dev/null; then
  echo "❌ 找不到 Docker，請先安裝 Docker Desktop："
  echo "   https://www.docker.com/products/docker-desktop/"
  exit 1
fi

# Docker（正在執行）
if ! docker info &> /dev/null; then
  echo "❌ Docker 尚未啟動，請先啟動 Docker Desktop"
  exit 1
fi
echo "✅ Docker 已啟動"

# Supabase CLI
if ! command -v supabase &> /dev/null; then
  echo "❌ 找不到 Supabase CLI，請先安裝："
  echo "   brew install supabase/tap/supabase"
  exit 1
fi
echo "✅ Supabase CLI $(supabase --version 2>/dev/null || echo '')"

echo ""

# --------------------------------------------------
# 2. 安裝依賴
# --------------------------------------------------

echo "📦 安裝專案依賴..."
pnpm install
echo ""

# --------------------------------------------------
# 3. 設定環境變數
# --------------------------------------------------

if [ -f .env ]; then
  echo "ℹ️  .env 已存在，保留現有設定"
else
  if [ -f .env.example ]; then
    cp .env.example .env
    echo "✅ 已從 .env.example 建立 .env"
  else
    echo "⚠️  找不到 .env.example，請手動建立 .env"
  fi
fi
echo ""

# --------------------------------------------------
# 4. 啟動 Supabase
# --------------------------------------------------

if supabase status &> /dev/null; then
  echo "ℹ️  Supabase 已在執行中，跳過啟動"
else
  echo "🐘 啟動 Supabase..."
  supabase start
fi
echo ""

# --------------------------------------------------
# 5. 產生型別
# --------------------------------------------------

echo "🔧 產生資料庫型別..."
pnpm db:types
echo ""

# ============================================
# .env 設定檢查
# ============================================
echo ""
echo "📋 檢查 .env 設定..."

ENV_WARNINGS=()

check_env() {
  local key="$1"
  local desc="$2"
  local val
  val=$(grep "^${key}=" .env 2>/dev/null | cut -d'=' -f2-)
  if [ -z "$val" ] || [[ "$val" == *"<"* ]]; then
    ENV_WARNINGS+=("  ⚠️  ${key} — ${desc}")
  fi
}

check_env "SUPABASE_URL" "Supabase Project URL"
check_env "SUPABASE_KEY" "Supabase anon/public key"
check_env "SUPABASE_SECRET_KEY" "Supabase service role key"
check_env "BETTER_AUTH_SECRET" "Auth 加密金鑰（openssl rand -base64 32）"
check_env "NUXT_SESSION_PASSWORD" "Session 加密金鑰（openssl rand -base64 32）"

if [ ${#ENV_WARNINGS[@]} -gt 0 ]; then
  echo ""
  echo "⚠️  以下環境變數需要手動設定："
  printf '%s\n' "${ENV_WARNINGS[@]}"
  echo ""
  echo "  編輯 .env 檔案填入實際值。"
else
  echo "✅ 所有必要環境變數已設定"
fi

# --------------------------------------------------
# 完成
# --------------------------------------------------

echo "✅ 環境初始化完成！"
echo ""
echo "接下來："
echo "  pnpm dev    # 啟動開發伺服器"
echo ""
