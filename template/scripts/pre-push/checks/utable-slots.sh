#!/usr/bin/env bash
# CLADE:VENDOR-SCRIPT
#
# utable-slots (pre-push, repo-wide) — 全站掃 <UTable> 內漏掉 `-cell` 後綴的 cell slot
# （Nuxt UI 不會把它當 cell renderer → 該欄靜默回退成預設渲染，無任何錯誤訊息）。
#
# 跟 pre-commit 同名 check 的分工：
#   - pre-commit checks/utable-slots.sh : 只掃本次 staged *.vue（blocking，最接近犯錯時點）
#   - pre-push  checks/utable-slots.sh  : 掃全 repo *.vue（blocking 回溯型；2026-07-25
#                                         全 fleet 掃描基線 0 hit，可直接 blocking）
#
# Auto-detect：偵測 nuxt.config.* 存在才跑；非 Nuxt repo 自動 no-op（exit 0）。
#
# 規約來源：rules/modules/framework/nuxt/nuxt-ui-conventions.md § 靜默失效檢查
#
# 由 ~/clade vendor/scripts/pre-push/ 散播，請勿直接編輯 consumer 副本。

set -euo pipefail

# PROJECT_ROOT 允許被 CLADE_PROJECT_ROOT 覆寫。meta-monorepo（app root 在子目錄，例如
# nuxt-supabase-starter 的 template/）的 app root ≠ git toplevel，而下方 auto-detect 是
# 「找不到 nuxt.config 就 exit 0」，直接用 toplevel 會讓這道 check 靜默 no-op。
# 未設 CLADE_PROJECT_ROOT 時行為與過去完全一致（既有 consumer 零影響）。
PROJECT_ROOT="${CLADE_PROJECT_ROOT:-$(git rev-parse --show-toplevel)}"
cd "$PROJECT_ROOT"

# Auto-detect：無 nuxt.config 直接跳過
nuxt_config=""
for ext in ts mts js mjs; do
  if [[ -f "nuxt.config.$ext" ]]; then
    nuxt_config="nuxt.config.$ext"
    break
  fi
done
[[ -n "$nuxt_config" ]] || exit 0

DETECTOR="scripts/checks/utable-slot-detect.ts"
[[ -f "$DETECTOR" ]] || DETECTOR="vendor/scripts/checks/utable-slot-detect.ts"
[[ -f "$DETECTOR" ]] || exit 0 # detector 未散播到此 consumer → no-op

exec node "$DETECTOR" --all
