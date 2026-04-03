#!/bin/bash
set -e

# 確保從專案根目錄執行
cd "$(dirname "$0")/.."

echo ""
echo "🚀 Nuxt Supabase Starter — 環境初始化"
echo "========================================"
echo ""

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

# Docker（已安裝）
if ! command -v docker &> /dev/null; then
  echo "❌ 找不到 Docker，請先安裝 Docker Desktop："
  case "$OS" in
    macos)
      echo "   brew install --cask docker"
      echo "   或前往 https://www.docker.com/products/docker-desktop/"
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

# Docker（正在執行）
if ! docker info &> /dev/null; then
  echo "❌ Docker 尚未啟動，請先啟動 Docker Desktop"
  exit 1
fi
echo "✅ Docker 已啟動"

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
# 2. Tech Stack 選擇
# --------------------------------------------------

echo "📦 Tech Stack 選擇"
echo "========================================"
echo ""
echo "核心功能（自動包含）："
echo "  ├─ Nuxt 4 + Vue 3 + TypeScript"
echo "  ├─ Tailwind CSS + Nuxt UI"
echo "  ├─ Supabase（PostgreSQL）"
echo "  └─ Pinia + Pinia Colada（狀態管理）"
echo ""

ask_feature() {
  local var_name="$1"
  local label="$2"
  local default="$3"
  local prompt_suffix="[Y/n]"
  if [ "$default" = "n" ]; then
    prompt_suffix="[y/N]"
  fi

  printf "  %s %s " "$label" "$prompt_suffix"
  read -r answer </dev/tty 2>/dev/null || read -r answer
  answer="${answer:-$default}"
  case "$answer" in
    [Yy]*)  printf -v "$var_name" '%s' 'y' ;;
    *)      printf -v "$var_name" '%s' 'n' ;;
  esac
}

# --------------------------------------------------
# 2a. Auth Provider 選擇
# --------------------------------------------------

echo "🔑 認證系統"
echo "────────────────────────────────────────"
echo "  1) Better Auth（Email/Password + OAuth）"
echo "  2) nuxt-auth-utils（OAuth-first，cookie session）"
echo ""
printf "  選擇認證系統 [1/2]: "
read -r AUTH_CHOICE </dev/tty 2>/dev/null || read -r AUTH_CHOICE
AUTH_CHOICE="${AUTH_CHOICE:-1}"
case "$AUTH_CHOICE" in
  2)  AUTH_PROVIDER="nuxt-auth-utils" ;;
  *)  AUTH_PROVIDER="better-auth" ;;
esac
echo "  → 使用 $AUTH_PROVIDER"
echo ""

echo "選擇要啟用的可選功能（輸入 y/n）："
echo "────────────────────────────────────────"

echo ""
echo "🔐 OAuth 登入提供者"
ask_feature "FEAT_OAUTH_GOOGLE"  "Google OAuth"  "n"
ask_feature "FEAT_OAUTH_LINE"    "LINE Login"    "n"
ask_feature "FEAT_OAUTH_GITHUB"  "GitHub OAuth"  "n"

echo ""
echo "📊 監控與觀測"
ask_feature "FEAT_SENTRY"        "Sentry（錯誤追蹤）"  "n"

echo ""
echo "🚀 部署與託管"
ask_feature "FEAT_NUXTHUB"       "NuxtHub（Cloudflare Workers）"  "y"

echo ""
echo "🖥️ 渲染模式"
ask_feature "FEAT_SSR" "SSR（Server-Side Rendering）" "n"

echo ""
echo "🔧 開發工具"
ask_feature "FEAT_SEO"           "Nuxt SEO（需要 SSR）"  "n"
ask_feature "FEAT_CHARTS"        "Nuxt Charts"          "n"
ask_feature "FEAT_VITEPRESS"     "VitePress（文件站）"  "n"
ask_feature "FEAT_E2E"           "Playwright（E2E 測試）" "n"

echo ""

# --------------------------------------------------
# 3. 套用 Auth Provider 模板
# --------------------------------------------------

echo "🔑 套用 ${AUTH_PROVIDER} 模板..."

TEMPLATE_DIR="scripts/templates/auth/${AUTH_PROVIDER}"

if [ ! -d "$TEMPLATE_DIR" ]; then
  echo "❌ 找不到模板目錄：${TEMPLATE_DIR}"
  exit 1
fi

# Copy auth template files into the project
copy_template() {
  local src="$1"
  local dest="$2"
  mkdir -p "$(dirname "$dest")"
  cp "$src" "$dest"
}

if [ "$AUTH_PROVIDER" = "better-auth" ]; then
  copy_template "$TEMPLATE_DIR/server/auth.config.ts" "server/auth.config.ts"
  copy_template "$TEMPLATE_DIR/app/auth.config.ts" "app/auth.config.ts"
  copy_template "$TEMPLATE_DIR/app/middleware/auth.global.ts" "app/middleware/auth.global.ts"
  copy_template "$TEMPLATE_DIR/server/utils/api-response.ts" "server/utils/api-response.ts"
  copy_template "$TEMPLATE_DIR/app/pages/auth/login.vue" "app/pages/auth/login.vue"
  copy_template "$TEMPLATE_DIR/app/pages/auth/register.vue" "app/pages/auth/register.vue"
  copy_template "$TEMPLATE_DIR/app/pages/auth/callback.vue" "app/pages/auth/callback.vue"
  copy_template "$TEMPLATE_DIR/app/pages/auth/forgot-password.vue" "app/pages/auth/forgot-password.vue"
elif [ "$AUTH_PROVIDER" = "nuxt-auth-utils" ]; then
  copy_template "$TEMPLATE_DIR/app/middleware/auth.global.ts" "app/middleware/auth.global.ts"
  copy_template "$TEMPLATE_DIR/server/utils/api-response.ts" "server/utils/api-response.ts"
  copy_template "$TEMPLATE_DIR/app/pages/auth/login.vue" "app/pages/auth/login.vue"
  copy_template "$TEMPLATE_DIR/app/pages/auth/callback.vue" "app/pages/auth/callback.vue"
  # Remove better-auth specific files
  rm -f "server/auth.config.ts" "app/auth.config.ts"
  rm -f "app/pages/auth/register.vue" "app/pages/auth/forgot-password.vue"
fi

# Update nuxt.config.ts module reference
if [ "$AUTH_PROVIDER" = "nuxt-auth-utils" ]; then
  # Replace @onmax/nuxt-better-auth with nuxt-auth-utils
  sed -i.bak "s/'@onmax\/nuxt-better-auth'/'nuxt-auth-utils'/" nuxt.config.ts && rm -f nuxt.config.ts.bak
fi

echo "✅ ${AUTH_PROVIDER} 模板已套用"
echo ""

# --------------------------------------------------
# 3a. 根據 Auth 選擇清理 Skills
# --------------------------------------------------
if [ "$AUTH_PROVIDER" = "nuxt-auth-utils" ]; then
  # nuxt-auth-utils 是專案自訂 skill（tracked in git），已存在
  # 移除第三方 nuxt-better-auth skill
  rm -rf ".claude/skills/nuxt-better-auth/"
  echo "  → 保留 nuxt-auth-utils skill，移除 nuxt-better-auth"
elif [ "$AUTH_PROVIDER" = "better-auth" ]; then
  # nuxt-better-auth 由 install-skills.sh 安裝（第三方）
  # 移除專案自訂 nuxt-auth-utils skill
  rm -rf ".claude/skills/nuxt-auth-utils/"
  echo "  → 保留 nuxt-better-auth skill，移除 nuxt-auth-utils"
fi
echo ""

# --------------------------------------------------
# 3b. 更新 CLAUDE.md Auth 規則
# --------------------------------------------------

if [ -f "CLAUDE.md" ]; then
  if [ "$AUTH_PROVIDER" = "nuxt-auth-utils" ]; then
    sed -i.bak 's/\*\*USE\*\* `useUserSession()` — 來自 `nuxt-auth-utils` 或 `@onmax\/nuxt-better-auth`（依專案選擇）/\*\*USE\*\* `useUserSession()` — 來自 `nuxt-auth-utils`/' CLAUDE.md && rm -f CLAUDE.md.bak
  else
    sed -i.bak 's/\*\*USE\*\* `useUserSession()` — 來自 `nuxt-auth-utils` 或 `@onmax\/nuxt-better-auth`（依專案選擇）/\*\*USE\*\* `useUserSession()` — 來自 `@onmax\/nuxt-better-auth`/' CLAUDE.md && rm -f CLAUDE.md.bak
  fi
fi

# --------------------------------------------------
# 3c. 移除未選擇的功能
# --------------------------------------------------

echo "🧹 調整功能模組..."

# Helper: remove a dependency from package.json
remove_pkg_dep() {
  local pkg_name="$1"
  local section="${2:-dependencies}"
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    if (pkg['${section}'] && pkg['${section}']['${pkg_name}']) {
      delete pkg['${section}']['${pkg_name}'];
    }
    fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
  "
}

# Helper: remove a script from package.json
remove_pkg_script() {
  local script_name="$1"
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    if (pkg.scripts && pkg.scripts['${script_name}']) {
      delete pkg.scripts['${script_name}'];
    }
    fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
  "
}

# Helper: remove a module line from nuxt.config.ts
remove_nuxt_module() {
  local module_name="$1"
  sed -i.bak "/'${module_name}'/d" nuxt.config.ts && rm -f nuxt.config.ts.bak
}

if [ "$FEAT_SENTRY" = "n" ]; then
  remove_pkg_dep "@sentry/nuxt"
  remove_nuxt_module "@sentry/nuxt/module"
  # Remove sentry build config block
  sed -i.bak '/\/\/ Sentry 建置時設定/,/^  },$/d' nuxt.config.ts && rm -f nuxt.config.ts.bak
  # Remove sourcemap config block
  sed -i.bak '/\/\/ 啟用 hidden source maps/,/^  },$/d' nuxt.config.ts && rm -f nuxt.config.ts.bak
  # Remove sentry DSN from runtimeConfig.public
  sed -i.bak '/\/\/ Sentry DSN/d' nuxt.config.ts && rm -f nuxt.config.ts.bak
  sed -i.bak '/sentry: {/,/},/d' nuxt.config.ts && rm -f nuxt.config.ts.bak
  # Remove sentry vite define
  sed -i.bak "/import.meta.env.NUXT_PUBLIC_SENTRY_DSN/d" nuxt.config.ts && rm -f nuxt.config.ts.bak
  sed -i.bak "/手動注入 NUXT_PUBLIC_SENTRY_DSN/d" nuxt.config.ts && rm -f nuxt.config.ts.bak
  sed -i.bak "/因為 sentry.client.config.ts/d" nuxt.config.ts && rm -f nuxt.config.ts.bak
  sed -i.bak "/Vite 只會自動注入/d" nuxt.config.ts && rm -f nuxt.config.ts.bak
  echo "  ✅ 移除 Sentry"
fi

if [ "$FEAT_NUXTHUB" = "n" ]; then
  remove_pkg_dep "@nuxthub/core"
  echo "  ✅ 移除 NuxtHub"
fi

if [ "$FEAT_CHARTS" = "n" ]; then
  remove_pkg_dep "nuxt-charts"
  remove_nuxt_module "nuxt-charts"
  echo "  ✅ 移除 Nuxt Charts"
fi

if [ "$FEAT_VITEPRESS" = "n" ]; then
  remove_pkg_dep "vitepress" "devDependencies"
  remove_pkg_script "docs:build"
  remove_pkg_script "docs:dev"
  remove_pkg_script "docs:preview"
  echo "  ✅ 移除 VitePress"
fi

if [ "$FEAT_E2E" = "n" ]; then
  remove_pkg_dep "@playwright/test" "devDependencies"
  remove_pkg_script "test:e2e"
  echo "  ✅ 移除 Playwright"
fi

# SSR 啟用時修改 nuxt.config.ts
if [ "$FEAT_SSR" = "y" ]; then
  sed -i.bak 's/ssr: false/ssr: true/' nuxt.config.ts && rm -f nuxt.config.ts.bak
  echo "  ✅ 啟用 SSR"
fi

# SSR 關閉時強制移除 SEO
if [ "$FEAT_SSR" = "n" ]; then
  FEAT_SEO="n"
fi

if [ "$FEAT_SEO" = "n" ]; then
  remove_pkg_dep "@nuxtjs/seo"
  remove_nuxt_module "@nuxtjs/seo"
  echo "  ✅ 移除 Nuxt SEO"
fi

echo ""

# --------------------------------------------------
# 4. 安裝依賴
# --------------------------------------------------

echo "📦 安裝專案依賴..."
pnpm install
echo ""

# --------------------------------------------------
# 5. 設定環境變數
# --------------------------------------------------

generate_env() {
  cat << 'ENVCORE'
# ============================================
# Supabase（必要）
# ============================================
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_KEY=<Publishable_key>
SUPABASE_SECRET_KEY=<Secret_key>

# 給 Nuxt 使用
NUXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NUXT_PUBLIC_SUPABASE_KEY=<Publishable_key>
ENVCORE

  emit_oauth_block() {
    local provider_upper="$1"
    local display_name="$2"
    local docs_url="$3"
    printf '\n# ============================================\n'
    printf '# %s\n' "$display_name"
    printf '# %s\n' "$docs_url"
    printf '# ============================================\n'
    printf 'NUXT_OAUTH_%s_CLIENT_ID=\n' "$provider_upper"
    printf 'NUXT_OAUTH_%s_CLIENT_SECRET=\n' "$provider_upper"
  }

  [ "$FEAT_OAUTH_GOOGLE" = "y" ] && emit_oauth_block "GOOGLE" "Google OAuth" "https://console.cloud.google.com/apis/credentials"
  [ "$FEAT_OAUTH_LINE"   = "y" ] && emit_oauth_block "LINE"   "LINE Login"   "https://developers.line.biz/console/"
  [ "$FEAT_OAUTH_GITHUB" = "y" ] && emit_oauth_block "GITHUB" "GitHub OAuth" "https://github.com/settings/developers"

  if [ "$AUTH_PROVIDER" = "better-auth" ]; then
    cat << 'ENVBETTERAUTH'

# ============================================
# Better Auth（必要）
# 使用 openssl rand -base64 32 產生
# ============================================
BETTER_AUTH_SECRET=
ENVBETTERAUTH
  fi

  cat << 'ENVSESSION'

# ============================================
# Session（必要）
# 使用 openssl rand -base64 32 產生
# ============================================
NUXT_SESSION_PASSWORD=

# ============================================
# 站點配置
# ============================================
NUXT_PUBLIC_SITE_URL=http://localhost:3000
ENVSESSION

  if [ "$FEAT_SENTRY" = "y" ]; then
    cat << 'ENVSENTRY'

# ============================================
# Sentry（錯誤追蹤）
# ============================================
SENTRY_DSN=
NUXT_PUBLIC_SENTRY_DSN=
SENTRY_AUTH_TOKEN=
SENTRY_ORG=
SENTRY_PROJECT=
ENVSENTRY
  fi
}

if [ -f .env ]; then
  echo "ℹ️  .env 已存在，保留現有設定"
else
  generate_env > .env
  echo "✅ 已根據選擇產生 .env"
fi
echo ""

# --------------------------------------------------
# 6. 啟動 Supabase
# --------------------------------------------------

if supabase status &> /dev/null; then
  echo "ℹ️  Supabase 已在執行中，跳過啟動"
else
  echo "🐘 啟動 Supabase..."
  supabase start
fi
echo ""

# --------------------------------------------------
# 6b. 自動填入 Supabase keys 到 .env
# --------------------------------------------------

if [ -f .env ]; then
  echo "🔑 自動填入 Supabase keys..."

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

    # 自動產生 session password
    if grep -q '^NUXT_SESSION_PASSWORD=$' .env 2>/dev/null; then
      SESSION_PWD=$(openssl rand -base64 32)
      sed -i.bak "s|^NUXT_SESSION_PASSWORD=$|NUXT_SESSION_PASSWORD=${SESSION_PWD}|" .env && rm -f .env.bak
      echo "  ✅ NUXT_SESSION_PASSWORD 已自動產生"
    fi

    # 自動產生 Better Auth secret
    if [ "$AUTH_PROVIDER" = "better-auth" ] && grep -q '^BETTER_AUTH_SECRET=$' .env 2>/dev/null; then
      AUTH_SECRET=$(openssl rand -base64 32)
      sed -i.bak "s|^BETTER_AUTH_SECRET=$|BETTER_AUTH_SECRET=${AUTH_SECRET}|" .env && rm -f .env.bak
      echo "  ✅ BETTER_AUTH_SECRET 已自動產生"
    fi
  else
    echo "  ⚠️  無法取得 Supabase keys，請手動填入 .env"
  fi
  echo ""
fi

# --------------------------------------------------
# 7. 產生型別
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
if [ "$AUTH_PROVIDER" = "better-auth" ]; then
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
# 選擇摘要
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
echo "  ✅ ${AUTH_PROVIDER}（認證）"
echo "  ✅ Pinia + Pinia Colada（狀態管理）"

[ "$FEAT_SSR" = "y" ]          && echo "  ✅ SSR（Server-Side Rendering）"
[ "$FEAT_OAUTH_GOOGLE" = "y" ] && echo "  ✅ Google OAuth"
[ "$FEAT_OAUTH_LINE" = "y" ]   && echo "  ✅ LINE Login"
[ "$FEAT_OAUTH_GITHUB" = "y" ] && echo "  ✅ GitHub OAuth"
[ "$FEAT_SENTRY" = "y" ]       && echo "  ✅ Sentry（錯誤追蹤）"
[ "$FEAT_NUXTHUB" = "y" ]      && echo "  ✅ NuxtHub（Cloudflare Workers）"
[ "$FEAT_SEO" = "y" ]          && echo "  ✅ Nuxt SEO"
[ "$FEAT_CHARTS" = "y" ]       && echo "  ✅ Nuxt Charts"
[ "$FEAT_VITEPRESS" = "y" ]    && echo "  ✅ VitePress（文件站）"
[ "$FEAT_E2E" = "y" ]          && echo "  ✅ Playwright（E2E 測試）"

echo ""
echo "接下來："
echo "  pnpm dev    # 啟動開發伺服器"
echo ""
