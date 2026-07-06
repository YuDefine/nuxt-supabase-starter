#!/usr/bin/env bash
# CLADE:VENDOR-SCRIPT
#
# nuxt-ui-mixed-slot (pre-push, repo-wide) — 全站掃 UDashboardPanel 混用
# named <template #...> 與 stray 直接子元素（named slots 是 default slot fallback，
# 混用 → header/body/footer 整組靜默不 render，頁面全空、無任何錯誤）。
#
# 跟 pre-commit 同名 check 的分工：
#   - pre-commit checks/nuxt-ui-mixed-slot.sh : 只掃本次 staged *.vue（blocking，最接近犯錯時點）
#   - pre-push  checks/nuxt-ui-mixed-slot.sh  : 掃全 repo *.vue（blocking 回溯型；2026-07-06
#                                               全 fleet 掃描基線 0 hit，可直接 blocking）
#
# 實證：TDMS /reports/daily-machining 空白 18 天（pitfall:
# 2026-07-06-nuxt-ui-named-slot-default-fallback-shadowing，TD-236）。
#
# Auto-detect：偵測 nuxt.config.* 存在才跑；非 Nuxt repo 自動 no-op（exit 0）。
#
# 由 ~/clade vendor/scripts/pre-push/ 散播，請勿直接編輯 consumer 副本。

set -euo pipefail

PROJECT_ROOT="$(git rev-parse --show-toplevel)"
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

DETECTOR="scripts/checks/nuxt-ui-mixed-slot-detect.mjs"
[[ -f "$DETECTOR" ]] || DETECTOR="vendor/scripts/checks/nuxt-ui-mixed-slot-detect.mjs"
[[ -f "$DETECTOR" ]] || exit 0 # detector 未散播到此 consumer → no-op

exec node "$DETECTOR" --all
