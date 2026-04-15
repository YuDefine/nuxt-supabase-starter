#!/bin/bash
set -e

# 確保從專案根目錄執行
cd "$(dirname "$0")/.."

echo ""
echo "🚀 {{projectName}} — 環境初始化"
echo "========================================"
echo ""

# --------------------------------------------------
# 清除 scaffold 暫存的 starter repo（若有）
# --------------------------------------------------

if [ -f .scaffold-cleanup ]; then
  CLEANUP_PATH=$(cat .scaffold-cleanup)
  if [ -n "$CLEANUP_PATH" ] && [ -d "$CLEANUP_PATH" ]; then
    echo "🧹 清除暫存的 starter repo..."
    rm -rf "$CLEANUP_PATH"
    echo "✅ 暫存 repo 已刪除：$CLEANUP_PATH"
    echo ""
  fi
  rm -f .scaffold-cleanup
fi

# --------------------------------------------------
# 偵測作業系統
# --------------------------------------------------

detect_os() {
  case "$(uname -s)" in
    Darwin)  echo "macos" ;;
    Linux)
      if grep -qi microsoft /proc/version 2>/dev/null; then
        echo "wsl"
      else
        echo "linux"
      fi
      ;;
    MINGW*|MSYS*|CYGWIN*)  echo "windows" ;;
    *)  echo "unknown" ;;
  esac
}

OS="$(detect_os)"

# --------------------------------------------------
# 從 package.json 偵測已安裝的功能（取代互動選擇）
# --------------------------------------------------

detect_auth_provider() {
  if grep -q '"nuxt-auth-utils"' package.json 2>/dev/null; then
    echo "nuxt-auth-utils"
  elif grep -q '"@onmax/nuxt-better-auth"' package.json 2>/dev/null; then
    echo "better-auth"
  else
    echo "none"
  fi
}

has_pkg() { grep -q "\"$1\"" package.json 2>/dev/null; }

AUTH_PROVIDER="$(detect_auth_provider)"

# --------------------------------------------------
# 1. 檢查前置需求
# --------------------------------------------------

echo "📋 檢查前置需求..."
echo ""

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

# Docker / OrbStack（已安裝）
# 優先偵測 OrbStack，若 docker CLI 不在 PATH 則自動補上
HAS_DOCKER=false
HAS_ORBSTACK=false
ORBSTACK_DOCKER="/Applications/OrbStack.app/Contents/MacOS/xbin/docker"

command -v orbctl &> /dev/null && HAS_ORBSTACK=true
# macOS: 即使 orbctl 不在 PATH，也檢查 app 是否存在
if [ "$HAS_ORBSTACK" = false ] && [ -d "/Applications/OrbStack.app" ]; then
  HAS_ORBSTACK=true
fi

command -v docker &> /dev/null && HAS_DOCKER=true

# OrbStack 存在但 docker CLI 不在 PATH → 自動補上
if [ "$HAS_ORBSTACK" = true ] && [ "$HAS_DOCKER" = false ]; then
  if [ -x "$ORBSTACK_DOCKER" ]; then
    export PATH="$PATH:$(dirname "$ORBSTACK_DOCKER")"
    HAS_DOCKER=true
    echo "ℹ️  自動使用 OrbStack 內建的 docker CLI"
  else
    echo "⚠️  偵測到 OrbStack 但找不到 docker CLI"
    echo "   請重新安裝 OrbStack 或手動安裝 Docker CLI"
    exit 1
  fi
fi

if [ "$HAS_DOCKER" = false ] && [ "$HAS_ORBSTACK" = false ]; then
  echo "❌ 找不到容器執行環境，請先安裝："
  case "$OS" in
    macos)
      echo "   推薦 OrbStack（輕量快速）："
      echo "   brew install --cask orbstack"
      echo ""
      echo "   或 Docker Desktop："
      echo "   brew install --cask docker"
      ;;
    windows|wsl)
      echo "   https://www.docker.com/products/docker-desktop/"
      echo "   （Windows 請安裝 Docker Desktop for Windows，WSL 2 會自動整合）"
      ;;
    linux)
      echo "   https://docs.docker.com/engine/install/"
      echo "   或使用套件管理器安裝（如 apt, dnf, pacman）"
      ;;
    *)
      echo "   https://www.docker.com/products/docker-desktop/"
      ;;
  esac
  exit 1
fi

# Docker / OrbStack（正在執行）
CONTAINER_RUNNING=false

if [ "$HAS_ORBSTACK" = true ]; then
  # OrbStack: 用 orbctl status 檢查是否啟動
  if orbctl status &> /dev/null; then
    CONTAINER_RUNNING=true
  fi
elif [ "$HAS_DOCKER" = true ]; then
  if docker info &> /dev/null; then
    CONTAINER_RUNNING=true
  fi
fi

if [ "$CONTAINER_RUNNING" = false ]; then
  if [ "$HAS_ORBSTACK" = true ]; then
    echo "❌ OrbStack 尚未啟動，請先啟動 OrbStack"
  else
    echo "❌ Docker 尚未啟動，請先啟動 Docker Desktop"
  fi
  exit 1
fi

if [ "$HAS_ORBSTACK" = true ]; then
  echo "✅ OrbStack 已啟動"
else
  echo "✅ Docker 已啟動"
fi

# Supabase CLI
if ! command -v supabase &> /dev/null; then
  echo "❌ 找不到 Supabase CLI，請先安裝："
  case "$OS" in
    macos)
      echo "   brew install supabase/tap/supabase"
      ;;
    windows)
      echo "   scoop bucket add supabase https://github.com/supabase/scoop-bucket.git"
      echo "   scoop install supabase"
      echo ""
      echo "   若未安裝 Scoop，請先前往 https://scoop.sh/ 安裝"
      ;;
    wsl|linux)
      echo "   方法 1（推薦）："
      echo "   brew install supabase/tap/supabase"
      echo ""
      echo "   方法 2（npm）："
      echo "   npx supabase@latest --help"
      echo ""
      echo "   方法 3（手動下載）："
      echo "   https://github.com/supabase/cli/releases"
      ;;
    *)
      echo "   https://supabase.com/docs/guides/cli/getting-started#installing-the-supabase-cli"
      ;;
  esac
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
elif [ -f .env.example ]; then
  cp .env.example .env
  echo "✅ 已從 .env.example 複製 .env"
else
  echo "⚠️  找不到 .env.example，請手動建立 .env"
fi
echo ""

# --------------------------------------------------
# 4. 啟動 Supabase（依模式切換）
# --------------------------------------------------

# 從 .env 讀取 SUPABASE_MODE
SUPABASE_MODE="${SUPABASE_MODE:-local}"
if [ -f .env ]; then
  _mode=$(grep '^SUPABASE_MODE=' .env 2>/dev/null | cut -d'=' -f2-)
  [ -n "$_mode" ] && SUPABASE_MODE="$_mode"
fi

if [ "$SUPABASE_MODE" = "remote" ]; then
  # --- 遠端模式 ---
  DEV_SSH_HOST=$(grep '^DEV_SSH_HOST=' .env 2>/dev/null | cut -d'=' -f2-)
  echo "ℹ️  Supabase 模式：remote（$DEV_SSH_HOST）"
  echo "   確認遠端已啟動：ssh $DEV_SSH_HOST 'supabase status'"
  echo ""

  # Supabase keys 需手動從遠端取得填入 .env
  if [ -f .env ] && grep -q '<Publishable_key>\|<Secret_key>' .env 2>/dev/null; then
    echo "  ⚠️  SUPABASE_KEY / SUPABASE_SECRET_KEY 尚未填入"
    echo "     請從遠端取得：ssh $DEV_SSH_HOST 'supabase status'"
  fi
else
  # --- 本地模式（預設）---
  if supabase status &> /dev/null; then
    echo "ℹ️  Supabase 已在執行中，跳過啟動"
  else
    echo "🐘 啟動 Supabase..."
    supabase start
  fi
fi
echo ""

# --------------------------------------------------
# 4b. 自動填入 keys 與 secrets 到 .env
# --------------------------------------------------

if [ -f .env ]; then
  echo "🔑 檢查 .env secrets..."

  # 本地模式：自動填入 Supabase keys
  if [ "$SUPABASE_MODE" = "local" ]; then
    SB_STATUS=$(supabase status -o env 2>/dev/null || true)

    if [ -n "$SB_STATUS" ]; then
      ANON_KEY=$(echo "$SB_STATUS" | grep '^ANON_KEY=' | cut -d'=' -f2-)
      SERVICE_KEY=$(echo "$SB_STATUS" | grep '^SERVICE_ROLE_KEY=' | cut -d'=' -f2-)

      if [ -n "$ANON_KEY" ]; then
        sed -i.bak "s|<Publishable_key>|${ANON_KEY}|g" .env && rm -f .env.bak
        echo "  ✅ SUPABASE_KEY + NUXT_PUBLIC_SUPABASE_KEY 已填入"
      fi

      if [ -n "$SERVICE_KEY" ]; then
        sed -i.bak "s|<Secret_key>|${SERVICE_KEY}|g" .env && rm -f .env.bak
        echo "  ✅ SUPABASE_SECRET_KEY 已填入"
      fi
    else
      echo "  ⚠️  無法取得 Supabase keys，請手動填入 .env"
    fi
  fi

  # 自動產生 session password（偵測 .env 中的空值）
  if grep -q '^NUXT_SESSION_PASSWORD=$' .env 2>/dev/null; then
    SESSION_PWD=$(openssl rand -base64 32)
    sed -i.bak "s|^NUXT_SESSION_PASSWORD=$|NUXT_SESSION_PASSWORD=${SESSION_PWD}|" .env && rm -f .env.bak
    echo "  ✅ NUXT_SESSION_PASSWORD 已自動產生"
  fi

  # 自動產生 Better Auth secret（從 .env 偵測，不依賴互動變數）
  if grep -q '^BETTER_AUTH_SECRET=$' .env 2>/dev/null; then
    AUTH_SECRET=$(openssl rand -base64 32)
    sed -i.bak "s|^BETTER_AUTH_SECRET=$|BETTER_AUTH_SECRET=${AUTH_SECRET}|" .env && rm -f .env.bak
    echo "  ✅ BETTER_AUTH_SECRET 已自動產生"
  fi
  echo ""
fi

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
# 從 .env 偵測是否需要檢查 BETTER_AUTH_SECRET
if grep -q '^BETTER_AUTH_SECRET=' .env 2>/dev/null; then
  check_env "BETTER_AUTH_SECRET" "Auth 加密金鑰（openssl rand -base64 32）"
fi
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
# 功能摘要（從 package.json 偵測）
# --------------------------------------------------

echo ""
echo "========================================"
echo "✅ 環境初始化完成！"
echo "========================================"
echo ""
echo "已啟用的功能："
echo "  ✅ Nuxt 4 + Vue 3 + TypeScript"
echo "  ✅ Tailwind CSS + Nuxt UI"
echo "  ✅ Supabase（PostgreSQL）"
if [ "$AUTH_PROVIDER" != "none" ]; then
  echo "  ✅ ${AUTH_PROVIDER}（認證）"
fi
echo "  ✅ Pinia + Pinia Colada（狀態管理）"

# 從 nuxt.config.ts 偵測 SSR
if grep -q 'ssr: true' nuxt.config.ts 2>/dev/null; then
  echo "  ✅ SSR（Server-Side Rendering）"
fi

has_pkg "@sentry/nuxt"       && echo "  ✅ Sentry（錯誤追蹤）"
has_pkg "@nuxthub/core"      && echo "  ✅ NuxtHub（Cloudflare Workers）"
has_pkg "@nuxtjs/seo"        && echo "  ✅ Nuxt SEO"
has_pkg "nuxt-charts"        && echo "  ✅ Nuxt Charts"
has_pkg "nuxt-echarts"       && echo "  ✅ Nuxt ECharts"
has_pkg "vitepress"          && echo "  ✅ VitePress（文件站）"
has_pkg "@playwright/test"   && echo "  ✅ Playwright（E2E 測試）"

echo ""
echo "接下來："
echo "  pnpm dev    # 啟動開發伺服器"
echo ""
