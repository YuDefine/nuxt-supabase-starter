#!/usr/bin/env bash
# CLADE:VENDOR-SCRIPT
#
# test-tsconfig — pre-push 跑 test/ 目錄的 tsc --noEmit
#
# Auto-detect：偵測 test/tsconfig.json 存在才跑。
# 為什麼獨立檢查：test 目錄常有自己的 tsconfig（不同 lib/types），
# nuxt typecheck 預設不涵蓋。

set -euo pipefail

PROJECT_ROOT="$(git rev-parse --show-toplevel)"
cd "$PROJECT_ROOT"

[[ -f "test/tsconfig.json" ]] || exit 0

echo "🔍 tsc -p test/tsconfig.json --noEmit..."
pnpm exec tsc -p test/tsconfig.json --noEmit
