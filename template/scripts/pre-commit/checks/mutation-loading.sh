#!/usr/bin/env bash
# CLADE:VENDOR-SCRIPT
#
# mutation-loading (pre-commit, staged) — 擋 staged .vue 把 Pinia Colada mutation 的
# status === 'pending' 當 loading（按鈕永久 spinner 的靜默 bug）。
#
# 跟 pre-push 同名 check 的分工：
#   - pre-commit checks/mutation-loading.sh : 只掃本次 staged *.vue（blocking，最接近犯錯時點）
#   - pre-push  checks/mutation-loading.sh  : 掃全 repo *.vue（warn-only 回溯型，不阻擋
#                                             既有違規；fleet 有大量歷史命中，全擋會癱瘓 push）
#
# 根因：@pinia/colada 的 useMutation() 回傳的 status（data-state）在 mount 當下即 'pending'，
#       與有沒有執行無關 → 拿它當 loading = 一進頁面就永久 loading。typecheck 全綠、不發 request。
# 正解：mutation loading 用 asyncStatus === 'loading' 或 isLoading（execution-state）。
#       ⚠️ query 的 status === 'pending'（首載無資料）是對的，detector 不會誤報。
#
# Auto-detect：只掃本次 commit staged 的 *.vue；無 staged .vue 直接跳過（no-op exit 0）。
# 偵測邏輯共用 vendor/scripts/checks/mutation-loading-detect.mjs（支援跨行 destructuring）。
#
# 規約來源：
#   - impl-time rule : rules/modules/framework/nuxt/page-loading-golden-path.md Tier 2.5
#   - review-layer   : plugins/hub-core/agents/references/clade-review-rules.md
#
# 由 ~/clade vendor/scripts/pre-commit/ 散播，請勿直接編輯 consumer 副本。

set -euo pipefail

PROJECT_ROOT="$(git rev-parse --show-toplevel)"
cd "$PROJECT_ROOT"

DETECTOR="scripts/checks/mutation-loading-detect.mjs"
[[ -f "$DETECTOR" ]] || DETECTOR="vendor/scripts/checks/mutation-loading-detect.mjs"
[[ -f "$DETECTOR" ]] || exit 0 # detector 未散播到此 consumer → no-op

# 蒐集本次 staged 的 .vue
staged_vue=()
while IFS= read -r -d '' file; do
  staged_vue+=("$file")
done < <(git diff --cached --name-only --diff-filter=ACM -z -- '*.vue')

((${#staged_vue[@]} == 0)) && exit 0

# detector 對 staged 檔跑；命中 exit 1（blocking）。
# 掃 working-tree 版本（staged 檔 working tree 版通常等同 index；少數分歧由 pre-push 全站掃補網）。
exec node "$DETECTOR" "${staged_vue[@]}"
