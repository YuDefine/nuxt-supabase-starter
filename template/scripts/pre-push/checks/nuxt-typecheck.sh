#!/usr/bin/env bash
# CLADE:VENDOR-SCRIPT
#
# nuxt-typecheck — pre-push 跑一次 full project typecheck
#
# Auto-detect：偵測 nuxt.config.* 存在才跑。

set -euo pipefail

PROJECT_ROOT="$(git rev-parse --show-toplevel)"
cd "$PROJECT_ROOT"

# Auto-detect
nuxt_config=""
for ext in ts mts js mjs; do
  if [[ -f "nuxt.config.$ext" ]]; then
    nuxt_config="nuxt.config.$ext"
    break
  fi
done
[[ -n "$nuxt_config" ]] || exit 0

echo "🔍 nuxt typecheck (full project)..."
pnpm exec nuxt typecheck
