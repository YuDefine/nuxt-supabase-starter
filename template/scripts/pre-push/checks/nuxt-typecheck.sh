#!/usr/bin/env bash
# 🔒 LOCKED — managed by clade · Source: vendor/scripts/pre-push/checks/nuxt-typecheck.sh · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/pre-push/checks/nuxt-typecheck.sh
# CLADE:VENDOR-SCRIPT
#
# nuxt-typecheck — pre-push 跑一次 full project typecheck
#
# Auto-detect：偵測 nuxt.config.* 存在才跑。
#
# Multi-client / layered repos：偵測到 package.json 有 `typecheck` script 時
# 改跑 `pnpm typecheck`（consumer 自家定義的正確 invocation），不跑 bare
# `nuxt typecheck`。理由：per-client module isolation 等架構下 root nuxt.config
# 可能刻意不 extend app layers，bare root typecheck 會把各 client layer 的
# auto-import 全報成 false「Cannot find name」。consumer 的 typecheck script
# 才知道要 client-scoped（`nuxt typecheck <client> --dotenv ...`）。
# 無 typecheck script 的單一 app repo 仍 fallback bare `nuxt typecheck`。

set -euo pipefail

# PROJECT_ROOT 允許被 CLADE_PROJECT_ROOT 覆寫。meta-monorepo（app root 在子目錄，例如
# nuxt-supabase-starter 的 template/）的 app root ≠ git toplevel，而下方 auto-detect 是
# 「找不到 nuxt.config 就 exit 0」，直接用 toplevel 會讓這道 check 靜默 no-op。
# 未設 CLADE_PROJECT_ROOT 時行為與過去完全一致（既有 consumer 零影響）。
PROJECT_ROOT="${CLADE_PROJECT_ROOT:-$(git rev-parse --show-toplevel)}"
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

# Prefer the consumer-defined `typecheck` npm script when present (multi-client /
# layered repos need client-scoped typecheck that bare root invocation can't express).
if node -e "process.exit(require('./package.json').scripts?.typecheck ? 0 : 1)" 2>/dev/null; then
  echo "🔍 nuxt typecheck (via consumer 'typecheck' script)..."
  pnpm run typecheck
else
  echo "🔍 nuxt typecheck (full project)..."
  pnpm exec nuxt typecheck
fi
