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

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

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
echo -e "${YELLOW}  Nuxt Supabase Starter — Create Clean      ${NC}"
echo -e "${YELLOW}=============================================${NC}"
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
cat > app/types/database.types.ts << 'TYPES'
/**
 * Supabase Database Types
 *
 * 此檔案由 Supabase CLI 自動產生：
 * supabase gen types typescript --local | tee app/types/database.types.ts > /dev/null
 *
 * 初始為空，請在建立 migration 後重新產生。
 */

export interface Database {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
TYPES
success "重設 database.types.ts"

# ---------------------------------------------------------------------------
# 10. 替換 (home).vue 為簡潔 welcome 頁面
# ---------------------------------------------------------------------------
info "更新 (home).vue 為 welcome 頁面..."
cat > app/pages/'(home)'.vue << 'HOMEVUE'
<script setup lang="ts">
  useSeoMeta({
    title: 'Welcome',
  })
</script>

<template>
  <div class="flex min-h-[60vh] flex-col items-center justify-center">
    <h1 class="text-4xl font-bold text-(--ui-text-highlighted)">
      Nuxt Supabase Starter
    </h1>
    <p class="mt-4 text-lg text-(--ui-text-muted)">
      Your project is ready. Start building!
    </p>
    <div class="mt-8 flex gap-4">
      <UButton
        to="https://nuxt.com/docs"
        target="_blank"
        variant="outline"
        icon="i-lucide-book-open"
      >
        Nuxt Docs
      </UButton>
      <UButton
        to="https://supabase.com/docs"
        target="_blank"
        variant="outline"
        icon="i-lucide-database"
      >
        Supabase Docs
      </UButton>
    </div>
  </div>
</template>
HOMEVUE
success "更新 (home).vue"

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
echo "下一步："
echo "  1. 檢查 git diff 確認變更"
echo "  2. 執行 pnpm typecheck 確認型別正確"
echo "  3. 執行 pnpm test 確認測試通過"
echo "  4. 開始建立你的第一個 migration："
echo "     supabase migration new your_first_table"
echo ""
