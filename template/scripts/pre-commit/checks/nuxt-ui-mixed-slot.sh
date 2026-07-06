#!/usr/bin/env bash
# CLADE:VENDOR-SCRIPT
#
# nuxt-ui-mixed-slot (pre-commit, staged) — 擋 staged .vue 在 UDashboardPanel 內混用
# named <template #...> 與 stray 直接子元素（named slots 是 default slot fallback，
# 混用 → header/body/footer 整組靜默不 render，頁面全空、無任何錯誤）。
#
# 跟 pre-push 同名 check 的分工：
#   - pre-commit checks/nuxt-ui-mixed-slot.sh : 只掃本次 staged *.vue（blocking，最接近犯錯時點）
#   - pre-push  checks/nuxt-ui-mixed-slot.sh  : 掃全 repo *.vue（blocking 回溯型；fleet 基線 0 hit）
#
# 實證：TDMS /reports/daily-machining 空白 18 天（commit 5aa52e92 重構成 named slots
# 但留一個 slideover 在 template 外）。typecheck / lint / console 全綠。
#
# Auto-detect：只掃本次 commit staged 的 *.vue；無 staged .vue 直接跳過（no-op exit 0）。
# 偵測邏輯共用 vendor/scripts/checks/nuxt-ui-mixed-slot-detect.mjs。
#
# 規約來源：
#   - pitfall : docs/pitfalls/2026-07-06-nuxt-ui-named-slot-default-fallback-shadowing.md（TD-236）
#
# 由 ~/clade vendor/scripts/pre-commit/ 散播，請勿直接編輯 consumer 副本。

set -euo pipefail

PROJECT_ROOT="$(git rev-parse --show-toplevel)"
cd "$PROJECT_ROOT"

DETECTOR="scripts/checks/nuxt-ui-mixed-slot-detect.mjs"
[[ -f "$DETECTOR" ]] || DETECTOR="vendor/scripts/checks/nuxt-ui-mixed-slot-detect.mjs"
[[ -f "$DETECTOR" ]] || exit 0 # detector 未散播到此 consumer → no-op

# 蒐集本次 staged 的 .vue
staged_vue=()
while IFS= read -r -d '' file; do
  staged_vue+=("$file")
done < <(git diff --cached --name-only --diff-filter=ACM -z -- '*.vue')

((${#staged_vue[@]} == 0)) && exit 0

# detector 對 staged 檔跑；命中 exit 1（blocking）。
exec node "$DETECTOR" "${staged_vue[@]}"
