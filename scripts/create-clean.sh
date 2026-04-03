#!/bin/bash
# =============================================================================
# create-clean.sh — 一鍵移除所有 demo 內容，產出乾淨的專案起點
# =============================================================================
#
# Demo 內容（會被移除）：
#   - app/pages/ 中除了 (home).vue 以外的所有頁面
#   - app/components/ 中的所有檔案（保留目錄 + .gitkeep）
#   - server/api/v1/ 中的所有檔案（保留目錄 + .gitkeep）
#   - app/queries/ 中的所有檔案（保留目錄 + .gitkeep）
#   - app/stores/ 中的所有檔案（保留目錄 + .gitkeep）
#   - supabase/migrations/ 中的所有檔案（保留目錄 + .gitkeep）
#   - supabase/seed.sql（清空內容）
#   - test/ 中除了 infrastructure 測試以外的檔案
#   - (home).vue 替換為簡潔 welcome 頁面
#
# Starter 識別（會被更新）：
#   - wrangler.toml name → 目錄名
#   - supabase/config.toml project_id → 目錄名
#   - package.json name/version/repository
#   - .env（從 .env.example 重新產生，含新 secrets）
#   - README.md（替換為新專案模板）
#   - openspec/changes/（清空 active + archive）
#   - openspec/project.md（替換為模板）
#   - .spectra/（重置為乾淨骨架）
#
# Infrastructure（會被保留）：
#   - app/layouts/          — 佈局
#   - app/middleware/        — 中介軟體
#   - app/composables/       — 共用 composables
#   - app/app.vue            — 應用入口
#   - app/app.config.ts      — 應用設定
#   - app/error.vue          — 錯誤頁面
#   - app/types/             — 型別定義（重設為空白結構）
#   - server/utils/          — Server utilities
#   - server/plugins/        — Server plugins
#   - server/api/auth/       — Auth API
#
# Usage:
#   bash scripts/create-clean.sh
#   pnpm create:clean
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -d "$SCRIPT_DIR/../template" ]; then
  # 在 monorepo 中執行（scripts/ 與 template/ 同層）
  ROOT_DIR="$(cd "$SCRIPT_DIR/../template" && pwd)"
else
  # 在獨立專案中執行（scripts/ 已被複製進專案）
  ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
fi
cd "$ROOT_DIR"
PROJECT_NAME="$(basename "$ROOT_DIR")"

# ---------------------------------------------------------------------------
# 顏色輸出
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

info()    { echo -e "${CYAN}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[DONE]${NC} $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1"; }

# ---------------------------------------------------------------------------
# 確認提示
# ---------------------------------------------------------------------------
echo ""
echo -e "${YELLOW}=============================================${NC}"
echo -e "${YELLOW}  Create Clean — ${PROJECT_NAME}             ${NC}"
echo -e "${YELLOW}=============================================${NC}"
echo ""
echo -e "專案名稱: ${CYAN}${PROJECT_NAME}${NC}"
echo ""
echo "此腳本將移除所有 demo 內容，包括："
echo "  - Demo pages (app/pages/ 中除了首頁)"
echo "  - Demo components (app/components/)"
echo "  - Demo API endpoints (server/api/v1/)"
echo "  - Demo queries (app/queries/)"
echo "  - Demo stores (app/stores/)"
echo "  - Demo tests (test/)"
echo "  - Database migrations (supabase/migrations/)"
echo "  - Seed data (supabase/seed.sql)"
echo ""
echo "同時會更新 starter 識別資訊："
echo "  - 套用模板：README, app.vue, layouts, (home).vue, database.types.ts"
echo "  - 設定檔：wrangler.toml, supabase/config.toml, nuxt.config.ts → ${PROJECT_NAME}"
echo "  - package.json name/version/repository"
echo "  - .env（重新產生 secrets）"
echo "  - openspec/, .spectra/, CLAUDE.md"
echo "  - 移除 starter 專屬文件、壞掉的 symlinks"
echo ""
echo "以下內容將被保留："
echo "  - Layouts, middleware, composables"
echo "  - Server utils, plugins, auth API"
echo "  - app.vue, app.config.ts, error.vue"
echo "  - 所有設定檔 (nuxt.config.ts, tsconfig, etc.)"
echo ""

# 支援 --yes 旗標跳過確認（用於 CI）
if [[ "${1:-}" != "--yes" ]]; then
  echo -e "${RED}此操作不可逆！請確認你已經 commit 或備份了所有重要變更。${NC}"
  echo ""
  read -r -p "確定要繼續嗎？(y/N) " response
  case "$response" in
    [yY][eE][sS]|[yY])
      echo ""
      ;;
    *)
      echo "已取消。"
      exit 0
      ;;
  esac
fi

REMOVED_COUNT=0
KEPT_COUNT=0

# ---------------------------------------------------------------------------
# Helper: 清空目錄但保留 .gitkeep
# ---------------------------------------------------------------------------
clean_dir() {
  local dir="$1"
  local label="$2"

  if [ ! -d "$dir" ]; then
    warn "目錄不存在，跳過: $label"
    return
  fi

  local count
  count=$(find "$dir" -type f ! -name '.gitkeep' | wc -l | tr -d ' ')

  if [ "$count" -eq 0 ]; then
    info "已是空的，跳過: $label"
    return
  fi

  find "$dir" -type f ! -name '.gitkeep' -delete
  # 移除空的子目錄（但保留根目錄）
  find "$dir" -mindepth 1 -type d -empty -delete 2>/dev/null || true
  # 確保 .gitkeep 存在
  if [ ! -f "$dir/.gitkeep" ]; then
    touch "$dir/.gitkeep"
  fi

  success "清除 $count 個檔案: $label"
  REMOVED_COUNT=$((REMOVED_COUNT + count))
}

# ---------------------------------------------------------------------------
# Helper: 從 templates/clean/ 套用模板（替換 {{PROJECT_NAME}}）
# ---------------------------------------------------------------------------
apply_template() {
  local src="$ROOT_DIR/scripts/templates/clean/$1"
  local dest="$ROOT_DIR/$2"
  if [ ! -f "$src" ]; then
    warn "模板不存在: $1"
    return
  fi
  mkdir -p "$(dirname "$dest")"
  sed "s/{{PROJECT_NAME}}/${PROJECT_NAME}/g" "$src" > "$dest"
  success "套用模板: $2"
}

# ---------------------------------------------------------------------------
# 1. 移除 demo pages（保留 (home).vue，稍後會替換內容）
# ---------------------------------------------------------------------------
info "移除 demo pages..."
page_count=$(find app/pages -type f ! -name '(home).vue' ! -name '.gitkeep' 2>/dev/null | wc -l | tr -d ' ')
if [ "$page_count" -gt 0 ]; then
  find app/pages -type f ! -name '(home).vue' ! -name '.gitkeep' -delete
  find app/pages -mindepth 1 -type d -empty -delete 2>/dev/null || true
  success "移除 $page_count 個 demo pages"
  REMOVED_COUNT=$((REMOVED_COUNT + page_count))
else
  info "沒有 demo pages 需要移除"
fi

# ---------------------------------------------------------------------------
# 2. 清空 demo components
# ---------------------------------------------------------------------------
clean_dir "app/components" "app/components/"

# ---------------------------------------------------------------------------
# 3. 清空 demo API endpoints (v1)
# ---------------------------------------------------------------------------
clean_dir "server/api/v1" "server/api/v1/"

# ---------------------------------------------------------------------------
# 4. 清空 demo queries
# ---------------------------------------------------------------------------
clean_dir "app/queries" "app/queries/"

# ---------------------------------------------------------------------------
# 5. 清空 demo stores
# ---------------------------------------------------------------------------
clean_dir "app/stores" "app/stores/"

# ---------------------------------------------------------------------------
# 5b. 移除依賴 demo stores 的 composables
# ---------------------------------------------------------------------------
if [ -f "app/composables/useUserRole.ts" ]; then
  rm "app/composables/useUserRole.ts"
  success "移除 demo composable: useUserRole.ts"
  REMOVED_COUNT=$((REMOVED_COUNT + 1))
fi

# ---------------------------------------------------------------------------
# 6. 清空 demo tests
# ---------------------------------------------------------------------------
info "清除 demo tests..."

# 保留 infrastructure 測試 (server/utils only)
INFRA_TEST_DIR="test/unit/server/utils"
INFRA_TEST_COUNT=0
if [ -d "$INFRA_TEST_DIR" ]; then
  INFRA_TEST_COUNT=$(find "$INFRA_TEST_DIR" -type f -name '*.test.ts' | wc -l | tr -d ' ')
fi

# 移除非 infrastructure 測試
demo_test_count=0
for f in $(find test -type f -name '*.test.ts' ! -path 'test/unit/server/utils/*' 2>/dev/null); do
  rm "$f"
  demo_test_count=$((demo_test_count + 1))
done

# 清理空目錄但保留結構
find test -mindepth 1 -type d -empty -exec sh -c 'touch "$1/.gitkeep"' _ {} \; 2>/dev/null || true

if [ "$demo_test_count" -gt 0 ]; then
  success "移除 $demo_test_count 個 demo tests（保留 $INFRA_TEST_COUNT 個 infrastructure tests）"
  REMOVED_COUNT=$((REMOVED_COUNT + demo_test_count))
else
  info "沒有 demo tests 需要移除"
fi
KEPT_COUNT=$((KEPT_COUNT + INFRA_TEST_COUNT))

# ---------------------------------------------------------------------------
# 7. 清空 database migrations
# ---------------------------------------------------------------------------
clean_dir "supabase/migrations" "supabase/migrations/"

# ---------------------------------------------------------------------------
# 8. 清空 seed.sql
# ---------------------------------------------------------------------------
if [ -f "supabase/seed.sql" ]; then
  echo "-- Seed data" > supabase/seed.sql
  success "重設 supabase/seed.sql"
else
  info "supabase/seed.sql 不存在，跳過"
fi

# ---------------------------------------------------------------------------
# 9. 重設 database.types.ts 為空白結構
# ---------------------------------------------------------------------------
info "重設 database.types.ts..."
apply_template "app/types/database.types.ts" "app/types/database.types.ts"

# ---------------------------------------------------------------------------
# 10. 套用模板：(home).vue, app.vue, layouts
# ---------------------------------------------------------------------------
info "套用模板檔..."
apply_template "app/pages/(home).vue" "app/pages/(home).vue"
apply_template "app/app.vue" "app/app.vue"
apply_template "app/layouts/default.vue" "app/layouts/default.vue"
apply_template "app/layouts/auth.vue" "app/layouts/auth.vue"

# ---------------------------------------------------------------------------
# 11. 更新 wrangler.toml 專案名稱
# ---------------------------------------------------------------------------
if [ -f "wrangler.toml" ]; then
  sed -i '' "s/^name = \".*\"/name = \"${PROJECT_NAME}\"/" wrangler.toml
  success "更新 wrangler.toml name → ${PROJECT_NAME}"
else
  warn "wrangler.toml 不存在，跳過"
fi

# ---------------------------------------------------------------------------
# 12. 更新 supabase/config.toml project_id
# ---------------------------------------------------------------------------
if [ -f "supabase/config.toml" ]; then
  sed -i '' "s/^project_id = \".*\"/project_id = \"${PROJECT_NAME}\"/" supabase/config.toml
  success "更新 supabase/config.toml project_id → ${PROJECT_NAME}"
else
  warn "supabase/config.toml 不存在，跳過"
fi

# ---------------------------------------------------------------------------
# 13. 更新 package.json name, version, repository
# ---------------------------------------------------------------------------
info "更新 package.json..."
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.name = '${PROJECT_NAME}';
pkg.version = '0.1.0';
if (pkg.repository) pkg.repository.url = '';
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"
success "更新 package.json（name: ${PROJECT_NAME}, version: 0.1.0）"

# ---------------------------------------------------------------------------
# 14. 重新產生 .env（含新 secrets）
# ---------------------------------------------------------------------------
if [ -f ".env.example" ]; then
  cp .env.example .env
  NEW_AUTH_SECRET=$(openssl rand -hex 32)
  NEW_SESSION_PASS=$(openssl rand -hex 32)
  sed -i '' "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=${NEW_AUTH_SECRET}|" .env
  sed -i '' "s|^NUXT_SESSION_PASSWORD=.*|NUXT_SESSION_PASSWORD=${NEW_SESSION_PASS}|" .env
  success "重新產生 .env（含新的 BETTER_AUTH_SECRET 和 NUXT_SESSION_PASSWORD）"
else
  warn ".env.example 不存在，跳過 .env 產生"
fi

# ---------------------------------------------------------------------------
# 15. 替換 README.md 為新專案模板
# ---------------------------------------------------------------------------
apply_template "README.md" "README.md"

# ---------------------------------------------------------------------------
# 16. 清空 openspec/changes/（active + archive）
# ---------------------------------------------------------------------------
info "清空 openspec changes..."
openspec_removed=0

# 移除 active changes（archive 以外的子目錄）
for d in openspec/changes/*/; do
  dir_name="$(basename "$d")"
  if [ "$dir_name" != "archive" ]; then
    rm -rf "$d"
    openspec_removed=$((openspec_removed + 1))
  fi
done

# 清空 archive 內容
if [ -d "openspec/changes/archive" ]; then
  archive_count=$(find openspec/changes/archive -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
  if [ "$archive_count" -gt 0 ]; then
    rm -rf openspec/changes/archive/*/
    openspec_removed=$((openspec_removed + archive_count))
  fi
fi

# 確保目錄結構存在
touch openspec/changes/.gitkeep
touch openspec/changes/archive/.gitkeep

if [ "$openspec_removed" -gt 0 ]; then
  success "清除 ${openspec_removed} 個 openspec changes"
else
  info "沒有 openspec changes 需要清除"
fi

# ---------------------------------------------------------------------------
# 17. 替換 openspec/project.md 為模板
# ---------------------------------------------------------------------------
apply_template "openspec/project.md" "openspec/project.md"

# ---------------------------------------------------------------------------
# 18. 重置 .spectra/（保留必要骨架，移除 runtime 狀態）
# ---------------------------------------------------------------------------
if [ -d ".spectra" ]; then
  find .spectra -mindepth 1 ! -name '.gitkeep' -exec rm -rf {} +
  touch .spectra/.gitkeep
  success "重置 .spectra/（保留 .gitkeep，移除 runtime 狀態）"
else
  mkdir -p .spectra
  touch .spectra/.gitkeep
  success "建立 .spectra/ 骨架（.gitkeep）"
fi

# ---------------------------------------------------------------------------
# 20. 更新 nuxt.config.ts 中的 starter 名稱
# ---------------------------------------------------------------------------
if [ -f "nuxt.config.ts" ]; then
  sed -i '' "s|service: 'nuxt-supabase-starter'|service: '${PROJECT_NAME}'|" nuxt.config.ts
  sed -i '' "s|name: 'Nuxt Supabase Starter'|name: '${PROJECT_NAME}'|" nuxt.config.ts
  sed -i '' "s|description: 'Production-ready Nuxt + Supabase starter template'|description: '${PROJECT_NAME}'|" nuxt.config.ts
  success "更新 nuxt.config.ts（evlog service + site SEO）"
fi

# ---------------------------------------------------------------------------
# 20b. 更新 docs VitePress 設定中的 starter 名稱
# ---------------------------------------------------------------------------
if [ -f "docs/.vitepress/config.ts" ]; then
  sed -i '' "s/title: 'Nuxt Supabase Starter'/title: '${PROJECT_NAME}'/" docs/.vitepress/config.ts
  sed -i '' "s|https://github.com/YuDefine/nuxt-supabase-starter||" docs/.vitepress/config.ts
  success "更新 docs/.vitepress/config.ts"
fi
if [ -f "docs/index.md" ]; then
  sed -i '' "s/name: Nuxt Supabase Starter/name: ${PROJECT_NAME}/" docs/index.md
  sed -i '' "s/text: Production-ready full-stack template/text: ${PROJECT_NAME}/" docs/index.md
  success "更新 docs/index.md"
fi

# ---------------------------------------------------------------------------
# 20c. 清理文件中的 starter 語境殘留
# ---------------------------------------------------------------------------
# VitePress description
if [ -f "docs/.vitepress/config.ts" ]; then
  sed -i '' "s/Production-ready Nuxt + Supabase starter template/${PROJECT_NAME} Documentation/" docs/.vitepress/config.ts
fi
# NEW_PROJECT_CHECKLIST
if [ -f "docs/NEW_PROJECT_CHECKLIST.md" ]; then
  sed -i '' 's/使用本 starter 建立新專案後，請確認以下項目都已完成。/新專案建立後，請確認以下項目都已完成。/' docs/NEW_PROJECT_CHECKLIST.md
  success "更新 docs/NEW_PROJECT_CHECKLIST.md"
fi
# FAQ
if [ -f "docs/FAQ.md" ]; then
  sed -i '' 's/本 [Ss]tarter 的功能/本專案的功能/g' docs/FAQ.md
  success "更新 docs/FAQ.md"
fi

# ---------------------------------------------------------------------------
# 21. Starter 專屬文件（已移至 repo root docs/，無需移除）
# ---------------------------------------------------------------------------
info "Starter 展示文件已在 repo root docs/，跳過"

# ---------------------------------------------------------------------------
# 21b. 移除 starter scaffolding CLI（packages/create-nuxt-starter）
# ---------------------------------------------------------------------------
if [ -d "packages/create-nuxt-starter" ]; then
  rm -rf packages/create-nuxt-starter
  success "移除 packages/create-nuxt-starter/"
fi
# 若 packages/ 目錄空了，移除
if [ -d "packages" ] && [ -z "$(ls -A packages 2>/dev/null)" ]; then
  rm -rf packages
  success "移除空的 packages/ 目錄"
fi
# 更新 pnpm-workspace.yaml：移除 packages 區塊，保留 ignoredBuiltDependencies
if [ -f "pnpm-workspace.yaml" ]; then
  sed -n '/^ignoredBuiltDependencies:/,$ p' pnpm-workspace.yaml > pnpm-workspace.yaml.tmp
  mv pnpm-workspace.yaml.tmp pnpm-workspace.yaml
  success "更新 pnpm-workspace.yaml（移除 packages/*，保留 ignoredBuiltDependencies）"
fi

# ---------------------------------------------------------------------------
# 22. 更新 browser-use-screenshot skill 中的 starter 名稱
# ---------------------------------------------------------------------------
for skill_file in \
  ".claude/skills/browser-use-screenshot/SKILL.md" \
  ".claude/skills/review-screenshot.md"; do
  if [ -f "$skill_file" ]; then
    sed -i '' "s/nuxt-supabase-starter/${PROJECT_NAME}/g" "$skill_file"
  fi
done
success "更新 skill 檔案中的專案名稱"

# ---------------------------------------------------------------------------
# 22b. 更新 setup.sh banner
# ---------------------------------------------------------------------------
if [ -f "scripts/setup.sh" ]; then
  sed -i '' "s/Nuxt Supabase Starter — 環境初始化/${PROJECT_NAME} — 環境初始化/" scripts/setup.sh
  success "更新 scripts/setup.sh banner"
fi

# ---------------------------------------------------------------------------
# 23. 移除壞掉的 skill symlinks
# ---------------------------------------------------------------------------
broken_links=$(find .claude/skills -maxdepth 1 -type l ! -exec test -e {} \; -print 2>/dev/null | wc -l | tr -d ' ')
if [ "$broken_links" -gt 0 ]; then
  find .claude/skills -maxdepth 1 -type l ! -exec test -e {} \; -delete
  success "移除 ${broken_links} 個壞掉的 skill symlinks"
else
  info "沒有壞掉的 skill symlinks"
fi

# ---------------------------------------------------------------------------
# 23b. 重新安裝第三方 skills（補回被刪除的 symlinks）
# ---------------------------------------------------------------------------
if [ -f "scripts/install-skills.sh" ]; then
  info "重新安裝第三方 skills..."
  if bash scripts/install-skills.sh > /dev/null 2>&1; then
    success "第三方 skills 安裝完成"
  else
    warn "第三方 skills 安裝失敗（可稍後手動執行 pnpm skills:install）"
  fi
fi

# ---------------------------------------------------------------------------
# 24. 更新 CLAUDE.md auth 描述
# ---------------------------------------------------------------------------
if [ -f "CLAUDE.md" ]; then
  # 保持「二擇一」描述，由 pnpm setup 根據使用者選擇決定
  info "CLAUDE.md auth 描述保持通用（由 pnpm setup 決定）"
fi

# ---------------------------------------------------------------------------
# 結果報告
# ---------------------------------------------------------------------------
echo ""
echo -e "${GREEN}=============================================${NC}"
echo -e "${GREEN}  Clean 完成！${NC}"
echo -e "${GREEN}=============================================${NC}"
echo ""
echo "  移除: $REMOVED_COUNT 個 demo 檔案"
echo "  保留: infrastructure 程式碼（layouts, middleware, server utils, etc.）"
echo ""
echo -e "  專案名稱: ${CYAN}${PROJECT_NAME}${NC}"
echo ""
echo "下一步："
echo "  1. 檢查 git diff 確認變更"
echo "  2. 執行 pnpm setup 設定認證系統與環境變數"
echo "  3. 執行 pnpm typecheck 確認型別正確"
echo "  4. 執行 pnpm test 確認測試通過"
echo "  5. 開始建立你的第一個 migration："
echo "     supabase migration new your_first_table"
echo ""
