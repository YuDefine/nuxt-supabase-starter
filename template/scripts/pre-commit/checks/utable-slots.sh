#!/usr/bin/env bash
# 🔒 LOCKED — managed by clade · Source: vendor/scripts/pre-commit/checks/utable-slots.sh · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/pre-commit/checks/utable-slots.sh
# CLADE:VENDOR-SCRIPT
#
# utable-slots (pre-commit, staged) — 擋 staged .vue 在 <UTable> 內把 cell slot 寫成
# `#<accessorKey>` 而漏掉 `-cell` 後綴。Vue 接受該 template（合法具名 slot），但
# Nuxt UI 不會把它當 cell renderer → 該欄靜默回退成預設渲染，typecheck / lint /
# console 全綠。
#
# 跟 pre-push 同名 check 的分工：
#   - pre-commit checks/utable-slots.sh : 只掃本次 staged *.vue（blocking，最接近犯錯時點）
#   - pre-push  checks/utable-slots.sh  : 掃全 repo *.vue（blocking 回溯型；fleet 基線 0 hit）
#
# Auto-detect：只掃本次 commit staged 的 *.vue；無 staged .vue 直接跳過（no-op exit 0）。
# 偵測邏輯共用 vendor/scripts/checks/utable-slot-detect.ts。
#
# 規約來源：rules/modules/framework/nuxt/nuxt-ui-conventions.md § 靜默失效檢查
#
# 由 ~/clade vendor/scripts/pre-commit/ 散播，請勿直接編輯 consumer 副本。

set -euo pipefail

PROJECT_ROOT="$(git rev-parse --show-toplevel)"
cd "$PROJECT_ROOT"

DETECTOR="scripts/checks/utable-slot-detect.ts"
[[ -f "$DETECTOR" ]] || DETECTOR="vendor/scripts/checks/utable-slot-detect.ts"
[[ -f "$DETECTOR" ]] || exit 0 # detector 未散播到此 consumer → no-op

# 蒐集本次 staged 的 .vue
staged_vue=()
while IFS= read -r -d '' file; do
  staged_vue+=("$file")
done < <(git diff --cached --name-only --diff-filter=ACM -z -- '*.vue')

((${#staged_vue[@]} == 0)) && exit 0

# detector 對 staged 檔跑；命中 exit 1（blocking）。
exec node "$DETECTOR" --mode staged "${staged_vue[@]}"
