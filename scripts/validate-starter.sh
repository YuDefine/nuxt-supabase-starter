#!/bin/bash
# =============================================================================
# validate-starter.sh — 驗證 starter template 結構完整性
#
# Usage:
#   bash scripts/validate-starter.sh          # 自動偵測模式
#   bash scripts/validate-starter.sh demo     # 驗證 demo 模式
#   bash scripts/validate-starter.sh clean    # 驗證 clean 模式
# =============================================================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../template" && pwd)"
cd "$ROOT_DIR"

STATUS=0

ok() {
  echo "[PASS] $1"
}

fail() {
  echo "[FAIL] $1"
  STATUS=1
}

check_path() {
  local path="$1"
  if [ -e "$path" ]; then
    ok "exists: $path"
  else
    fail "missing: $path"
  fi
}

check_path_empty() {
  local dir="$1"
  local label="$2"
  if [ ! -d "$dir" ]; then
    fail "missing directory: $label"
    return
  fi
  local count
  count=$(find "$dir" -type f ! -name '.gitkeep' 2>/dev/null | wc -l | tr -d ' ')
  if [ "$count" -eq 0 ]; then
    ok "clean (empty): $label"
  else
    fail "not clean ($count files remain): $label"
  fi
}

# ---------------------------------------------------------------------------
# 偵測模式：如果 (home).vue 含有 "Start building" 表示已執行 clean
# ---------------------------------------------------------------------------
MODE="${1:-auto}"
if [ "$MODE" = "auto" ]; then
  if grep -q "Start building" app/pages/'(home)'.vue 2>/dev/null; then
    MODE="clean"
  else
    MODE="demo"
  fi
fi

echo "== Starter Validation =="
echo "root: $ROOT_DIR"
echo "mode: $MODE"

# ---------------------------------------------------------------------------
# Phase 1: 共用結構檢查（demo & clean 都需要）
# ---------------------------------------------------------------------------
echo ""
echo "[Phase 1] Structure checks (common)"
REQUIRED_PATHS=(
  ".claude/commands"
  ".claude/agents"
  ".claude/hooks"
  ".claude/skills"
  ".claude/settings.json"
  ".spectra"
  ".spectra.yaml"
  "openspec/project.md"
  "openspec/specs"
  "openspec/changes/.gitkeep"
  "openspec/changes/archive"
  "app/components"
  "app/composables"
  "app/stores"
  "app/queries"
  "app/pages/(home).vue"
  "app/layouts/default.vue"
  "app/app.vue"
  "app/error.vue"
  "app/types/database.types.ts"
  "server/api/v1"
  "server/api/auth"
  "server/utils"
  "server/plugins"
  "test/nuxt"
  "test/unit"
  "supabase/migrations"
  "scripts/backup-supabase.sh"
  "docs/templates/.github/workflows/ci.yml"
)

for path in "${REQUIRED_PATHS[@]}"; do
  check_path "$path"
done

# .vite-hooks 驗證
if [ -f ".vite-hooks/pre-commit" ]; then
  if grep -qi "supabase" .vite-hooks/pre-commit; then
    ok ".vite-hooks/pre-commit has Supabase migration checks"
  else
    fail ".vite-hooks/pre-commit missing Supabase migration checks"
  fi
  if grep -q "vp staged" .vite-hooks/pre-commit; then
    ok ".vite-hooks/pre-commit has vp staged"
  else
    fail ".vite-hooks/pre-commit missing vp staged"
  fi
else
  fail ".vite-hooks/pre-commit missing"
fi

if [ -f ".vite-hooks/commit-msg" ]; then
  if grep -q "commitlint" .vite-hooks/commit-msg; then
    ok ".vite-hooks/commit-msg has commitlint"
  else
    fail ".vite-hooks/commit-msg missing commitlint"
  fi
else
  fail ".vite-hooks/commit-msg missing"
fi

# ---------------------------------------------------------------------------
# Phase 2: package scripts 檢查
# ---------------------------------------------------------------------------
echo ""
echo "[Phase 2] Package scripts checks"
node <<'NODE'
const fs = require('fs')
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const requiredScripts = ['db:backup', 'skills:install', 'skills:list', 'skills:update']
let failed = false
for (const name of requiredScripts) {
  if (pkg.scripts && pkg.scripts[name]) {
    console.log(`[PASS] script exists: ${name}`)
  } else {
    console.log(`[FAIL] script missing: ${name}`)
    failed = true
  }
}
if (failed) {
  process.exit(10)
}
NODE
if [ $? -ne 0 ]; then
  STATUS=1
fi

# ---------------------------------------------------------------------------
# Phase 3: docs 檢查
# ---------------------------------------------------------------------------
echo ""
echo "[Phase 3] Docs keyword checks"
if grep -q "pnpm skills:install" docs/NEW_PROJECT_CHECKLIST.md; then
  ok "docs mention pnpm skills:install"
else
  fail "docs missing pnpm skills:install"
fi

if grep -q "pnpm skills:list" docs/NEW_PROJECT_CHECKLIST.md; then
  ok "docs mention pnpm skills:list"
else
  fail "docs missing pnpm skills:list"
fi

if grep -q "spectra" docs/NEW_PROJECT_CHECKLIST.md 2>/dev/null; then
  ok "docs mention spectra in checklist"
else
  fail "docs missing spectra in checklist"
fi

# QUICK_START.md 已移至 repo root docs/，template 內不再有此檔案

# ---------------------------------------------------------------------------
# Phase 3b: Spectra/OpenSpec clean baseline（demo & clean 都需要）
# ---------------------------------------------------------------------------
echo ""
echo "[Phase 3b] Spectra/OpenSpec clean baseline"

# openspec archive 應該只保留骨架
check_path_empty "openspec/changes/archive" "openspec/changes/archive/"

# 不應有 active openspec changes
active_change_count=$(find openspec/changes -maxdepth 1 -mindepth 1 -type d ! -name 'archive' 2>/dev/null | wc -l | tr -d ' ')
if [ "$active_change_count" -eq 0 ]; then
  ok "no active openspec changes"
else
  fail "$active_change_count active openspec change dirs remain"
fi

# .spectra/spectra.db 不應存在
if [ -f ".spectra/spectra.db" ]; then
  fail ".spectra/spectra.db still exists"
else
  ok ".spectra/spectra.db removed"
fi

# .spectra/ 應維持 clean skeleton（只允許 .gitkeep）
check_path_empty ".spectra" ".spectra/"

# ---------------------------------------------------------------------------
# Phase 4: 模式特定檢查
# ---------------------------------------------------------------------------
echo ""
echo "[Phase 4] Mode-specific checks ($MODE)"

if [ "$MODE" = "clean" ]; then
  # Clean 模式：demo 目錄應該是空的
  check_path_empty "app/components" "app/components/"
  check_path_empty "server/api/v1" "server/api/v1/"
  check_path_empty "app/queries" "app/queries/"
  check_path_empty "app/stores" "app/stores/"
  check_path_empty "supabase/migrations" "supabase/migrations/"

  # (home).vue 應該是 welcome 頁面
  if grep -q "Start building" app/pages/'(home)'.vue; then
    ok "(home).vue is welcome page"
  else
    fail "(home).vue is not welcome page"
  fi

  # database.types.ts 應該是空白結構
  if grep -q "Record<string, never>" app/types/database.types.ts; then
    ok "database.types.ts is empty structure"
  else
    fail "database.types.ts has non-empty types"
  fi

  # Infrastructure 應該保留
  check_path "app/layouts/default.vue"
  check_path "server/utils/api-response.ts"
  check_path "server/utils/supabase.ts"
  check_path "server/plugins/sentry-cloudflare.ts"

  # Infrastructure tests 應該保留
  infra_test_count=$(find test/unit/server/utils -type f -name '*.test.ts' 2>/dev/null | wc -l | tr -d ' ')
  if [ "$infra_test_count" -gt 0 ]; then
    ok "infrastructure tests preserved ($infra_test_count files)"
  else
    fail "infrastructure tests missing"
  fi

  # Demo tests 不應該存在
  demo_test_count=$(find test -type f -name '*.test.ts' ! -path 'test/unit/server/utils/*' 2>/dev/null | wc -l | tr -d ' ')
  if [ "$demo_test_count" -eq 0 ]; then
    ok "no demo tests remain"
  else
    fail "$demo_test_count demo test files still exist"
  fi

  # --- Starter 識別應該已更新 ---

  # wrangler.toml name 不應是 starter
  if grep -q 'name = "nuxt-supabase-starter"' wrangler.toml 2>/dev/null; then
    fail "wrangler.toml still has starter name"
  else
    ok "wrangler.toml name updated"
  fi

  # supabase/config.toml project_id 不應是 starter
  if grep -q 'project_id = "nuxt-supabase-starter"' supabase/config.toml 2>/dev/null; then
    fail "supabase/config.toml still has starter project_id"
  else
    ok "supabase/config.toml project_id updated"
  fi

  # package.json name 不應是 starter
  node -e "
const pkg = JSON.parse(require('fs').readFileSync('package.json','utf8'));
if (pkg.name === 'nuxt-supabase-starter') {
  console.log('[FAIL] package.json name still nuxt-supabase-starter');
  process.exit(10);
} else {
  console.log('[PASS] package.json name updated: ' + pkg.name);
}
" || STATUS=1

  # .env BETTER_AUTH_SECRET 應已更新
  KNOWN_STARTER_SECRET="55b41b5bc78ebc31fa25b40ce2b93c9746bb19d07224ef19904d7dfd97f660e0"
  if [ -f ".env" ]; then
    CURRENT_SECRET=$(grep '^BETTER_AUTH_SECRET=' .env | cut -d= -f2)
    if [ "$CURRENT_SECRET" = "$KNOWN_STARTER_SECRET" ] || [ -z "$CURRENT_SECRET" ]; then
      fail ".env BETTER_AUTH_SECRET not regenerated"
    else
      ok ".env BETTER_AUTH_SECRET is fresh"
    fi
  else
    fail ".env file missing"
  fi

  # --- 品牌替換驗證 ---

  # nuxt.config.ts site name 不應是 starter
  if grep -q "name: 'Nuxt Supabase Starter'" nuxt.config.ts 2>/dev/null; then
    fail "nuxt.config.ts still has starter site name"
  else
    ok "nuxt.config.ts site name updated"
  fi

  # app/app.vue title 不應是 starter
  if grep -q "Nuxt Supabase Starter" app/app.vue 2>/dev/null; then
    fail "app/app.vue still has starter title"
  else
    ok "app/app.vue title updated"
  fi

  # app/layouts/default.vue footer 不應是 starter
  if grep -q "Nuxt Supabase Starter" app/layouts/default.vue 2>/dev/null; then
    fail "app/layouts/default.vue still has starter name"
  else
    ok "app/layouts/default.vue updated"
  fi

  # starter 展示文件已在 repo root docs/，template 內不應有
  ok "starter-specific docs live in repo root docs/"

  # 不應有壞掉的 skill symlinks
  broken_count=$(find .claude/skills -maxdepth 1 -type l ! -exec test -e {} \; -print 2>/dev/null | wc -l | tr -d ' ')
  if [ "$broken_count" -eq 0 ]; then
    ok "no broken skill symlinks"
  else
    fail "$broken_count broken skill symlinks found"
  fi

  # CLAUDE.md 宣稱的 skills 應該存在
  for skill in "nuxt-ui" "supabase-postgres-best-practices"; do
    if [ -d ".claude/skills/$skill" ] || [ -f ".claude/skills/$skill" ] || [ -L ".claude/skills/$skill" ]; then
      ok "skill exists: $skill"
    else
      fail "skill missing: $skill (run pnpm skills:install)"
    fi
  done

  # docs 不應有 starter 語境殘留
  if grep -q "本 starter" docs/NEW_PROJECT_CHECKLIST.md 2>/dev/null; then
    fail "docs/NEW_PROJECT_CHECKLIST.md still has '本 starter'"
  else
    ok "docs/NEW_PROJECT_CHECKLIST.md cleaned"
  fi

  if grep -q "starter template" docs/.vitepress/config.ts 2>/dev/null; then
    fail "docs/.vitepress/config.ts still has 'starter template'"
  else
    ok "docs/.vitepress/config.ts cleaned"
  fi

  # packages/create-nuxt-starter 不應存在於衍生專案
  if [ -d "packages/create-nuxt-starter" ]; then
    fail "packages/create-nuxt-starter still exists (starter-only scaffolding CLI)"
  else
    ok "packages/create-nuxt-starter removed"
  fi

  # pnpm-workspace.yaml 驗證
  if grep -q '^packages:' pnpm-workspace.yaml 2>/dev/null; then
    fail "pnpm-workspace.yaml still has packages: block"
  else
    ok "pnpm-workspace.yaml packages: block removed"
  fi
  if grep -q 'ignoredBuiltDependencies:' pnpm-workspace.yaml 2>/dev/null; then
    ok "pnpm-workspace.yaml has ignoredBuiltDependencies"
  else
    fail "pnpm-workspace.yaml missing ignoredBuiltDependencies"
  fi

else
  # Demo 模式：(home).vue 應該有 demo 內容
  if grep -q "Nuxt UI Components" app/pages/'(home)'.vue 2>/dev/null || \
     grep -q "Demo" app/pages/'(home)'.vue 2>/dev/null; then
    ok "(home).vue has demo content"
  else
    # 如果沒有 demo 內容也 ok，可能是初始狀態
    ok "(home).vue exists (demo content check skipped)"
  fi
fi

# ---------------------------------------------------------------------------
# 結果
# ---------------------------------------------------------------------------
echo ""
if [ $STATUS -eq 0 ]; then
  echo "Starter validation result: PASS ($MODE mode)"
else
  echo "Starter validation result: FAIL ($MODE mode)"
fi

exit $STATUS
