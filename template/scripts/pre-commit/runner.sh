#!/usr/bin/env bash
# CLADE:VENDOR-SCRIPT
#
# clade — pre-commit runner
#
# 由 consumer 的 .husky/pre-commit 統一呼叫：
#   bash scripts/pre-commit/runner.sh
#
# Auto-detect 啟用哪些 check（不需 hub.json 額外設定）：
#   - vp-staged                 永遠跑（vite-plus 官方推薦的 staged-file 工作流）
#   - supabase-migration-safety 偵測 supabase/migrations/*.sql 才跑
#   - native-picker-ban         偵測 staged *.vue 才跑（無 .vue 自動 no-op）
#   - review-rules-ban          偵測 staged *.vue 才跑（patterns.json 驅動，無 .vue 自動 no-op）
#   - data-perf-check           偵測 staged *.vue 才跑（setup context raw $fetch anti-pattern）
#
# 重型檢查（nuxt typecheck、test tsconfig）放 pre-push runner，不在 pre-commit 跑。
# 來源：vue-tsc / nuxi typecheck 不支援單檔 typecheck（issue #407），
#       2026 主流 best practice 把 typecheck 移到 pre-push 階段。
#
# 由 ~/clade vendor/scripts/pre-commit/ 散播，請勿直接編輯 consumer 副本。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECKS_DIR="$SCRIPT_DIR/checks"
PROJECT_ROOT="$(git rev-parse --show-toplevel)"

cd "$PROJECT_ROOT"

run_check() {
  local name="$1"
  local script="$CHECKS_DIR/$name.sh"
  if [[ ! -x "$script" ]]; then
    echo "[clade pre-commit] check 不存在或無執行權限：$script" >&2
    return 1
  fi
  bash "$script"
}

# 1) vp staged — 永遠跑
run_check vp-staged

# 2) supabase migration safety — 由 check 內部 auto-detect 是否需要跑
run_check supabase-migration-safety

# 3) native picker ban — 由 check 內部 auto-detect（無 staged *.vue 直接跳）
run_check native-picker-ban

# 4) review rules ban — patterns.json 驅動（無 staged *.vue 或無 patterns.json 直接跳）
run_check review-rules-ban

# 5) data-perf check — 偵測 staged .vue 中 setup context raw $fetch（無 staged .vue 直接跳）
run_check data-perf-check

# 6) mutation-loading — 偵測 staged .vue 把 Pinia Colada mutation status==='pending' 當 loading
run_check mutation-loading

# 7) nuxt-ui-mixed-slot — 偵測 staged .vue 在 UDashboardPanel 混用 named template + stray 子元素
run_check nuxt-ui-mixed-slot
