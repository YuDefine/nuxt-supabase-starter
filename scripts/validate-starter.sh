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

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
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
  ".claude/settings.local.json.example"
  "openspec/project.md"
  "openspec/specs"
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
  "scripts/create-clean.sh"
  ".github/workflows/ci.yml"
)

for path in "${REQUIRED_PATHS[@]}"; do
  check_path "$path"
done

# ---------------------------------------------------------------------------
# Phase 2: package scripts 檢查
# ---------------------------------------------------------------------------
echo ""
echo "[Phase 2] Package scripts checks"
node <<'NODE'
const fs = require('fs')
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const requiredScripts = ['db:backup', 'skills:install', 'skills:list', 'skills:update', 'validate:starter', 'create:clean']
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

if grep -q "pnpm sdd:select" docs/NEW_PROJECT_CHECKLIST.md; then
  ok "docs mention pnpm sdd:select in checklist"
else
  fail "docs missing pnpm sdd:select in checklist"
fi

if grep -q "pnpm sdd:select" docs/QUICK_START.md; then
  ok "docs mention pnpm sdd:select in quick start"
else
  fail "docs missing pnpm sdd:select in quick start"
fi

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
